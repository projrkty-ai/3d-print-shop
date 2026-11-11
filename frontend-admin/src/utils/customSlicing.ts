import type { SlicerClient } from '../slicer/client';
import type { EstimateResult } from '../slicer/engine/index.mjs';
import type { MeasurementsInput, PrintMaterial, SlicerPresets } from '../types';
import type { ModelPart } from './printEstimate';

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/** One plate (or a file without plates, plate 1) sliced with one set of presets. */
export interface SliceRun {
  plate: number;
  presets: SlicerPresets;
  support: boolean;
  overrides: Record<string, string>;
  /** Material the run prints with, for pricing. */
  material: PrintMaterial;
}

/** What one copy takes: every run added up, with the filament per extruder and per run. */
export interface SlicedCopy {
  seconds: number;
  grams: number;
  perExtruder: EstimateResult['per_extruder'];
  /** Grams of every run, in the order of the runs. */
  perRun: number[];
}

/**
 * Grams of every color part from the slicer's filament per extruder: Bambu/Orca projects name their
 * parts after extruders (`filament:N`); single-color models take everything; other color parts are
 * split by their share of the model. Filament of extruders without a part goes to the first part.
 */
export function partGrams(parts: ModelPart[], perExtruder: EstimateResult['per_extruder'], totalGrams: number): MeasurementsInput['filaments'] {
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

/**
 * Slices one copy of a model: every run (plate) at the same uniform scale, added up. Reports
 * progress from 0 to 1.
 */
export async function sliceRuns(
  client: SlicerClient,
  file: { bytes: ArrayBuffer; name: string },
  runs: SliceRun[],
  scale: number,
  onProgress: (fraction: number) => void,
): Promise<SlicedCopy> {
  let seconds = 0;
  let grams = 0;
  const perRun: number[] = [];
  const perExtruder = new Map<number, number>();
  for (const [index, run] of runs.entries()) {
    const { result } = await client.slice(file.bytes, file.name, {
      useProjectSettings: false,
      printer: run.presets.printer,
      process: run.presets.process,
      filament: run.presets.filament,
      support: run.support ? 'on' : 'off',
      plate: run.plate,
      copies: 1,
      scale,
      calibration: true,
      overrides: run.overrides,
      gcode: false,
    }, (_stage, fraction) => onProgress((index + fraction) / runs.length));
    seconds += result.time_s;
    grams += result.weight_g;
    perRun.push(result.weight_g);
    for (const { extruder, weight_g } of result.per_extruder) perExtruder.set(extruder, (perExtruder.get(extruder) ?? 0) + weight_g);
  }
  onProgress(1);
  return { seconds, grams, perRun, perExtruder: [...perExtruder].map(([extruder, weight_g]) => ({ extruder, weight_g, length_m: 0 })) };
}

/** Print time of a sliced copy in minutes (0.1 min). */
const minutes = (copy: SlicedCopy) => round(copy.seconds / 60, 1);

/** Measurements of an uploaded model: grams per color part. */
export const measurementsByParts = (copy: SlicedCopy, parts: ModelPart[]): MeasurementsInput =>
  ({ printMinutes: minutes(copy), filaments: partGrams(parts, copy.perExtruder, copy.grams) });

/** Measurements priced by material: the grams of every run go to the material it prints with. */
export function measurementsByMaterial(copy: SlicedCopy, runs: SliceRun[]): MeasurementsInput {
  const grams = new Map<string, number>();
  runs.forEach((run, index) => grams.set(run.material, (grams.get(run.material) ?? 0) + copy.perRun[index]));
  return { printMinutes: minutes(copy), filaments: [...grams].map(([key, used]) => ({ key, grams: round(used, 2) })) };
}
