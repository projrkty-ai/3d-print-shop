import { randomInt, randomUUID } from 'node:crypto';
import { CURRENCY } from '../domain/config';
import { filamentSlots, priceMeasurements, roundCents, withItemTotals } from '../domain/orderPricing';
import type { ItemReview, MeasurementsInput, Order, OrderInput, OrderSource, OrderStatus } from '../domain/types';
import { DEFAULT_PRICING } from '../domain/utils/projectPricing';
import { HttpError, notFound } from '../http';
import { t } from '../i18n';
import { deleteLogBook, logStatus, missingValueMessages, sendToCustomer, statusEmail } from '../logBook';
import type { Mailer } from '../mail/mailer';
import type { ModelSearch } from '../modelSearch';
import { DuplicateOrderNumberError, type Storage } from '../storage';
import { catalogDraft } from './catalog';
import { printOnDemandDraft, projectDraft } from './project';
import type { SourceDraft } from './types';
import { planPrintJob, type QueueInput } from './printQueue';
import { uploadDraft, uploadedFileIds } from './upload';

/** Short, unambiguous characters (no 0/O, 1/I) for order numbers read out over the phone. */
const NUMBER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** The number's prefix tells the workshop where the models come from at a glance. */
const NUMBER_PREFIX: Record<OrderSource, string> = { catalog: 'PF', upload: 'CP', project: 'PJ', printOnDemand: 'PJ' };

export function orderNumber(date: Date, source: OrderSource = 'catalog'): string {
  const day = date.toISOString().slice(2, 10).replaceAll('-', '');
  const suffix = Array.from({ length: 4 }, () => NUMBER_ALPHABET[randomInt(NUMBER_ALPHABET.length)]).join('');
  return `${NUMBER_PREFIX[source]}-${day}-${suffix}`;
}

const pricingSettings = async (db: Storage) => (await db.settings.getPricing()) ?? DEFAULT_PRICING;

/** The source-specific part of a new order: its items, price and (for projects) the project. */
async function sourceDraft(db: Storage, modelSearch: ModelSearch, input: OrderInput, now: Date): Promise<SourceDraft> {
  switch (input.source) {
    case undefined:
    case 'catalog':
      return catalogDraft(db, input.items);
    case 'upload':
      return uploadDraft(db, input.items, now);
    case 'project':
      return projectDraft(modelSearch, input, (await pricingSettings(db)).handlingFee);
    case 'printOnDemand': {
      const product = await db.projectProducts.get(input.productId);
      if (!product || !product.published) throw notFound('Project product');
      return printOnDemandDraft(product, input, await pricingSettings(db), now);
    }
  }
}

/**
 * Places an order, the same way for every source: the source supplies the items and the price;
 * the order starts as `received`, gets a random number (drawn again on the rare collision), and its
 * log book starts with that status.
 */
export async function createOrder(db: Storage, modelSearch: ModelSearch, input: OrderInput, now = new Date()): Promise<Order> {
  const { afterInsert, ...draft } = await sourceDraft(db, modelSearch, input, now);
  const order: Order = {
    id: randomUUID(),
    number: '',
    status: 'received',
    ...draft,
    customer: input.customer,
    customerNote: input.customerNote ?? '',
    currency: CURRENCY,
    adminNote: '',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  for (let attempt = 0; ; attempt++) {
    order.number = orderNumber(now, order.source);
    try {
      await db.orders.insert(order);
      break;
    } catch (err) {
      if (!(err instanceof DuplicateOrderNumberError) || attempt >= 5) throw err;
    }
  }
  try {
    await afterInsert?.(order);
  } catch (err) {
    await db.orders.delete(order.id);
    throw err;
  }
  await logStatus(db, order.id, null, order.status);
  return order;
}

export interface OrderChanges {
  status?: OrderStatus;
  adminNote?: string;
  /** The quote (orders that need one); null withdraws it. */
  price?: number | null;
  /** With status `queued`: the printer whose queue the order joins (see `planPrintJob`). */
  queue?: QueueInput;
  /** With a status change: email the customer the status template, with `note` as its {{note}}. */
  notify?: boolean;
  note?: string;
}

/**
 * The admin's processing, alike for every order: status, internal note and — for orders that need a
 * quote — the price. An order can only be `quoted` with a price. `queued` puts the order in a printer's
 * queue (`queue`; see `planPrintJob`), and leaving `queued`/`printing` takes it out. A status change is
 * logged; with `notify` the status email is sent (also when a queued order moves to another printer),
 * its required values checked before anything is saved.
 */
export async function updateOrder(db: Storage, mailer: Mailer, id: string, { notify, note, price, queue, ...changes }: OrderChanges): Promise<Order> {
  const existing = await db.orders.get(id);
  if (!existing) throw notFound('Order');
  if (price !== undefined && existing.price.mode === 'fixed' && price !== existing.price.total) throw new HttpError(409, t('priceFixed'));
  const next: Order = {
    ...existing,
    ...changes,
    ...(price !== undefined && existing.price.mode === 'quote' && { price: { ...existing.price, total: price === null ? null : roundCents(price) } }),
  };
  if (next.status === 'quoted' && next.price.total === null) throw new HttpError(400, t('quoteNeedsPrice'));
  // Queued and printing orders are in a printer's queue; any other status (e.g. cancelled) takes them out.
  next.printJob = await planPrintJob(db, existing, next.status, queue, new Date());
  const statusChanged = next.status !== existing.status;
  const requeued = next.status === 'queued' && next.printJob?.queuedAt !== existing.printJob?.queuedAt;
  const email = (statusChanged || requeued) && notify ? await statusEmail(db, next, next.status, { note }) : null;
  if (email && email.missing.length > 0) throw new HttpError(400, t('emailMissingValues'), missingValueMessages(email.missing));
  const order = await db.orders.update(existing.id, {
    status: next.status, adminNote: next.adminNote, price: next.price, printJob: next.printJob, updatedAt: new Date().toISOString(),
  });
  if (!order) throw notFound('Order');
  if (statusChanged) await logStatus(db, order.id, existing.status, order.status);
  if (email) await sendToCustomer(db, mailer, order, email);
  return order;
}

/**
 * Stores the shop's measurements of one copy of an item (sliced, possibly edited, or entered by
 * hand), priced with the current rates: by the model's filaments (see `filamentSlots`). The order's
 * reviewed price follows once every item is measured; orders that need a quote take the current
 * handling fee too. A fixed price never changes.
 */
export async function reviewItem(db: Storage, order: Order, index: number, input: MeasurementsInput & { sliced?: ItemReview['sliced'] }): Promise<Order> {
  const item = order.items[index];
  if (!item) throw new HttpError(404, t('itemNotFound'));
  const settings = await pricingSettings(db);
  const priced = priceMeasurements(input, filamentSlots(item.model, settings), settings.hourlyRate);
  if (typeof priced === 'string') throw new HttpError(400, t('invalidRequest'), [priced]);
  const review: ItemReview = { ...priced, ...(input.sliced && { sliced: input.sliced }), reviewedAt: new Date().toISOString() };
  const items = order.items.map((entry, i) => (i === index ? { ...entry, review } : entry));
  const handlingFee = order.price.mode === 'quote' ? settings.handlingFee : order.price.handlingFee;
  const updated = await db.orders.update(order.id, {
    items,
    price: withItemTotals({ items, price: { ...order.price, handlingFee } }),
    updatedAt: new Date().toISOString(),
  });
  if (!updated) throw notFound('Order');
  return updated;
}

/** Deletes the order with its log book and, for uploaded models, the customer's files. */
export async function deleteOrder(db: Storage, id: string): Promise<boolean> {
  const deleted = await db.orders.get(id);
  if (!deleted || !(await db.orders.delete(id))) return false;
  for (const fileId of uploadedFileIds(deleted.items)) await db.customerFiles.delete(fileId);
  await deleteLogBook(db, id);
  return true;
}
