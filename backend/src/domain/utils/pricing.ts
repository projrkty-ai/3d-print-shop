import { CURRENCY, LOCALE } from '../config';
import type { ColorOption, Customization, Dimensions, PriceLine, Product, SurfaceCustomization } from '../types';
import { formatDimensions, formatVolume, minUniformScale, scaleDimensions, scaledVolumeCm3 } from './sizing';
import { includedProductPlates, plateParts, selectedPlateIds } from './meshPlates';
import { customizationSurfaces } from './customization';
import { t } from '../../i18n';

export type { PriceLine };

export interface PriceBreakdown {
  lines: PriceLine[];
  unitPrice: number;
}

const roundCents = (value: number) => Math.round(value * 100) / 100;

/**
 * Material rate: the part of the original-size price not covered by the fixed fee,
 * spread over the base model's volume. This keeps the original size at exactly the base price.
 */
export function pricePerCm3(product: Product): number {
  return (product.basePrice - product.fixedFee) / product.model.volumeCm3;
}

export interface SizePrice {
  volumeCm3: number;
  /** Fixed fee + material, rounded to cents. */
  amount: number;
}

/** Price of the bare print at the given size: fixed fee + material volume × rate. */
export function sizePrice(product: Product, dims: Dimensions): SizePrice {
  const volumeCm3 = scaledVolumeCm3(product.model, dims);
  // Same as volume × pricePerCm3, but dividing last keeps exact cases (e.g. 50% → $8.375) exact.
  const material = ((product.basePrice - product.fixedFee) * volumeCm3) / product.model.volumeCm3;
  return { volumeCm3, amount: roundCents(product.fixedFee + material) };
}

/** Explains a print price, e.g. "$5.00 fixed fee + 11.9 cm³ × $0.284/cm³". */
export function describeSizePrice(product: Product, price: SizePrice): string {
  const material = `${formatVolume(price.volumeCm3)} × ${formatRate(pricePerCm3(product))}`;
  return product.fixedFee > 0 ? t('fixedPrice', formatPrice(product.fixedFee), material) : material;
}

/** Expects dimensions that already passed `validateDimensions`. */
export function calculatePrice(product: Product, customization: Customization): PriceBreakdown {
  const print = sizePrice(product, customization.dimensions);
  const plateCount = product.mesh ? selectedPlateIds(product.mesh).length : 0;
  const lines: PriceLine[] = [
    {
      label: plateCount > 1
        ? t('printSet', plateCount, formatDimensions(customization.dimensions))
        : t('printDimensions', formatDimensions(customization.dimensions)),
      amount: print.amount,
      note: describeSizePrice(product, print),
    },
  ];

  lines.push(...colorLines(product, customization));

  const surfaces = customizationSurfaces(product, customization);
  if (product.engraving.enabled && surfaces.some(({ choices }) => choices.engravingText.trim() !== '')) {
    lines.push({ label: t('engraving'), amount: product.engraving.price });
    const textColors = surfaces.flatMap(({ choices }) => {
      const color = engravingColor(product, choices);
      return color ? [color.name] : [];
    });
    if (textColors.length > 0 && product.engraving.colorPrice > 0) {
      lines.push({ label: t('coloredEngraving'), amount: product.engraving.colorPrice, note: [...new Set(textColors)].join(', ') });
    }
  }

  if (product.texture.enabled && surfaces.some(({ choices }) => choices.textureDataUrl)) {
    lines.push({ label: t('pictureTexture'), amount: product.texture.price });
  }

  const unitPrice = roundCents(lines.reduce((sum, line) => sum + line.amount, 0));
  return { lines, unitPrice };
}

/** The filament the engraved letters are filled with, or null for plain engraving in the print color. */
export function engravingColor(product: Product, customization: SurfaceCustomization): ColorOption | null {
  const { enabled, colorChoice } = product.engraving;
  if (!enabled || !colorChoice || customization.engravingText.trim() === '') return null;
  return product.colors.find((c) => c.id === customization.engravingColorId) ?? null;
}

/** Label for the whole print's filament in single-color models. */
const PRINT = t('print');

/**
 * Filament surcharges, each charged once however many things use that filament:
 * the print (single-color models) or each recolored part (multi-color models; parts left in
 * their file color cost nothing extra), plus the engraving's text color.
 */
function colorLines(product: Product, customization: Customization): PriceLine[] {
  const usage = new Map<string, string[]>();
  const use = (colorId: string | undefined, user: string) => {
    if (colorId) usage.set(colorId, [...(usage.get(colorId) ?? []), user]);
  };
  for (const { plate, choices, parts } of customizationSurfaces(product, customization)) {
    const label = (name: string) => plate ? `${plate.name}: ${name}` : name;
    if (parts.length === 0) use(choices.colorId, label(PRINT));
    else parts.forEach((part) => use(choices.partColors[part.key], label(part.name)));
    use(engravingColor(product, choices)?.id, label(t('engraving')));
  }

  return product.colors.flatMap((color) => {
    const users = usage.get(color.id);
    if (!users || color.priceDelta === 0) return [];
    // A single-color print needs no note unless the filament is also used elsewhere.
    const note = users.length === 1 && users[0] === PRINT ? undefined : users.join(', ');
    return [{ label: t('color', color.name), amount: color.priceDelta, ...(note && { note }) }];
  });
}

/** Lowest price a customer can pay for the product (smallest size, cheapest color choice). */
export function startingPrice(product: Product): number {
  const smallest = sizePrice(product, scaleDimensions(product.model, minUniformScale(product.model)));
  const deltas = product.colors.map((c) => c.priceDelta);
  // Multi-color models can keep their file colors at no extra cost.
  const plates = includedProductPlates(product);
  const canKeepAllOriginal = plates.length > 0
    ? plates.every((plate) => plateParts(product, plate).length > 0)
    : Boolean(product.mesh?.parts.length);
  const cheapestColor = canKeepAllOriginal ? Math.min(0, ...deltas) : deltas.length ? Math.min(...deltas) : 0;
  return roundCents(smallest.amount + cheapestColor);
}

const formatter = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY });

export function formatPrice(amount: number): string {
  return formatter.format(amount);
}

const rateFormatter = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

/** Price per cm³; shows a third decimal because rates are often fractions of a cent. */
export function formatRate(amountPerCm3: number): string {
  return `${rateFormatter.format(amountPerCm3)}/cm³`;
}

export function formatDelta(amount: number): string {
  if (amount === 0) return '';
  return `${amount > 0 ? '+' : '−'}${formatPrice(Math.abs(amount))}`;
}
