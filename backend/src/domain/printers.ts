import { t } from '../i18n';
import type { PrinterInput, PrinterModelInput, PrinterModelTemplate } from './types';

/** Bounds of printer and model fields, checked by `validatePrinter` and `validatePrinterModel` (the admin shows the same limits). */
export const PRINTER_LIMITS = {
  name: 80,
  model: 120,
  manufacturer: 80,
  location: 200,
  notes: 2000,
  /** Build volume per axis, in millimeters (the largest hobby and industrial FDM printers). */
  plateMm: { min: 1, max: 5000 },
  maxColors: 64,
  /** Entries of a profile archive that are listed with the model. */
  profileEntries: 200,
  /** Preset names of each type that are listed with the model. */
  profilePresets: 100,
} as const;

/** Largest profile archive (ZIP) the admin can upload for a printer model. */
export const PRINTER_PROFILES_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

type CatalogEntry = [manufacturer: string, name: string, widthMm: number, depthMm: number, heightMm: number, maxColors: number];

/**
 * Common desktop FDM printers with their build volumes and the number of filaments one job can
 * use with the usual multi-material unit (or 1 for a single extruder). The admin can start a new
 * printer model from one; every value can still be changed on the model.
 */
const CATALOG: CatalogEntry[] = [
  ['Anycubic', 'Anycubic Kobra 2', 220, 220, 250, 1],
  ['Anycubic', 'Anycubic Kobra 3', 250, 250, 260, 4],
  ['Bambu Lab', 'Bambu Lab A1', 256, 256, 256, 4],
  ['Bambu Lab', 'Bambu Lab A1 mini', 180, 180, 180, 4],
  ['Bambu Lab', 'Bambu Lab H2D', 350, 320, 325, 4],
  ['Bambu Lab', 'Bambu Lab P1P', 256, 256, 256, 1],
  ['Bambu Lab', 'Bambu Lab P1S', 256, 256, 256, 4],
  ['Bambu Lab', 'Bambu Lab X1 Carbon', 256, 256, 256, 4],
  ['Creality', 'Creality Ender-3 V3', 220, 220, 250, 1],
  ['Creality', 'Creality Ender-3 V3 SE', 220, 220, 250, 1],
  ['Creality', 'Creality K1', 220, 220, 250, 1],
  ['Creality', 'Creality K1 Max', 300, 300, 300, 1],
  ['Creality', 'Creality K2 Plus', 350, 350, 350, 4],
  ['Elegoo', 'Elegoo Centauri Carbon', 256, 256, 256, 1],
  ['Elegoo', 'Elegoo Neptune 4', 225, 225, 265, 1],
  ['Elegoo', 'Elegoo Neptune 4 Pro', 225, 225, 265, 1],
  ['Flashforge', 'Flashforge Adventurer 5M', 220, 220, 220, 1],
  ['Prusa Research', 'Prusa CORE One', 250, 220, 270, 1],
  ['Prusa Research', 'Prusa MINI+', 180, 180, 180, 1],
  ['Prusa Research', 'Prusa MK3S+', 250, 210, 210, 1],
  ['Prusa Research', 'Prusa MK4S', 250, 210, 220, 1],
  ['Prusa Research', 'Prusa XL', 360, 360, 360, 5],
  ['Qidi', 'Qidi X-Max 3', 325, 325, 315, 1],
  // The printer family of the bundled slicer profiles (a four-tool changer).
  ['Snapmaker', 'Snapmaker U1', 270, 270, 270, 4],
  ['Sovol', 'Sovol SV06', 220, 220, 250, 1],
];

export const PRINTER_MODEL_TEMPLATES: readonly PrinterModelTemplate[] = CATALOG
  .map(([manufacturer, name, widthMm, depthMm, heightMm, maxColors]) => ({ name, manufacturer, plate: { widthMm, depthMm, heightMm }, maxColors }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Names of printers and of models are unique ignoring case and surrounding whitespace. */
export const printerNameKey = (name: string) => name.trim().toLowerCase();

const wholeNumber = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;
const inRange = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;

/** Business rules of a printer model, reported all at once: a name, a sensible build volume and color count. */
export function validatePrinterModel(input: PrinterModelInput): string[] {
  const problems: string[] = [];
  const { min, max } = PRINTER_LIMITS.plateMm;
  if (!input.name.trim() || input.name.trim().length > PRINTER_LIMITS.model) problems.push(t('printerModelName', PRINTER_LIMITS.model));
  if (input.manufacturer.trim().length > PRINTER_LIMITS.manufacturer) problems.push(t('printerManufacturer', PRINTER_LIMITS.manufacturer));
  if (![input.plate.widthMm, input.plate.depthMm, input.plate.heightMm].every((value) => inRange(value, min, max))) {
    problems.push(t('printerPlate', min, max));
  }
  if (!wholeNumber(input.maxColors, 1, PRINTER_LIMITS.maxColors)) problems.push(t('printerColors', PRINTER_LIMITS.maxColors));
  return problems;
}

/** Business rules of a printer: a name and a model (that the route checks exists), and short texts. */
export function validatePrinter(input: PrinterInput): string[] {
  const problems: string[] = [];
  if (!input.name.trim() || input.name.trim().length > PRINTER_LIMITS.name) problems.push(t('printerName', PRINTER_LIMITS.name));
  if (!input.modelId.trim()) problems.push(t('printerModelRequired'));
  if (input.location.trim().length > PRINTER_LIMITS.location) problems.push(t('printerLocation', PRINTER_LIMITS.location));
  if (input.notes.length > PRINTER_LIMITS.notes) problems.push(t('printerNotes', PRINTER_LIMITS.notes));
  return problems;
}

/** The model input with its texts trimmed and its sizes rounded to a hundredth of a millimeter. */
export function normalizePrinterModelInput(input: PrinterModelInput): PrinterModelInput {
  const mm = (value: number) => Math.round(value * 100) / 100;
  return {
    name: input.name.trim(),
    manufacturer: input.manufacturer.trim(),
    plate: { widthMm: mm(input.plate.widthMm), depthMm: mm(input.plate.depthMm), heightMm: mm(input.plate.heightMm) },
    maxColors: input.maxColors,
  };
}

/** The printer input with its texts trimmed. */
export function normalizePrinterInput(input: PrinterInput): PrinterInput {
  return { name: input.name.trim(), modelId: input.modelId.trim(), location: input.location.trim(), notes: input.notes.trim() };
}
