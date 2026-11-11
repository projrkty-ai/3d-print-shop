import { CURRENCY, LOCALE } from '../config';
import type { ColorOption, Customization, Dimensions, PriceLine, Product, SurfaceCustomization } from '../types';
import { formatDimensions, formatVolume, scaleDimensions, scaledVolumeCm3 } from './sizing';
import { formatScale, printScale, scaleRange } from './scaling';
import { includedProductPlates, plateParts, selectedPlateIds } from './meshPlates';
import { customizationSurfaces, textureOption } from './customization';
import { t } from '../../i18n';
import { PRINT_MATERIALS, type CatalogPricing, type PricingSettings, type PrintMaterial } from '../types';
import { chosenVariant, offeredVariants, surfaceSlicing, usesVariantPricing, variantPriceAt } from './printVariants';

export type { PriceLine };

export interface PriceBreakdown {
  lines: PriceLine[];
  unitPrice: number;
}

const roundCents = (value: number) => Math.round(value * 100) / 100;

/** Estimates: 1.3 g/cm³ density, 30% printed volume, 20 g/hour throughput. */
export function catalogPricing(settings: PricingSettings): CatalogPricing {
  const gramsPerCm3 = 1.3 * 0.3;
  return {
    ratesPerCm3: Object.fromEntries(PRINT_MATERIALS.map((material) => [
      material, gramsPerCm3 / 20 * settings.hourlyRate + gramsPerCm3 / 1000 * settings.filamentPricePerKg[material],
    ])) as CatalogPricing['ratesPerCm3'],
    handlingFee: settings.handlingFee,
    updatedAt: settings.updatedAt,
    hourlyRate: settings.hourlyRate,
    filamentPricePerKg: { ...settings.filamentPricePerKg },
  };
}

/** Catalog rates as customers receive them: without the shop's hourly and per-kilogram rates. */
export function publicCatalogPricing({ hourlyRate: _hourly, filamentPricePerKg: _perKg, ...pricing }: CatalogPricing): CatalogPricing {
  return pricing;
}

/** Free-text names like "PLA+ (multi-color)" map to standard materials; unknown names use PLA. */
export function catalogMaterial(name: string): PrintMaterial {
  return PRINT_MATERIALS.find((material) => new RegExp(`\\b${material}\\b`, 'i').test(name)) ?? 'PLA';
}

/**
 * Current catalog rate, or the legacy base price minus fixed fee divided by original volume.
 */
export function pricePerCm3(product: Product): number {
  if (product.catalogPricing) return product.catalogPricing.ratesPerCm3[catalogMaterial(product.material)];
  return (product.basePrice - product.fixedFee) / product.model.volumeCm3;
}

export interface SizePrice {
  volumeCm3: number;
  /** Rounded print price, excluding order handling for dynamic catalog products. */
  amount: number;
  /** Sliced pricing: the print variant of every priced plate (or of the model) and its price at this size. */
  variants?: { plate: string | null; label: string; price: number }[];
  /** Uniform scale of the print (1 = original size). */
  scale?: number;
}

/**
 * Bare print at the selected volume; only legacy products include a per-print fixed fee.
 * Products with sliced print variants cost the chosen variants' prices at the print's scale,
 * interpolated between the scales they were sliced at (the default variants when no
 * customization is given).
 */
export function sizePrice(product: Product, dims: Dimensions, customization?: Customization): SizePrice {
  const volumeCm3 = scaledVolumeCm3(product.model, dims);
  if (usesVariantPricing(product)) {
    const scale = printScale(product, dims);
    const variants = customizationSurfaces(product, customization ?? ({} as Customization)).map(({ plate, choices }) => {
      const variant = chosenVariant(product, plate, choices ?? {});
      const price = variant ? variantPriceAt(product, plate?.id ?? null, variant, scale) ?? 0 : 0;
      return { plate: plate?.name ?? null, label: variant?.label ?? '', price: roundCents(price) };
    });
    return { volumeCm3, amount: roundCents(variants.reduce((sum, variant) => sum + variant.price, 0)), variants, scale };
  }
  if (product.catalogPricing) return { volumeCm3, amount: roundCents(volumeCm3 * pricePerCm3(product)) };
  // Same as volume × pricePerCm3, but dividing last keeps exact cases (e.g. 50% → $8.375) exact.
  const material = ((product.basePrice - product.fixedFee) * volumeCm3) / product.model.volumeCm3;
  return { volumeCm3, amount: roundCents(product.fixedFee + material) };
}

/** Explains a print price, e.g. "$5.00 fixed fee + 11.9 cm³ × $0.284/cm³". */
export function describeSizePrice(product: Product, price: SizePrice): string {
  if (price.variants) {
    const variants = price.variants.map(({ plate, label, price: amount }) => `${plate ? `${plate}: ` : ''}${label} (${formatPrice(amount)})`);
    return t('variantPriceNote', variants.join('; '), formatScale(price.scale ?? 1));
  }
  const material = `${formatVolume(price.volumeCm3)} × ${formatRate(pricePerCm3(product))}`;
  return !product.catalogPricing && product.fixedFee > 0 ? t('fixedPrice', formatPrice(product.fixedFee), material) : material;
}

/** Expects dimensions that already passed `validateDimensions`. */
export function calculatePrice(product: Product, customization: Customization): PriceBreakdown {
  const print = sizePrice(product, customization.dimensions, customization);
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

  const textures = surfaces.flatMap(({ choices }) => {
    const option = textureOption(product, choices.textureId);
    return option ? [{ name: option.name, library: true }]
      : product.texture.enabled && choices.textureDataUrl ? [{ name: t('customPicture'), library: false }] : [];
  });
  if (textures.length > 0) {
    // Name the chosen shop textures; legacy orders with only an uploaded picture keep a plain line.
    const note = textures.some(({ library }) => library) ? [...new Set(textures.map(({ name }) => name))].join(', ') : undefined;
    lines.push({ label: t('pictureTexture'), amount: product.texture.price, ...(note && { note }) });
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
  const smallestDims = scaleDimensions(product.model, scaleRange(product).min);
  // Sliced products start with the cheapest offered variant of every plate.
  const cheapest = usesVariantPricing(product)
    ? customizationSurfaces(product, {} as Customization).reduce<Customization>((choices, { plate }) => {
      const offered = offeredVariants(surfaceSlicing(product, plate));
      const price = (id: string) => variantPriceAt(product, plate?.id ?? null, offered.find((v) => v.id === id)!, 1) ?? Infinity;
      const best = offered.map((variant) => variant.id).sort((a, b) => price(a) - price(b))[0];
      return plate ? { ...choices, plates: { ...choices.plates, [plate.id]: { variantId: best } as SurfaceCustomization } } : { ...choices, variantId: best };
    }, {} as Customization)
    : undefined;
  const smallest = sizePrice(product, smallestDims, cheapest);
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
