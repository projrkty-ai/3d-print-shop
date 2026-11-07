import type { FilamentColor, FilamentType, LayerHeightOption, NozzleOption, PrintSettings } from '../types';

/** Part key of models without colors of their own. */
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

export interface PartChoice {
  filamentId: string;
  colorId: string;
}

/** What the customer chose for one model: nozzle, layer height, and a filament type and color per part. */
export interface ModelOptions {
  nozzleId: string;
  layerHeightId: string;
  parts: Record<string, PartChoice>;
}

/** Layer heights a nozzle can print: from a quarter of its diameter to 0.8 × its diameter (as the shop checks). */
export function layerHeightRange(diameterMm: number): { min: number; max: number } {
  return { min: diameterMm / 4, max: diameterMm * 0.8 };
}

export function layerFitsNozzle(heightMm: number, diameterMm: number): boolean {
  const { min, max } = layerHeightRange(diameterMm);
  return heightMm >= min - 1e-9 && heightMm <= max + 1e-9;
}

/** The shop's layer heights a nozzle can print, thinnest first. */
export function layersForNozzle(settings: PrintSettings, nozzle: NozzleOption): LayerHeightOption[] {
  return settings.layerHeights.filter((l) => layerFitsNozzle(l.heightMm, nozzle.diameterMm)).sort((a, b) => a.heightMm - b.heightMm);
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** The filament color that looks most like `hex` (plain RGB distance is good enough for picking a default). */
export function nearestColor(hex: string | null, colors: FilamentColor[]): FilamentColor {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return colors[0];
  const target = rgb(hex);
  const distance = (color: FilamentColor) => rgb(color.hex).reduce((sum, value, i) => sum + (value - target[i]) ** 2, 0);
  return colors.reduce((best, color) => (distance(color) < distance(best) ? color : best));
}

/**
 * Options valid for the current settings: keeps every still-offered choice, and otherwise uses the
 * defaults — the default nozzle; the chosen (or default) layer height, or the one closest to it that
 * the nozzle can print; the first filament, and the color nearest the part's own color.
 */
export function resolveOptions(parts: ModelPart[], options: ModelOptions | null, settings: PrintSettings): ModelOptions {
  const nozzle = settings.nozzles.find((n) => n.id === options?.nozzleId)
    ?? settings.nozzles.find((n) => n.id === settings.defaultNozzleId) ?? settings.nozzles[0];
  const wanted = settings.layerHeights.find((l) => l.id === options?.layerHeightId)
    ?? settings.layerHeights.find((l) => l.id === settings.defaultLayerHeightId) ?? settings.layerHeights[0];
  const fitting = layersForNozzle(settings, nozzle);
  // The shop rejects settings where a nozzle can't print any layer height, so `fitting` is never empty.
  const layer = fitting.length === 0 ? wanted : fitting.find((l) => l.id === wanted.id)
    ?? fitting.reduce((best, l) => (Math.abs(l.heightMm - wanted.heightMm) < Math.abs(best.heightMm - wanted.heightMm) ? l : best));
  const chosen = Object.fromEntries(parts.map((part): [string, PartChoice] => {
    const choice = options?.parts[part.key];
    const filament = settings.filaments.find((f) => f.id === choice?.filamentId) ?? settings.filaments[0];
    const color = filament.colors.find((c) => c.id === choice?.colorId && filament.id === choice?.filamentId)
      ?? nearestColor(part.fileColor, filament.colors);
    return [part.key, { filamentId: filament.id, colorId: color.id }];
  }));
  return { nozzleId: nozzle.id, layerHeightId: layer.id, parts: chosen };
}

/** A part's choice with the filament and color it names (assumes resolved options). */
export function partSelection(settings: PrintSettings, choice: PartChoice): { filament: FilamentType; color: FilamentColor } {
  const filament = settings.filaments.find((f) => f.id === choice.filamentId) ?? settings.filaments[0];
  return { filament, color: filament.colors.find((c) => c.id === choice.colorId) ?? filament.colors[0] };
}

/** The nozzle and layer height resolved options name. */
export function printSetup(settings: PrintSettings, options: ModelOptions): { nozzle: NozzleOption; layerHeight: LayerHeightOption } {
  return {
    nozzle: settings.nozzles.find((n) => n.id === options.nozzleId) ?? settings.nozzles[0],
    layerHeight: settings.layerHeights.find((l) => l.id === options.layerHeightId) ?? settings.layerHeights[0],
  };
}

export interface ModelColors {
  color: string;
  partColors: Record<string, string>;
}

/** Colors to draw the model in: the chosen filament color of every part (and of single-color models). */
export function chosenColors(parts: ModelPart[], options: ModelOptions, settings: PrintSettings): ModelColors {
  const partColors = Object.fromEntries(parts.map((part) => [part.key, partSelection(settings, options.parts[part.key]).color.hex]));
  return { color: partColors[parts[0].key], partColors };
}

export interface Estimate {
  /** Estimated price of one copy. Customers see only prices, never weights or rates. */
  unitPrice: number;
}

type PricedFilament = Pick<FilamentType, 'pricePerKg' | 'densityGPerCm3'>;

/**
 * Price of one copy: the model's solid volume in kilograms of each part's filament (split by the
 * parts' shares) times its price per kilogram, times the nozzle's and the layer height's
 * multipliers. The shop uses the same formula to suggest its quote; the final price is set by the shop.
 */
export function estimatePrint(
  volumeCm3: number,
  parts: Pick<ModelPart, 'key' | 'share'>[],
  priceMultiplier: number,
  filamentOf: (key: string) => PricedFilament | undefined,
): Estimate {
  let price = 0;
  for (const part of parts) {
    const filament = filamentOf(part.key);
    if (!filament) continue;
    price += (volumeCm3 * part.share * filament.densityGPerCm3 / 1000) * filament.pricePerKg;
  }
  return { unitPrice: Math.round(price * priceMultiplier * 100) / 100 };
}

/** Estimate for a model with the customer's (resolved) options under the current settings. */
export function estimateOptions(volumeCm3: number, parts: ModelPart[], options: ModelOptions, settings: PrintSettings): Estimate {
  const { nozzle, layerHeight } = printSetup(settings, options);
  return estimatePrint(volumeCm3, parts, nozzle.priceMultiplier * layerHeight.priceMultiplier,
    (key) => (options.parts[key] ? partSelection(settings, options.parts[key]).filament : undefined));
}
