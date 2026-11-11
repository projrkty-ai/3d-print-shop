import profiles from '../slicer/engine/profiles.json';
import type { EstimateResult, ProfilePreset } from '../slicer/engine/index.mjs';
import { buildCatalog, type ProfileCatalog } from '../slicer/profileCatalog';
import { PRINT_MATERIALS, type PlateSlicing, type PrintMaterial, type PrintMeasurements, type PrintVariant, type ScaledMeasurements, type SlicerPresets } from '../types';
import { createId } from './ids';
import { formatNumber, t } from '../i18n';

/** The bundled OrcaSlicer presets (the same as on the Slicer test tab). */
export const slicerCatalog: ProfileCatalog = buildCatalog(profiles as ProfilePreset[]);

export type SlicingMatrix = PlateSlicing['matrix'];

/** An empty setup for a plate (or the whole model); nothing is sliced until the admin picks presets. */
export function emptySlicing(plateId: number | null): PlateSlicing {
  return { plateId, matrix: { printers: [], processes: [], filaments: [] }, support: false, overrides: {}, variants: [], defaultVariantId: null };
}

/**
 * Every compatible combination of the chosen presets: each printer with each chosen process
 * and filament made for it (incompatible pairs are skipped, as in OrcaSlicer).
 */
export function matrixCombinations(matrix: SlicingMatrix, catalog: ProfileCatalog = slicerCatalog): SlicerPresets[] {
  return matrix.printers.flatMap((printer) => {
    const processes = catalog.processesFor(printer).filter((process) => matrix.processes.includes(process));
    const filaments = catalog.filamentsFor(printer).filter((filament) => matrix.filaments.includes(filament));
    return processes.flatMap((process) => filaments.map((filament) => ({ printer, process, filament })));
  });
}

/** Chosen printers that get no variant because none of the chosen processes or filaments fits them. */
export function unmatchedPrinters(matrix: SlicingMatrix, catalog: ProfileCatalog = slicerCatalog): string[] {
  return matrix.printers.filter((printer) => !matrixCombinations({ ...matrix, printers: [printer] }, catalog).length);
}

const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);
const numberSetting = (catalog: ProfileCatalog, preset: string, key: string) => {
  const value = Number.parseFloat(String(first(catalog.setting(preset, key)) ?? ''));
  return Number.isFinite(value) ? value : NaN;
};

/** The shop material of a filament preset (`filament_type`), PLA when unknown. */
export function presetMaterial(filament: string, catalog: ProfileCatalog = slicerCatalog): PrintMaterial {
  const type = String(first(catalog.setting(filament, 'filament_type')) ?? '').toLowerCase();
  return PRINT_MATERIALS.find((material) => material.toLowerCase() === type)
    ?? PRINT_MATERIALS.find((material) => type.startsWith(material.toLowerCase()))
    ?? 'PLA';
}

/** Nozzle, layer height and material a combination prints with. */
export function presetFacts(presets: SlicerPresets, catalog: ProfileCatalog = slicerCatalog) {
  return {
    nozzleMm: numberSetting(catalog, presets.printer, 'nozzle_diameter'),
    layerHeightMm: numberSetting(catalog, presets.process, 'layer_height'),
    material: presetMaterial(presets.filament, catalog),
  };
}

const samePresets = (a: SlicerPresets, b: SlicerPresets) => a.printer === b.printer && a.process === b.process && a.filament === b.filament;

/** Name shown to customers, e.g. "0.20 mm layers, 0.4 mm nozzle, PLA". */
export function variantLabel(facts: Pick<PrintVariant, 'nozzleMm' | 'layerHeightMm' | 'material'>): string {
  const mm = (value: number, digits: number) => formatNumber(value, { minimumFractionDigits: digits, maximumFractionDigits: 2 });
  return t("{0} mm layers, {1} mm nozzle, {2}", mm(facts.layerHeightMm, 2), mm(facts.nozzleMm, 1), facts.material);
}

/** Print time (0.1 min) and filament (0.01 g) of a slicing result. */
export function resultMeasurements(result: Pick<EstimateResult, 'time_s' | 'weight_g'>, material: PrintMaterial): PrintMeasurements {
  return {
    printMinutes: Math.max(0.1, Math.round(result.time_s / 6) / 10),
    filaments: [{ material, grams: Math.max(0.01, Math.round(result.weight_g * 100) / 100) }],
  };
}

export const sameScale = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** One slicing run of a combination; `scale` 1 (default) is the original size. */
export interface SliceRun {
  presets: SlicerPresets;
  scale?: number;
  result: Pick<EstimateResult, 'time_s' | 'weight_g'>;
}

/**
 * Stores fresh slicing results: a combination sliced before keeps its id, name and whether
 * it is offered (its measurements are replaced); new combinations are added and offered.
 * Results at other scales are stored with the variant sliced at the original size; `scales`
 * (the scales of the current run) drops measurements at scales no longer used.
 */
export function mergeSliced(
  slicing: PlateSlicing,
  results: SliceRun[],
  slicedAt = new Date().toISOString(),
  catalog: ProfileCatalog = slicerCatalog,
  scales?: number[],
): PlateSlicing {
  const variants = [...slicing.variants];
  const current = (points: ScaledMeasurements[] | undefined) => (points ?? []).filter((point) => !scales || scales.some((scale) => sameScale(scale, point.scale)));
  for (const { presets, scale = 1, result } of results) {
    const facts = presetFacts(presets, catalog);
    const measurements = resultMeasurements(result, facts.material);
    const sliced = { ...structuredClone(measurements), slicedAt };
    const index = variants.findIndex((variant) => samePresets(variant.presets, presets));
    if (!sameScale(scale, 1)) {
      // Only variants sliced at the original size are priced; a lone scaled result is dropped.
      if (index < 0) continue;
      const points = current(variants[index].scaled).filter((point) => !sameScale(point.scale, scale));
      const scaled = [...points, { scale, measurements, sliced }].sort((a, b) => a.scale - b.scale);
      variants[index] = { ...variants[index], scaled };
      continue;
    }
    if (index >= 0) {
      const { scaled: previous, ...rest } = variants[index];
      const scaled = current(previous);
      variants[index] = { ...rest, ...facts, presets, measurements, sliced, ...(scaled.length > 0 && { scaled }) };
      continue;
    }
    const base = variantLabel(facts);
    const taken = (label: string) => variants.some((variant) => variant.label === label);
    let label = base;
    for (const suffix of [presets.filament, presets.printer]) if (taken(label)) label = `${label} (${suffix})`;
    variants.push({ id: createId('variant'), label, presets, ...facts, measurements, sliced, enabled: true });
  }
  const offered = variants.filter((variant) => variant.enabled);
  const defaultVariantId = offered.some((variant) => variant.id === slicing.defaultVariantId)
    ? slicing.defaultVariantId : offered[0]?.id ?? null;
  return { ...slicing, variants, defaultVariantId };
}

/** Orca option overrides as "key = value" lines (the format `parseOverrides` reads). */
export function formatOverrides(overrides: Record<string, string>): string {
  return Object.entries(overrides).map(([key, value]) => `${key} = ${value}`).join('\n');
}

/** True when the admin changed the measurements the slicer reported. */
export function measurementsEdited(point: Pick<PrintVariant, 'measurements' | 'sliced'>): boolean {
  return Boolean(point.sliced) && JSON.stringify(point.measurements) !== JSON.stringify({ printMinutes: point.sliced!.printMinutes, filaments: point.sliced!.filaments });
}
