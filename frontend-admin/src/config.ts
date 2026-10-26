import { locale } from './i18n';

export const SHOP_NAME = 'PrintForge';

export const CURRENCY = 'USD';
export const LOCALE = locale;

/** Printer build volume: no axis of a print may exceed this. */
export const PRINT_MAX_MM = 270;
/** Smallest dimension we'll print on any axis. */
export const PRINT_MIN_MM = 5;

/** Fonts the shop can engrave with. Admins pick a subset per product. */
export const ENGRAVING_FONTS = [
  'Arial',
  'Georgia',
  'Courier New',
  'Impact',
  'Trebuchet MS',
  'Brush Script MT',
] as const;

/** CSS font stack with a generic fallback for systems that lack the named font. */
export function fontStack(font: string): string {
  const generic = /script/i.test(font) ? 'cursive' : /courier/i.test(font) ? 'monospace' : /georgia/i.test(font) ? 'serif' : 'sans-serif';
  return `"${font}", ${generic}`;
}

/** Characters allowed in engraving text (letters, digits, common punctuation). */
export const ENGRAVING_ALLOWED = /^[\p{L}\p{N} .,!?'&\-#@:+]*$/u;

/** Upper bound for the per-product "max lines" setting (more won't fit legibly). */
export const MAX_ENGRAVING_LINES = 5;

export const TEXTURE_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const TEXTURE_MAX_DIMENSION = 512;
export const TEXTURE_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export const MODEL_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const MAX_QUANTITY = 20;
