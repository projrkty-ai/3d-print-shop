import profiles from '../slicer/engine/profiles.json';
import type { ProfilePreset } from '../slicer/engine/index.mjs';
import { buildCatalog, type ProfileCatalog } from '../slicer/profileCatalog';
import type { CustomerSlicingProfile, FilamentColor, FilamentType, PrintSettings } from '../types';

/** Part key of models without colors of their own. */
export const SINGLE_PART_KEY = 'model';

/** The bundled OrcaSlicer presets (the same as the shop's). */
export const slicerCatalog: ProfileCatalog = buildCatalog(profiles as ProfilePreset[]);

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

/** What the customer chose for one model: the slicing profile and scale, and a filament type and color per part. */
export interface ModelOptions {
  profile: CustomerSlicingProfile;
  parts: Record<string, PartChoice>;
}

/** Scales customers may choose (the shop checks the same range). */
export const SCALE_RANGE = { min: 0.01, max: 10 } as const;

/**
 * The presets customers can combine: the shop's offer, limited to printers with at least one
 * offered process and filament made for them.
 */
export function offeredPresets(settings: PrintSettings, catalog: ProfileCatalog = slicerCatalog) {
  const offered = settings.profiles ?? { printers: catalog.printers, processes: catalog.printers.flatMap(catalog.processesFor), filaments: catalog.printers.flatMap(catalog.filamentsFor) };
  const processesFor = (printer: string) => catalog.processesFor(printer).filter((process) => offered.processes.includes(process));
  const filamentsFor = (printer: string) => catalog.filamentsFor(printer).filter((filament) => offered.filaments.includes(filament));
  const printers = offered.printers.filter((printer) => catalog.printers.includes(printer) && processesFor(printer).length > 0 && filamentsFor(printer).length > 0);
  return { printers, processesFor, filamentsFor };
}

/**
 * A profile valid for the shop's offer: the chosen presets while offered and made for the printer,
 * else the defaults — the 0.4 mm nozzle printer (or the first), its default process and filament.
 */
export function resolveProfile(profile: Partial<CustomerSlicingProfile> | null | undefined, settings: PrintSettings, catalog: ProfileCatalog = slicerCatalog): CustomerSlicingProfile | null {
  const { printers, processesFor, filamentsFor } = offeredPresets(settings, catalog);
  const printer = printers.find((name) => name === profile?.printer)
    ?? printers.find((name) => name.includes('(0.4 nozzle)')) ?? printers[0];
  if (!printer) return null;
  const pick = (list: string[], wanted: string | undefined, preferred: string | undefined) =>
    list.find((name) => name === wanted) ?? list.find((name) => name === preferred) ?? list[0];
  const scale = typeof profile?.scale === 'number' && Number.isFinite(profile.scale)
    ? Math.min(SCALE_RANGE.max, Math.max(SCALE_RANGE.min, profile.scale))
    : 1;
  return {
    printer,
    process: pick(processesFor(printer), profile?.process, catalog.defaultProcess(printer)),
    filament: pick(filamentsFor(printer), profile?.filament, catalog.defaultFilament(printer)),
    support: profile?.support ?? false,
    scale,
  };
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
 * defaults — the default profile at the model's own size, the first filament, and the color nearest
 * the part's own color. Null when the shop offers no profile at all.
 */
export function resolveOptions(parts: ModelPart[], options: ModelOptions | null, settings: PrintSettings, catalog: ProfileCatalog = slicerCatalog): ModelOptions | null {
  const profile = resolveProfile(options?.profile, settings, catalog);
  if (!profile) return null;
  const chosen = Object.fromEntries(parts.map((part): [string, PartChoice] => {
    const choice = options?.parts[part.key];
    const filament = settings.filaments.find((f) => f.id === choice?.filamentId) ?? settings.filaments[0];
    const color = filament.colors.find((c) => c.id === choice?.colorId && filament.id === choice?.filamentId)
      ?? nearestColor(part.fileColor, filament.colors);
    return [part.key, { filamentId: filament.id, colorId: color.id }];
  }));
  return { profile, parts: chosen };
}

/** A part's choice with the filament and color it names (assumes resolved options). */
export function partSelection(settings: PrintSettings, choice: PartChoice): { filament: FilamentType; color: FilamentColor } {
  const filament = settings.filaments.find((f) => f.id === choice.filamentId) ?? settings.filaments[0];
  return { filament, color: filament.colors.find((c) => c.id === choice.colorId) ?? filament.colors[0] };
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

/** Nozzle diameter and layer height of a profile (from its presets). */
export function profileFacts(profile: Pick<CustomerSlicingProfile, 'printer' | 'process'>, catalog: ProfileCatalog = slicerCatalog) {
  const number = (value: unknown) => Number.parseFloat(String(Array.isArray(value) ? value[0] : value ?? ''));
  return { nozzleMm: number(catalog.setting(profile.printer, 'nozzle_diameter')), layerHeightMm: number(catalog.setting(profile.process, 'layer_height')) };
}

/** The estimated price of one copy: customers see only this price, never print times, weights or rates. */
export interface Estimate {
  unitPrice: number;
}
