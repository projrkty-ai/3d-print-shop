import { LOCALE } from '../config';

const sizeFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });

/** File sizes as customers know them, e.g. "820 KB" or "12.5 MB". */
export function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${sizeFormat.format(bytes / 1024)} KB` : `${sizeFormat.format(bytes / 1024 / 1024)} MB`;
}

/**
 * Millimeters for print settings: nozzles as "0.4 mm", layer heights with two decimals
 * ("0.20 mm", as slicers show them).
 */
export function formatMm(value: number, minimumFractionDigits = 1): string {
  return `${new Intl.NumberFormat(LOCALE, { minimumFractionDigits, maximumFractionDigits: 3 }).format(value)} mm`;
}
