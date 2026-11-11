import { createSlicerClient, type SlicerClient } from '../slicer/client';
import type { EstimateResult } from '../slicer/engine/index.mjs';
import type { CustomerSlicingProfile, CustomPrintMeasurements } from '../types';
import type { ModelPart } from './printOptions';

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * Grams of every color part from the slicer's filament per extruder: Bambu/Orca projects name their
 * parts after extruders (`filament:N`); single-color models take everything; other color parts are
 * split by their share of the model. Filament of extruders without a part goes to the first part.
 */
export function partGrams(parts: ModelPart[], perExtruder: EstimateResult['per_extruder'], totalGrams: number): CustomPrintMeasurements['parts'] {
  if (parts.length === 1) return [{ key: parts[0].key, grams: round(totalGrams, 2) }];
  const extruderOf = (key: string) => /^filament:(\d+)$/.exec(key)?.[1];
  if (parts.every((part) => extruderOf(part.key))) {
    const grams = new Map(parts.map((part) => [part.key, 0]));
    for (const { extruder, weight_g } of perExtruder) {
      const part = parts.find((candidate) => Number(extruderOf(candidate.key)) === extruder) ?? parts[0];
      grams.set(part.key, grams.get(part.key)! + weight_g);
    }
    return parts.map((part) => ({ key: part.key, grams: round(grams.get(part.key)!, 2) }));
  }
  return parts.map((part) => ({ key: part.key, grams: round(totalGrams * part.share, 2) }));
}

/** The browser's slicer, shared by every model of the request (one Web Worker). */
let shared: SlicerClient | null = null;
export const customSlicer = () => (shared ??= createSlicerClient());

/**
 * Slices one copy of a customer's model with their profile: every plate of a slicer project (the
 * shop prints them all), added up. Reports progress from 0 to 1.
 */
export async function sliceCustomModel(
  client: SlicerClient,
  file: File,
  plates: number[] | undefined,
  parts: ModelPart[],
  profile: CustomerSlicingProfile,
  onProgress: (fraction: number) => void,
): Promise<CustomPrintMeasurements> {
  const bytes = await file.arrayBuffer();
  const ids = plates && plates.length > 0 ? plates : [1];
  let seconds = 0;
  let grams = 0;
  const perExtruder = new Map<number, number>();
  for (const [index, plate] of ids.entries()) {
    const { result } = await client.slice(bytes, file.name, {
      useProjectSettings: false,
      printer: profile.printer,
      process: profile.process,
      filament: profile.filament,
      support: profile.support ? 'on' : 'off',
      plate,
      copies: 1,
      scale: profile.scale,
      calibration: true,
      overrides: {},
      gcode: false,
    }, (_stage, fraction) => onProgress((index + fraction) / ids.length));
    seconds += result.time_s;
    grams += result.weight_g;
    for (const { extruder, weight_g } of result.per_extruder) perExtruder.set(extruder, (perExtruder.get(extruder) ?? 0) + weight_g);
  }
  onProgress(1);
  return {
    printMinutes: round(seconds / 60, 1),
    parts: partGrams(parts, [...perExtruder].map(([extruder, weight_g]) => ({ extruder, weight_g, length_m: 0 })), grams),
  };
}
