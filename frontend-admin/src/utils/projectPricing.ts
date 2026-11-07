import { CURRENCY } from '../config';
import type { PricingSettings, ProjectPricing, ProjectReviewInput } from '../types';

const roundCents = (value: number) => Math.round(value * 100) / 100;

/**
 * handling fee + print time × hourly rate + Σ grams × price per kg, rounded like the server does. Used for
 * the live preview while reviewing; the server computes the stored price itself.
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
    printMinutes, hourlyRate: settings.hourlyRate, printTimeCost, filaments: lines, filamentCost,
    handlingFee: settings.handlingFee, total: roundCents(settings.handlingFee + printTimeCost + filamentCost), currency: CURRENCY,
  };
}

/** "2 h 30 min", "45 min". */
export function formatDuration(minutes: number, units: { hours: string; minutes: string }): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} ${units.minutes}`;
  return rest === 0 ? `${hours} ${units.hours}` : `${hours} ${units.hours} ${rest} ${units.minutes}`;
}
