import { describe, expect, it } from 'vitest';
import { createSeedProducts } from '../data/seedProducts';
import type { CatalogPricing, Customization, PlateSlicing, PrintVariant, Product } from '../types';
import { defaultCustomization, normalizeCustomization } from './customization';
import { summarizeConfiguration } from './orderLines';
import { calculatePrice, sizePrice, startingPrice } from './pricing';
import {
  chosenVariant, measurementsPrice, publicSlicing, slicingErrors, usesVariantPricing, variantPriceKey, variantPrices,
} from './printVariants';
import { scaleDimensions } from './sizing';
import { validateProduct } from './validation';

const variant = (id: string, minutes: number, grams: number, overrides: Partial<PrintVariant> = {}): PrintVariant => ({
  id,
  label: `Variant ${id}`,
  presets: { printer: 'Snapmaker U1 (0.4 nozzle)', process: '0.20 Standard @Snapmaker U1 (0.4 nozzle)', filament: 'Generic PLA @U1 0.4 nozzle' },
  nozzleMm: 0.4,
  layerHeightMm: 0.2,
  material: 'PLA',
  measurements: { printMinutes: minutes, filaments: [{ material: 'PLA', grams }] },
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

// The shop's default rates: $2 per hour, PLA $25/kg.
const DEFAULT_PRICING = { hourlyRate: 2, filamentPricePerKg: { PLA: 25, PETG: 28, ABS: 26, ASA: 32, TPU: 40, resin: 60 } };
const rates: CatalogPricing = {
  ratesPerCm3: { PLA: 0.2145, PETG: 0.2184, ABS: 0.2158, ASA: 0.2236, TPU: 0.234, resin: 0.312 },
  handlingFee: 5,
  updatedAt: null,
  ...DEFAULT_PRICING,
};

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
    // half size: 1/8 of the volume
    const half = scaleDimensions(product.model, 0.5);
    expect(sizePrice(product, half, fine).amount).toBeCloseTo(1, 2);
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
