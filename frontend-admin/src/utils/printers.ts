import { t } from '../i18n';
import type { Dimensions, PrinterInput, PrinterModelInput } from '../types';

/** Bounds of printer and model fields, as the server checks them. */
export const PRINTER_LIMITS = {
  name: 80,
  model: 120,
  manufacturer: 80,
  location: 200,
  notes: 2000,
  plateMm: { min: 1, max: 5000 },
  maxColors: 64,
} as const;

/** Largest profile archive (ZIP) the server accepts. */
export const PRINTER_PROFILES_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** File types offered in the profile picker: plain ZIPs and OrcaSlicer printer exports (also ZIPs). */
export const PRINTER_PROFILES_ACCEPT = '.zip,.orca_printer,application/zip,application/x-zip-compressed';

const ZIP_NAME = /\.(zip|orca_printer)$/i;

/** Whether the picked file looks like a ZIP archive by name or type (the server checks the contents). */
export function isZipFile(file: { name: string; type: string }): boolean {
  return ZIP_NAME.test(file.name) || ['application/zip', 'application/x-zip-compressed'].includes(file.type);
}

/** Whether another entry already has this name (names are unique ignoring case and surrounding spaces). */
const nameTaken = (name: string, others: { name: string }[]) =>
  others.some((other) => other.name.trim().toLowerCase() === name.trim().toLowerCase());

const inRange = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;

/** Problems with a printer model, reported all at once; mirrors the server's checks. */
export function validatePrinterModel(input: PrinterModelInput, others: { name: string }[] = []): string[] {
  const problems: string[] = [];
  const { min, max } = PRINTER_LIMITS.plateMm;
  const name = input.name.trim();
  if (!name || name.length > PRINTER_LIMITS.model) problems.push(t("Enter the model name (up to {0} characters).", PRINTER_LIMITS.model));
  else if (nameTaken(name, others)) problems.push(t("A printer model named \"{0}\" already exists. Model names must be unique.", name));
  if (input.manufacturer.trim().length > PRINTER_LIMITS.manufacturer) problems.push(t("The manufacturer can have at most {0} characters.", PRINTER_LIMITS.manufacturer));
  if (![input.plate.widthMm, input.plate.depthMm, input.plate.heightMm].every((value) => inRange(value, min, max))) {
    problems.push(t("Print plate width, depth and height must be between {0} and {1} mm.", min, max));
  }
  if (!Number.isInteger(input.maxColors) || input.maxColors < 1 || input.maxColors > PRINTER_LIMITS.maxColors) {
    problems.push(t("Max colors must be a whole number from 1 to {0}.", PRINTER_LIMITS.maxColors));
  }
  return problems;
}

/** Problems with a printer, reported all at once; mirrors the server's checks. */
export function validatePrinter(input: PrinterInput, others: { name: string }[] = []): string[] {
  const problems: string[] = [];
  const name = input.name.trim();
  if (!name || name.length > PRINTER_LIMITS.name) problems.push(t("Enter a name for the printer (up to {0} characters).", PRINTER_LIMITS.name));
  else if (nameTaken(name, others)) problems.push(t("A printer named \"{0}\" already exists. Names must be unique.", name));
  if (!input.modelId) problems.push(t("Choose the printer model."));
  if (input.location.trim().length > PRINTER_LIMITS.location) problems.push(t("The location can have at most {0} characters.", PRINTER_LIMITS.location));
  if (input.notes.length > PRINTER_LIMITS.notes) problems.push(t("Notes can have at most {0} characters.", PRINTER_LIMITS.notes));
  return problems;
}

export const emptyPlate = (): Dimensions => ({ widthMm: NaN, depthMm: NaN, heightMm: NaN });
