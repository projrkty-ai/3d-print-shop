import { nextQueueStart, QUEUE_GAP_MINUTES, scheduleQueue, type QueueSlot } from '../domain/printQueue';
import type { Order, OrderStatus, Printer, PrinterQueueSummary, PrintJob, QueueEntry } from '../domain/types';
import { HttpError } from '../http';
import { t } from '../i18n';
import type { Storage } from '../storage';

/** An order that is in a printer's queue. */
export type QueuedOrder = Order & { printJob: PrintJob };

/** What the admin sends to put an order in a printer's queue. */
export interface QueueInput {
  printerId: string;
  /** Minutes the whole order prints; omitted: from the shop's measurements of every item. */
  printMinutes?: number;
}

/** Statuses of orders in a queue: waiting, or being printed. */
const IN_QUEUE: readonly OrderStatus[] = ['queued', 'printing'];

/** Every order in a printer's queue (all printers, or one). */
export async function queuedOrders(db: Storage, printerId?: string): Promise<QueuedOrder[]> {
  const lists = await Promise.all(IN_QUEUE.map((status) => db.orders.list({ status, limit: 10_000 })));
  return lists.flat().filter((order): order is QueuedOrder => Boolean(order.printJob) && (!printerId || order.printJob!.printerId === printerId));
}

/**
 * Minutes the whole order prints from the shop's measurements (one copy of every item × its copies),
 * or null while an item is not measured.
 */
export function measuredPrintMinutes(order: Pick<Order, 'items'>): number | null {
  if (order.items.some((item) => !item.review)) return null;
  return Math.round(order.items.reduce((sum, item) => sum + item.review!.printMinutes * item.quantity, 0));
}

/**
 * The order's place in a queue after changing to `status` (without saving anything):
 * - `queued` with `queue`: joins the end of that printer's queue (also to move it to another
 *   printer), with the print time given, measured or kept, and the estimated start; on the same
 *   printer without a new print time it keeps its place;
 * - `queued` without `queue`: keeps its place (a print taken back from `printing`); an order that
 *   is in no queue needs a printer;
 * - `printing`: starts its print (a printer prints one order at a time);
 * - any other status takes the order out of its queue (null).
 */
export async function planPrintJob(db: Storage, order: Order, status: OrderStatus, queue: QueueInput | undefined, now: Date): Promise<PrintJob | null> {
  const current = order.printJob ?? null;
  if (queue && status !== 'queued') throw new HttpError(400, t('queueStatusOnly'));
  if (status === 'queued') {
    if (!queue || (current && current.printerId === queue.printerId && queue.printMinutes === undefined)) {
      if (!current) throw new HttpError(400, t('queueNeedsPrinter'));
      return { ...current, startedAt: null };
    }
    const printer = await db.printers.get(queue.printerId);
    if (!printer) throw new HttpError(400, t('queuePrinterUnknown'));
    // Moving to another printer keeps the print time unless the order has been measured since.
    const printMinutes = queue.printMinutes ?? measuredPrintMinutes(order) ?? current?.printMinutes ?? null;
    if (printMinutes === null) throw new HttpError(400, t('queuePrintTime'));
    const others = (await queuedOrders(db, printer.id)).filter((other) => other.id !== order.id);
    // Joining the end: after everything already queued, even within the same millisecond.
    const last = Math.max(0, ...others.map((other) => Date.parse(other.printJob.queuedAt)));
    const job: PrintJob = {
      printerId: printer.id,
      printerName: printer.name,
      queuedAt: new Date(Math.max(now.getTime(), last + 1)).toISOString(),
      printMinutes,
      startedAt: null,
      estimatedStart: '',
      previousStatus: current?.previousStatus ?? (IN_QUEUE.includes(order.status) ? 'paid' : order.status),
    };
    const slot = scheduleQueue([...others, { ...order, printJob: job }], now).find((candidate) => candidate.item.id === order.id)!;
    return { ...job, estimatedStart: slot.start.toISOString() };
  }
  if (status === 'printing') {
    if (!current) return null;
    if (current.startedAt) return current;
    const busy = (await queuedOrders(db, current.printerId)).find((other) => other.id !== order.id && other.printJob.startedAt);
    if (busy) throw new HttpError(409, t('printerBusy', current.printerName, busy.number));
    return { ...current, startedAt: now.toISOString() };
  }
  return null;
}

/** What an order prints, in one line: "2 × Spiral Vase, planter.stl × 1". */
export function orderModels(order: Pick<Order, 'items' | 'project'>): string {
  return order.items.map(({ model, quantity }) => {
    switch (model.source) {
      case 'catalog': return `${quantity} × ${model.productName}`;
      case 'printOnDemand': return `${quantity} × ${model.title}`;
      case 'upload': return `${model.fileName} × ${quantity}`;
      case 'project': return `${model.file?.name ?? order.project?.title ?? ''} × ${quantity}`;
    }
  }).join(', ');
}

const entry = ({ item: order, start, end }: QueueSlot<QueuedOrder>, index: number): QueueEntry => ({
  position: index + 1,
  order: {
    id: order.id, number: order.number, status: order.status, source: order.source, createdAt: order.createdAt,
    customerName: order.customer.name, models: orderModels(order),
  },
  printJob: order.printJob,
  estimatedStart: start.toISOString(),
  estimatedEnd: end.toISOString(),
});

/** A printer's queue with the estimated start and end of every order. */
export async function printerQueueEntries(db: Storage, printerId: string, now = new Date()): Promise<QueueEntry[]> {
  return scheduleQueue(await queuedOrders(db, printerId), now).map(entry);
}

/** Every printer's queue at a glance. */
export async function queueSummaries(db: Storage, printers: Printer[], now = new Date()): Promise<Map<string, PrinterQueueSummary>> {
  const orders = await queuedOrders(db);
  return new Map(printers.map((printer) => {
    const slots = scheduleQueue(orders.filter((order) => order.printJob.printerId === printer.id), now);
    return [printer.id, { length: slots.length, nextStart: nextQueueStart(slots, now).toISOString() }];
  }));
}

export { QUEUE_GAP_MINUTES };
