import type { PrintMeasurements, ProjectOrder, ProjectOrderItem, ProjectPrintSettings, ProjectProduct } from '../domain/types';

type Document = Record<string, unknown>;

/**
 * Brings project orders saved by earlier versions up to date, or returns null when already current:
 * - one `preferences` object for a list of `files` becomes one item per file (or one whole-project item);
 * - orders without `requiresQuote` need a quote unless they were placed for a ready-to-print product,
 *   which earlier versions always priced at once.
 */
export function upgradeProjectOrder(document: Document): ProjectOrder | null {
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
  return changed ? (order as unknown as ProjectOrder) : null;
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
