import { t } from '../i18n';
import { PRINT_MATERIALS, type ItemModel, type ItemReview, type MeasurementsInput, type Order, type OrderPrice, type PricingSettings } from './types';

export const roundCents = (value: number) => Math.round(value * 100) / 100;

/** A filament an item's measurements may name, with its price per kilogram. */
export interface FilamentSlot {
  key: string;
  label: string;
  pricePerKg: number;
}

/**
 * What an item's measurements are priced with, by model source: an uploaded model's color parts
 * with the filament the customer chose for each (at its price when ordered); otherwise the shop's
 * materials at the current rates.
 */
export function filamentSlots(model: ItemModel, settings: PricingSettings): FilamentSlot[] {
  if (model.source === 'upload' && model.parts && model.parts.length > 0) {
    const several = model.parts.length > 1;
    return model.parts.map((part) => ({
      key: part.key,
      label: `${several ? `${part.name}: ` : ''}${part.filament.name} ${part.color.name}`,
      pricePerKg: part.filament.pricePerKg,
    }));
  }
  return PRINT_MATERIALS.map((material) => ({ key: material, label: material, pricePerKg: settings.filamentPricePerKg[material] }));
}

export type PricedMeasurements = Omit<ItemReview, 'sliced' | 'reviewedAt'>;

/**
 * Price of one copy: print time × hourly rate plus grams × price per kilogram of every filament,
 * each rounded to cents. Rows naming the same filament are added up. Unknown filaments are a
 * problem (returned as a message), or with `lenient` are priced like the first slot (estimates
 * from older storefronts).
 */
export function priceMeasurements(
  input: MeasurementsInput, slots: FilamentSlot[], hourlyRate: number, { lenient = false } = {},
): PricedMeasurements | string {
  const grams = new Map<string, number>();
  for (const { key, grams: used } of input.filaments) {
    const slot = slots.find((candidate) => candidate.key === key) ?? (lenient ? slots[0] : undefined);
    if (!slot) return t('unknownFilamentKey', key);
    grams.set(slot.key, (grams.get(slot.key) ?? 0) + used);
  }
  const filaments = [...grams].map(([key, used]) => {
    const slot = slots.find((candidate) => candidate.key === key)!;
    return { key, label: slot.label, grams: roundCents(used), pricePerKg: slot.pricePerKg, cost: roundCents((used / 1000) * slot.pricePerKg) };
  });
  const printTimeCost = roundCents((input.printMinutes / 60) * hourlyRate);
  const filamentCost = roundCents(filaments.reduce((sum, line) => sum + line.cost, 0));
  return { printMinutes: input.printMinutes, hourlyRate, printTimeCost, filaments, filamentCost, unitPrice: roundCents(printTimeCost + filamentCost) };
}

/** Handling once plus every item's copy price × copies; null unless every item has a price. */
function itemsTotal(order: Pick<Order, 'items'>, handlingFee: number, unitPrice: (item: Order['items'][number]) => number | undefined): number | null {
  const prices = order.items.map(unitPrice);
  if (prices.length === 0 || prices.some((price) => price === undefined)) return null;
  return roundCents(handlingFee + order.items.reduce((sum, item, i) => sum + prices[i]! * item.quantity, 0));
}

/** The order's price with the estimated and reviewed totals recalculated from its items. */
export function withItemTotals(order: Pick<Order, 'items' | 'price'>): OrderPrice {
  const { handlingFee } = order.price;
  return {
    ...order.price,
    estimated: itemsTotal(order, handlingFee, (item) => item.estimate?.unitPrice),
    reviewed: itemsTotal(order, handlingFee, (item) => item.review?.unitPrice),
  };
}
