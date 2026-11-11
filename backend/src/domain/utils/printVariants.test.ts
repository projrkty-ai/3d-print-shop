import { describe, expect, it } from 'vitest';
import { createSeedProducts } from '../data/seedProducts';
import type { Customization, PlateSlicing, PrintVariant, Product } from '../types';
import { defaultCustomization, normalizeCustomization } from './customization';
import { summarizeConfiguration } from './orderLines';
import { calculatePrice, catalogPricing, sizePrice, startingPrice } from './pricing';
import { DEFAULT_PRICING } from './projectPricing';
import {
  chosenVariant, interpolatePrice, measurementsPrice, publicSlicing, slicingErrors, usesVariantPricing, variantPriceAt, variantPriceKey,
  variantPrices, variantScalePrices,
} from './printVariants';
import { nearestAllowed, percentScaleRange, printScale, productDimensionsError, scaleRange, scalingErrors } from './scaling';
import { scaleDimensions } from './sizing';
import { validateProduct } from './validation';

/** Sliced at the original size and at the seed products' range ends: time ∝ scale², filament ∝ scale³. */
const variant = (id: string, minutes: number, grams: number, overrides: Partial<PrintVariant> = {}): PrintVariant => ({
  id,
  label: `Variant ${id}`,
  presets: { printer: 'Snapmaker U1 (0.4 nozzle)', process: '0.20 Standard @Snapmaker U1 (0.4 nozzle)', filament: 'Generic PLA @U1 0.4 nozzle' },
  nozzleMm: 0.4,
  layerHeightMm: 0.2,
  material: 'PLA',
  measurements: { printMinutes: minutes, filaments: [{ material: 'PLA', grams }] },
  scaled: [0.5, 0.6, 1.4].map((scale) => ({
    scale, measurements: { printMinutes: minutes * scale ** 2, filaments: [{ material: 'PLA' as const, grams: grams * scale ** 3 }] },
  })),
  enabled: true,
  ...overrides,
});

const plateSlicing = (plateId: number | null, variants: PrintVariant[], defaultVariantId: string | null = variants[0]?.id ?? null): PlateSlicing => ({
  plateId,
  matrix: { printers: ['Snapmaker U1 (0.4 nozzle)'], processes: ['0.20 Standard @Snapmaker U1 (0.4 nozzle)'], filaments: ['Generic PLA @U1 0.4 nozzle'] },
  support: false,
  overrides: {},
  variants,
  defaultVariantId,
});

// hourly rate $2, PLA $25/kg (defaults)
const rates = catalogPricing(DEFAULT_PRICING);

/** Star Vase Set: plates 1 (119.6 cm³) and 2 (51.6 cm³), 171.2 cm³ in total. */
function starSet(): Product {
  const product = createSeedProducts().find((p) => p.id === 'star-vase-set')!;
  return {
    ...product,
    catalogPricing: rates,
    slicing: [
      // 2 h + 100 g → $4 + $2.50; 1 h + 40 g → $2 + $1.00
      plateSlicing(1, [variant('fine', 120, 100), variant('fast', 60, 40)], 'fast'),
      // 30 min + 20 g → $1 + $0.50
      plateSlicing(2, [variant('std', 30, 20), variant('off', 10, 10, { enabled: false })]),
    ],
  };
}

describe('sliced print variants', () => {
  it('prices a variant from its measurements with the shop rates', () => {
    expect(measurementsPrice({ printMinutes: 120, filaments: [{ material: 'PLA', grams: 100 }] }, { hourlyRate: 2, filamentPricePerKg: DEFAULT_PRICING.filamentPricePerKg })).toBe(6.5);
    expect(measurementsPrice({ printMinutes: 90, filaments: [{ material: 'PLA', grams: 10 }, { material: 'TPU', grams: 10 }] },
      { hourlyRate: 4, filamentPricePerKg: DEFAULT_PRICING.filamentPricePerKg })).toBe(6.65);
  });

  it('prices the set from the chosen variants of every plate, scaled with the volume', () => {
    const product = starSet();
    expect(usesVariantPricing(product)).toBe(true);
    const defaults = normalizeCustomization(product, defaultCustomization(product));
    expect(defaults.plates?.[1].variantId).toBe('fast');
    expect(defaults.plates?.[2].variantId).toBe('std');
    // fast $3.00 + std $1.50 at original size
    expect(sizePrice(product, product.model, defaults).amount).toBe(4.5);
    const fine = normalizeCustomization(product, { ...defaults, plates: { ...defaults.plates, 1: { ...defaults.plates![1], variantId: 'fine' } } });
    expect(sizePrice(product, product.model, fine).amount).toBe(8);
    // 60%, sliced: fine 43.2 min + 21.6 g = $1.44 + $0.54, std 10.8 min + 4.32 g = $0.36 + $0.11
    const small = scaleDimensions(product.model, 0.6);
    expect(sizePrice(product, small, fine).amount).toBeCloseTo(2.45, 1);
    expect(sizePrice(product, small, fine).scale).toBeCloseTo(0.6, 3);
    const breakdown = calculatePrice(product, { ...fine, dimensions: product.model });
    expect(breakdown.lines[0].amount).toBe(8);
    expect(breakdown.lines[0].note).toContain('Variant fine');
    // the cheapest variants at the smallest size
    expect(startingPrice(product)).toBeLessThanOrEqual(sizePrice(product, product.model, defaults).amount);
  });

  it('repairs a variant that is no longer offered and snapshots how the shop prints it', () => {
    const product = starSet();
    const customization: Customization = normalizeCustomization(product, {
      ...defaultCustomization(product), plates: { 1: { ...defaultCustomization(product).plates![1], variantId: 'gone' }, 2: { ...defaultCustomization(product).plates![2], variantId: 'off' } },
    });
    expect(customization.plates?.[1].variantId).toBe('fast');
    expect(customization.plates?.[2].variantId).toBe('std');
    expect(chosenVariant(product, { id: 2 }, { variantId: 'off' })?.id).toBe('std');
    const summary = summarizeConfiguration(product, customization);
    expect(summary.printVariant).toBeUndefined();
    expect(summary.plates?.[0].appearance?.printVariant).toMatchObject({
      id: 'fast', label: 'Variant fast', material: 'PLA', support: false,
      presets: { printer: 'Snapmaker U1 (0.4 nozzle)', process: '0.20 Standard @Snapmaker U1 (0.4 nozzle)' },
    });
  });

  it('publishes prices without the shop measurements, presets or disabled variants', () => {
    const product = starSet();
    expect(variantPrices(product)).toEqual({ [variantPriceKey(1, 'fine')]: 6.5, [variantPriceKey(1, 'fast')]: 3, [variantPriceKey(2, 'std')]: 1.5 });
    const published = publicSlicing(product)!;
    expect(published.map((entry) => entry.variants.map((v) => v.id))).toEqual([['fine', 'fast'], ['std']]);
    expect(JSON.stringify(published)).not.toMatch(/measurements|presets|matrix|Snapmaker/);
    // customers price from the published prices
    const customer: Product = { ...product, slicing: published, catalogPricing: { ...rates, hourlyRate: undefined, filamentPricePerKg: undefined, variantPrices: variantPrices(product) } };
    const defaults = normalizeCustomization(customer, defaultCustomization(customer));
    expect(sizePrice(customer, customer.model, defaults).amount).toBe(4.5);
  });

  it('falls back to the volume estimate until every included plate offers a variant', () => {
    const product = starSet();
    const partial = { ...product, slicing: [product.slicing![0]] };
    expect(usesVariantPricing(partial)).toBe(false);
    expect(slicingErrors(partial)).toEqual([expect.stringContaining('Mini vases')]);
    expect(validateProduct(partial)).toContainEqual(expect.stringContaining('every included plate'));
    const nothingOffered = { ...product, slicing: product.slicing!.map((entry) => ({ ...entry, defaultVariantId: null, variants: entry.variants.map((v) => ({ ...v, enabled: false })) })) };
    expect(slicingErrors(nothingOffered)).toEqual([]);
    expect(sizePrice(nothingOffered, product.model).amount).toBe(sizePrice({ ...product, slicing: undefined }, product.model).amount);
  });

  it('reports invalid measurements, names and plates', () => {
    const product = starSet();
    const broken: Product = {
      ...product,
      slicing: [
        plateSlicing(1, [variant('a', 0, 10, { label: ' ' }), variant('a', 10, -1)], 'missing'),
        plateSlicing(7, [variant('b', 10, 10)]),
        plateSlicing(2, [variant('c', 10, 10)]),
      ],
    };
    const errors = slicingErrors(broken);
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('needs a name'),
      expect.stringContaining('print time must be greater than 0'),
      expect.stringContaining('filament weight must be greater than 0'),
      expect.stringContaining('ids must be unique'),
      expect.stringContaining('default print variant'),
      expect.stringContaining('not in the model file'),
    ]));
    expect(slicingErrors({ ...product, mesh: null })).toEqual(['Print variants need a 3D model file.']);
  });

  it('uses one entry for the whole model of a file without plates', () => {
    const vase = createSeedProducts().find((p) => p.id === 'twisted-star-vase')!;
    const product: Product = { ...vase, catalogPricing: rates, slicing: [plateSlicing(null, [variant('a', 60, 50)])] };
    expect(slicingErrors(product)).toEqual([]);
    const defaults = normalizeCustomization(product, defaultCustomization(product));
    expect(defaults.variantId).toBe('a');
    expect(sizePrice(product, product.model, defaults).amount).toBe(3.25);
    expect(summarizeConfiguration(product, defaults).printVariant?.id).toBe('a');
  });
});

describe('scaled print variants', () => {
  it('interpolates prices between the sliced scales along the power law through them', () => {
    const points = [{ scale: 0.5, price: 1 }, { scale: 1, price: 4 }, { scale: 2, price: 32 }];
    expect(interpolatePrice(points, 1)).toBe(4);
    // price ∝ scale² below the original size, ∝ scale³ above it
    expect(interpolatePrice(points, 0.75)).toBeCloseTo(4 * 0.75 ** 2, 9);
    expect(interpolatePrice(points, 1.5)).toBeCloseTo(4 * 1.5 ** 3, 9);
    // beyond the points the nearest segment continues; a single point scales with the volume
    expect(interpolatePrice(points, 0.25)).toBeCloseTo(0.25, 9);
    expect(interpolatePrice([{ scale: 1, price: 8 }], 0.5)).toBe(1);
  });

  it('prices each variant from its measurements at the ends of the range and publishes those prices', () => {
    const product = starSet();
    const fast = product.slicing![0].variants[1];
    // 60 min + 40 g at 100%, 117.6 min + 109.76 g at 140%
    expect(variantPriceAt(product, 1, fast, 1)).toBe(3);
    expect(variantPriceAt(product, 1, fast, 1.4)).toBe(measurementsPrice(fast.scaled![2].measurements, DEFAULT_PRICING));
    const published = variantScalePrices(product);
    expect(published[variantPriceKey(1, 'fast')].map((point) => point.scale)).toEqual([0.5, 0.6, 1.4]);
    expect(published).not.toHaveProperty(variantPriceKey(2, 'off'));
    // customers price from the published points
    const customer: Product = {
      ...product, slicing: publicSlicing(product),
      catalogPricing: { ...rates, hourlyRate: undefined, filamentPricePerKg: undefined, variantPrices: variantPrices(product), variantScalePrices: published },
    };
    const customerFast = customer.slicing![0].variants[1];
    expect(variantPriceAt(customer, 1, customerFast, 1.2)).toBeCloseTo(variantPriceAt(product, 1, fast, 1.2)!, 9);
  });

  it('limits sizes to the shop range and checks the range', () => {
    const product = starSet();
    expect(scaleRange(product)).toEqual({ min: 0.6, max: 1.4 });
    expect(percentScaleRange(product)).toEqual({ min: 60, max: 140 });
    expect(productDimensionsError(product, scaleDimensions(product.model, 0.6))).toBeNull();
    expect(productDimensionsError(product, scaleDimensions(product.model, 0.5))).toBe('Choose a size from 60% to 140% of the original.');
    expect(nearestAllowed(product, scaleDimensions(product.model, 2))).toEqual(scaleDimensions(product.model, 1.4));
    expect(printScale(product, scaleDimensions(product.model, 1.2))).toBeCloseTo(1.2, 3);
    // older products: the printer's limits; fixed-size products: only the original size
    expect(scaleRange({ ...product, scaling: undefined }).max).toBeCloseTo(1.5);
    const fixed = { ...product, scaling: { enabled: false, minScale: 0.6, maxScale: 1.4 } };
    expect(scaleRange(fixed)).toEqual({ min: 1, max: 1 });
    const chosen = normalizeCustomization(fixed, { ...defaultCustomization(fixed), dimensions: scaleDimensions(product.model, 0.7) });
    expect(chosen.dimensions).toEqual({ widthMm: 117.6, depthMm: 95.9, heightMm: 180 });
    expect(scalingErrors(fixed)).toEqual([]);
    expect(scalingErrors({ ...product, scaling: { enabled: true, minScale: 0.01, maxScale: 0.9 } })).toEqual([
      'The smallest scale must be at most 100% and the largest at least 100%, and they must differ.',
      'At the smallest scale every side must be at least 5 mm: use at least 6%.',
    ]);
    expect(scalingErrors({ ...product, scaling: { enabled: true, minScale: Number.NaN, maxScale: 1 } })).toEqual(['Enter the smallest and largest scale in percent.']);
  });

  it('requires offered variants of included plates to be sliced at the ends of the range', () => {
    const product = starSet();
    product.slicing![1].variants[0] = { ...product.slicing![1].variants[0], scaled: [] };
    expect(slicingErrors(product)).toEqual(['Mini vases, Variant std: not sliced at 60%, 140%: slice the variants again after changing the scaling.']);
    expect(slicingErrors({ ...product, scaling: { enabled: false, minScale: 1, maxScale: 1 } })).toEqual([]);
    product.slicing![0].variants[0] = { ...product.slicing![0].variants[0], scaled: [{ scale: 1, measurements: { printMinutes: 1, filaments: [{ material: 'PLA', grams: 1 }] } }] };
    expect(slicingErrors(product)).toContainEqual(expect.stringContaining('Vase, Variant fine: scaled measurements must have distinct scales'));
  });
});
