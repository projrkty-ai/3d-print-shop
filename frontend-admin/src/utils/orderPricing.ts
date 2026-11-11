import { PRINT_MATERIALS, type ItemModel, type MeasurementsInput, type PricingSettings } from '../types';

const roundCents = (value: number) => Math.round(value * 100) / 100;

/** A filament an item's measurements may name, with its price per kilogram. */
export interface FilamentSlot {
  key: string;
  label: string;
  pricePerKg: number;
}

/**
 * What an item's measurements are priced with, as the server prices them: an uploaded model's color
 * parts with the filament the customer chose (at its price when ordered); otherwise the shop's
 * materials at the current rates.
 */
export function filamentSlots(model: ItemModel, pricing: Pick<PricingSettings, 'filamentPricePerKg'>): FilamentSlot[] {
  if (model.source === 'upload' && model.parts && model.parts.length > 0) {
    const several = model.parts.length > 1;
    return model.parts.map((part) => ({
      key: part.key,
      label: `${several ? `${part.name}: ` : ''}${part.filament.name} ${part.color.name}`,
      pricePerKg: part.filament.pricePerKg,
    }));
  }
  return PRINT_MATERIALS.map((material) => ({ key: material, label: material, pricePerKg: pricing.filamentPricePerKg[material] }));
}

/** Whether an item is measured by its color parts (uploads with parts) rather than by material. */
export const measuredByParts = (model: ItemModel) => model.source === 'upload' && !!model.parts?.length;

/** Price of one copy: print time × hourly rate + grams × price per kilogram, each rounded to cents (as the server). */
export function copyPrice(input: MeasurementsInput, slots: FilamentSlot[], hourlyRate: number): number | null {
  const grams = new Map<string, number>();
  for (const { key, grams: used } of input.filaments) {
    if (!slots.some((slot) => slot.key === key)) return null;
    grams.set(key, (grams.get(key) ?? 0) + used);
  }
  const filamentCost = [...grams].reduce((sum, [key, used]) => sum + roundCents((used / 1000) * slots.find((slot) => slot.key === key)!.pricePerKg), 0);
  return roundCents(roundCents((input.printMinutes / 60) * hourlyRate) + roundCents(filamentCost));
}
