import { CURRENCY } from '../config';
import type { PricingSettings, ProjectPricing, ProjectReviewInput } from '../types';

const roundCents = (value: number) => Math.round(value * 100) / 100;

/** Used until the admin saves the shop's own rates. */
export const DEFAULT_PRICING: PricingSettings = {
  hourlyRate: 2,
  handlingFee: 5,
  filamentPricePerKg: { PLA: 25, PETG: 28, ABS: 26, ASA: 32, TPU: 40, resin: 60 },
  updatedAt: null,
};

/**
 * handling fee + print time × hourly rate + Σ grams × price per kg. Rows of the same material are
 * added up; every amount is rounded to cents and the total is the sum of the rounded parts.
 */
export function priceProject({ printMinutes, filaments }: ProjectReviewInput, settings: PricingSettings): ProjectPricing {
  const grams = new Map<(typeof filaments)[number]['material'], number>();
  for (const { material, grams: used } of filaments) grams.set(material, (grams.get(material) ?? 0) + used);
  const lines = [...grams].map(([material, used]) => {
    const pricePerKg = settings.filamentPricePerKg[material];
    return { material, grams: roundCents(used), pricePerKg, cost: roundCents((used / 1000) * pricePerKg) };
  });
  const printTimeCost = roundCents((printMinutes / 60) * settings.hourlyRate);
  const filamentCost = roundCents(lines.reduce((sum, line) => sum + line.cost, 0));
  return {
    printMinutes,
    hourlyRate: settings.hourlyRate,
    printTimeCost,
    filaments: lines,
    filamentCost,
    handlingFee: settings.handlingFee,
    total: roundCents(settings.handlingFee + printTimeCost + filamentCost),
    currency: CURRENCY,
  };
}

/** The price of one set without the handling fee, which is charged once per order. */
export const setPrice = (pricing: ProjectPricing) => roundCents(pricing.printTimeCost + pricing.filamentCost);

/** `sets` copies of a priced print in one order: everything repeats except the handling fee. */
export function pricingForSets(pricing: ProjectPricing, sets: number): ProjectPricing {
  const filaments = pricing.filaments.map((line) => ({ ...line, grams: roundCents(line.grams * sets), cost: roundCents(line.cost * sets) }));
  const printTimeCost = roundCents(pricing.printTimeCost * sets);
  const filamentCost = roundCents(filaments.reduce((sum, line) => sum + line.cost, 0));
  return {
    ...pricing,
    printMinutes: pricing.printMinutes * sets,
    printTimeCost,
    filaments,
    filamentCost,
    total: roundCents(pricing.handlingFee + printTimeCost + filamentCost),
  };
}
