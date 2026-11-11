import { filamentSlots } from '../domain/orderPricing';
import type {
  CatalogModel, ExternalProject, ItemReview, LogEntry, Order, OrderItem, OrderStatus, PrintMeasurements, PrintOnDemandModel, ProjectOrderItem,
  ProjectPricing, ProjectPrintSettings, ProjectProduct, UploadModel,
} from '../domain/types';
import { DEFAULT_PRICING } from '../domain/utils/projectPricing';

type Document = Record<string, unknown>;

/**
 * Brings project orders saved by the first versions to the last shape before orders were unified,
 * or returns null when already there:
 * - one `preferences` object for a list of `files` becomes one item per file (or one whole-project item);
 * - orders without `requiresQuote` need a quote unless they were placed for a ready-to-print product,
 *   which earlier versions always priced at once.
 */
function upgradeProjectOrder(document: Document): Document | null {
  let changed = false;
  let order = document;
  if (!Array.isArray(order.items)) {
    const { files, preferences, ...rest } = order as Document & {
      files?: ProjectOrderItem['file'][];
      preferences?: { quantity?: number; material?: string; color?: string; scalePercent?: number; notes?: string };
    };
    const settings: ProjectPrintSettings = {
      quantity: preferences?.quantity ?? 1,
      scalePercent: preferences?.scalePercent ?? 100,
      filaments: [{ material: (preferences?.material ?? 'any') as ProjectPrintSettings['filaments'][number]['material'], color: preferences?.color ?? '' }],
    };
    const chosen = Array.isArray(files) && files.length > 0 ? files : [null];
    order = {
      ...rest,
      items: chosen.map((file) => ({ file, settings: { ...settings, filaments: settings.filaments.map((f) => ({ ...f })) } })),
      sameSettingsForAll: true,
      notes: preferences?.notes ?? '',
    };
    changed = true;
  }
  if (typeof order.requiresQuote !== 'boolean') {
    const product = order.product as Document | undefined;
    order = {
      ...order,
      requiresQuote: !product,
      ...(product && { product: { ...product, materialsChanged: false } }),
    };
    changed = true;
  }
  return changed ? order : null;
}

/** Products first stored a price snapshot (`pricing`); now only the measurements, priced on demand. */
export function upgradeProjectProduct(document: Document): ProjectProduct | null {
  if (document.measurements || !document.pricing) return null;
  const { pricing, ...rest } = document as Document & { pricing: PrintMeasurements & { filaments: { material: string; grams: number }[] } };
  return {
    ...(rest as unknown as Omit<ProjectProduct, 'measurements'>),
    measurements: {
      printMinutes: pricing.printMinutes,
      filaments: pricing.filaments.map(({ material, grams }) => ({ material, grams })) as PrintMeasurements['filaments'],
    },
  };
}

/** Statuses of the former order kinds, in the statuses every order now shares. */
const LEGACY_STATUSES: Record<string, OrderStatus> = {
  pending: 'received', submitted: 'received', new: 'received',
  approved: 'quoted', quoted: 'quoted', accepted: 'accepted', paid: 'paid',
  printing: 'printing', shipped: 'shipped', delivered: 'delivered', rejected: 'rejected', cancelled: 'cancelled',
};
const status = (value: unknown): OrderStatus => LEGACY_STATUSES[String(value)] ?? 'received';

/** Whether an order document already has the unified shape. */
export const isUnifiedOrder = (document: Document) => typeof document.source === 'string' && typeof document.price === 'object' && document.price !== null;

const round = (value: number) => Math.round(value * 100) / 100;

type LegacyMeasurements = { printMinutes: number; parts: { key: string; grams: number }[] };

/** A print request's stored review of one file, priced with the file's filaments as then. */
function legacyUploadReview(
  model: UploadModel,
  review: LegacyMeasurements & { unitPrice: number; sliced?: LegacyMeasurements & { slicedAt: string }; reviewedAt: string },
): ItemReview {
  const slots = filamentSlots(model, DEFAULT_PRICING);
  const filaments = review.parts.map(({ key, grams }) => {
    const slot = slots.find((candidate) => candidate.key === key) ?? slots[0];
    return { key: slot.key, label: slot.label, grams, pricePerKg: slot.pricePerKg, cost: round((grams / 1000) * slot.pricePerKg) };
  });
  const filamentCost = round(filaments.reduce((sum, line) => sum + line.cost, 0));
  const printTimeCost = round(review.unitPrice - filamentCost);
  return {
    printMinutes: review.printMinutes,
    // Not stored by earlier versions: derived from the price of the print time.
    hourlyRate: review.printMinutes > 0 ? round(printTimeCost / (review.printMinutes / 60)) : 0,
    printTimeCost,
    filaments,
    filamentCost,
    unitPrice: review.unitPrice,
    ...(review.sliced && { sliced: { printMinutes: review.sliced.printMinutes, filaments: review.sliced.parts, slicedAt: review.sliced.slicedAt } }),
    reviewedAt: review.reviewedAt,
  };
}

/** A whole-order price review of earlier project orders, as the measurements of one of `copies` copies. */
function legacyProjectReview(review: ProjectPricing & { reviewedAt: string }, copies: number): ItemReview {
  const filaments = review.filaments.map((line) => ({
    key: line.material, label: line.material, grams: round(line.grams / copies), pricePerKg: line.pricePerKg, cost: round(line.cost / copies),
  }));
  const printTimeCost = round(review.printTimeCost / copies);
  const filamentCost = round(filaments.reduce((sum, line) => sum + line.cost, 0));
  return {
    printMinutes: round(review.printMinutes / copies), hourlyRate: review.hourlyRate, printTimeCost, filaments, filamentCost,
    unitPrice: round(printTimeCost + filamentCost), reviewedAt: review.reviewedAt,
  };
}

const common = (document: Document) => ({
  id: document.id as string,
  number: document.number as string,
  status: status(document.status),
  customer: document.customer as Order['customer'],
  currency: (document.currency as string | undefined) ?? 'USD',
  adminNote: (document.adminNote as string | undefined) ?? '',
  createdAt: document.createdAt as string,
  updatedAt: document.updatedAt as string,
});

/** A catalog order saved before orders were unified: its items become catalog models, its total the fixed price. */
export function upgradeCatalogOrder(document: Document): Order {
  const items = (document.items as (Record<string, unknown> & { quantity: number; unitPrice: number; lineTotal: number })[]).map(
    ({ quantity, unitPrice, lineTotal, ...model }): OrderItem => ({
      model: { source: 'catalog', ...(model as Omit<CatalogModel, 'source'>) },
      quantity, unitPrice, lineTotal,
    }),
  );
  return {
    ...common(document),
    source: 'catalog',
    customerNote: (document.customerNote as string | undefined) ?? '',
    items,
    price: { mode: 'fixed', handlingFee: (document.handlingFee as number | undefined) ?? 0, estimated: null, reviewed: null, total: document.total as number },
  };
}

/** A print request (customer's own files): a quote order whose files are its items. */
export function upgradeCustomOrder(document: Document): Order {
  type LegacyFile = Omit<UploadModel, 'source'> & {
    quantity: number;
    estimate?: LegacyMeasurements & { unitPrice: number };
    review?: Parameters<typeof legacyUploadReview>[1];
  };
  const items = (document.files as LegacyFile[]).map(({ quantity, estimate, review, ...file }): OrderItem => {
    const model: UploadModel = { source: 'upload', ...file };
    return {
      model, quantity, unitPrice: null, lineTotal: null,
      ...(estimate && { estimate: { printMinutes: estimate.printMinutes, filaments: estimate.parts, unitPrice: estimate.unitPrice } }),
      ...(review && { review: legacyUploadReview(model, review) }),
    };
  });
  return {
    ...common(document),
    source: 'upload',
    customerNote: (document.customerNote as string | undefined) ?? '',
    items,
    price: {
      mode: 'quote',
      handlingFee: (document.handlingFee as number | undefined) ?? 0,
      estimated: (document.estimatedPrice as number | undefined) ?? null,
      reviewed: (document.reviewedPrice as number | null | undefined) ?? null,
      total: (document.quotedPrice as number | null | undefined) ?? null,
    },
  };
}

/**
 * A project order (external project or Print on Demand product). Its price review covered the whole
 * order and was its price: it stays the price, and becomes the measurements of the only item when
 * there is one (orders of several models are measured again per model when needed). A Print on
 * Demand order becomes one item: the product's set, `sets` times.
 */
export function upgradeLegacyProjectOrder(stored: Document): Order {
  const document = (upgradeProjectOrder(stored) ?? stored) as unknown as Document & {
    project: ExternalProject; projectVerified: boolean; items: ProjectOrderItem[]; sameSettingsForAll: boolean; notes: string;
    requiresQuote: boolean; review?: ProjectPricing & { reviewedAt: string };
    product?: { id: string; title: string; sets: number; materialsChanged: boolean; print?: PrintOnDemandModel['print'] };
  };
  const { review, product } = document;
  const fixed = !document.requiresQuote;
  const setPrice = review && product ? round((review.total - review.handlingFee) / product.sets) : null;
  const items: OrderItem[] = product
    ? [{
      model: {
        source: 'printOnDemand', productId: product.id, title: product.title,
        models: document.items.map((item) => ({
          ...item, settings: { ...item.settings, quantity: Math.max(1, Math.round(item.settings.quantity / product.sets)) },
        })),
        ...(product.print && { print: product.print }),
        materialsChanged: product.materialsChanged,
      },
      quantity: product.sets,
      unitPrice: fixed ? setPrice : null,
      lineTotal: fixed && setPrice !== null ? round(setPrice * product.sets) : null,
      ...(review && { review: legacyProjectReview(review, product.sets) }),
    }]
    : document.items.map((item) => ({
      model: { source: 'project', file: item.file, scalePercent: item.settings.scalePercent, filaments: item.settings.filaments },
      quantity: item.settings.quantity,
      unitPrice: null,
      lineTotal: null,
      ...(review && document.items.length === 1 && { review: legacyProjectReview(review, item.settings.quantity) }),
    }));
  return {
    ...common(document),
    source: product ? 'printOnDemand' : 'project',
    customerNote: document.notes ?? '',
    items,
    project: { ...document.project, verified: document.projectVerified, sameSettingsForAll: document.sameSettingsForAll },
    price: {
      mode: fixed ? 'fixed' : 'quote',
      handlingFee: review?.handlingFee ?? 0,
      estimated: null,
      reviewed: review?.total ?? null,
      total: review?.total ?? null,
    },
  };
}

/**
 * Log entries no longer name the kind of order they belong to; their statuses and the templates of
 * sent emails (`order.paid`, `customOrder.approved`) become the shared statuses.
 */
export function upgradeLogEntry(document: Document): LogEntry | null {
  if (!('orderKind' in document)) return null;
  const { orderKind: _orderKind, ...entry } = document;
  if (entry.type === 'status') {
    return { ...entry, from: entry.from === null ? null : status(entry.from), to: status(entry.to) } as unknown as LogEntry;
  }
  if (entry.type === 'emailSent' && typeof entry.template === 'string') {
    return { ...entry, template: status(entry.template.split('.').at(-1)) } as unknown as LogEntry;
  }
  return entry as unknown as LogEntry;
}
