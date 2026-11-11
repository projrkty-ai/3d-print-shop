import type { FilamentType, UploadModel } from '../types';

/** An uploaded model of an order with its copies. */
export type UploadFile = UploadModel & { quantity: number };

/** Part key of models without colors of their own (as the storefront names it). */
export const SINGLE_PART_KEY = 'model';

/** A color part of a customer's model, as read in the browser. */
export interface ModelPart {
  key: string;
  name: string;
  /** The part's color in the file (#rrggbb), or null when the file has none. */
  fileColor: string | null;
  /** Share of the model's material, estimated from surface area; the shares add up to 1. */
  share: number;
}

export interface Estimate {
  /** Filament used by one copy, in grams. */
  grams: number;
  /** Estimated price of one copy. */
  unitPrice: number;
}

type PricedFilament = Pick<FilamentType, 'pricePerKg' | 'densityGPerCm3'>;

/** Layer heights a nozzle can print: from a quarter of its diameter to 0.8 × its diameter (as the server checks). */
export function layerHeightRange(diameterMm: number): { min: number; max: number } {
  return { min: diameterMm / 4, max: diameterMm * 0.8 };
}

export function layerFitsNozzle(heightMm: number, diameterMm: number): boolean {
  const { min, max } = layerHeightRange(diameterMm);
  return heightMm >= min - 1e-9 && heightMm <= max + 1e-9;
}

/**
 * Price of one copy: the model's solid volume in kilograms of each part's filament (split by the
 * parts' shares) times its price per kilogram, times the nozzle's and layer height's multipliers.
 * The storefront shows customers the same price (without weights); the shop sets the final price.
 */
export function estimatePrint(
  volumeCm3: number,
  parts: Pick<ModelPart, 'key' | 'share'>[],
  priceMultiplier: number,
  filamentOf: (key: string) => PricedFilament | undefined,
): Estimate {
  let grams = 0;
  let price = 0;
  for (const part of parts) {
    const filament = filamentOf(part.key);
    if (!filament) continue;
    const partGrams = volumeCm3 * part.share * filament.densityGPerCm3;
    grams += partGrams;
    price += (partGrams / 1000) * filament.pricePerKg;
  }
  return { grams: Math.round(grams), unitPrice: Math.round(price * priceMultiplier * 100) / 100 };
}

/**
 * Estimate for an uploaded file from the prices snapshotted when it was ordered and the shop's own
 * reading of the file. Null for requests placed before print options existed.
 */
export function estimateFile(file: UploadModel, volumeCm3: number, parts: ModelPart[]): Estimate | null {
  if (!hasPrintOptions(file)) return null;
  const chosen = new Map(file.parts.map((part) => [part.key, part.filament]));
  // A part the customer's browser didn't report (shouldn't happen) is priced like the first chosen filament.
  return estimatePrint(volumeCm3, parts, file.nozzle.priceMultiplier * file.layerHeight.priceMultiplier,
    (key) => chosen.get(key) ?? file.parts[0].filament);
}

export type FileWithOptions = UploadModel & Required<Pick<UploadModel, 'nozzle' | 'layerHeight' | 'parts'>>;

/** False for requests placed before the current print options (nozzle, layer height, price per kilogram). */
export function hasPrintOptions(file: UploadModel): file is FileWithOptions {
  return !!file.nozzle && !!file.layerHeight && !!file.parts?.length && file.parts.every((part) => part.filament.pricePerKg > 0);
}

/** Colors to draw the model in: the chosen filament per part, or undefined for older requests. */
export function fileColors(file: UploadModel): { color: string; partColors: Record<string, string> } | undefined {
  if (!file.parts?.length) return undefined;
  return {
    color: file.parts[0].color.hex,
    partColors: Object.fromEntries(file.parts.map((part) => [part.key, part.color.hex])),
  };
}
