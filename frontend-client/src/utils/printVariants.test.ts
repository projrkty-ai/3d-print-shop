import { describe, expect, it } from 'vitest';
import { createSeedProducts } from '../data/seedProducts';
import type { Customization, PlateSlicing, Product } from '../types';
import { defaultCustomization, normalizeCustomization } from './customization';
import { summarizeConfiguration } from './orderLines';
import { calculatePrice, sizePrice, startingPrice } from './pricing';
import { chosenVariant, usesVariantPricing, variantPriceKey } from './printVariants';
import { scaleDimensions } from './sizing';

const variant = (id: string, label = `Variant ${id}`) => ({ id, label, nozzleMm: 0.4, layerHeightMm: 0.2, material: 'PLA' as const, enabled: true });

/** A product as the API sends it to customers: offered variants and their original-size prices, no measurements. */
function published(plates: PlateSlicing[], prices: Record<string, number>): Product {
  const product = createSeedProducts().find((p) => p.id === 'star-vase-set')!;
  return {
    ...product,
    slicing: plates,
    catalogPricing: {
      ratesPerCm3: { PLA: 0.2145, PETG: 0.2184, ABS: 0.2158, ASA: 0.2236, TPU: 0.234, resin: 0.312 }, handlingFee: 5, updatedAt: null,
      variantPrices: prices,
    },
  };
}

const starSet = () => published(
  [
    { plateId: 1, variants: [variant('fine', 'Fine'), variant('fast', 'Fast')], defaultVariantId: 'fast' },
    { plateId: 2, variants: [variant('std', 'Standard')], defaultVariantId: 'std' },
  ],
  { [variantPriceKey(1, 'fine')]: 6.5, [variantPriceKey(1, 'fast')]: 3, [variantPriceKey(2, 'std')]: 1.5 },
);

describe('print variants (customer)', () => {
  it('prices the chosen variants of every plate from the published prices, scaled with the volume', () => {
    const product = starSet();
    expect(usesVariantPricing(product)).toBe(true);
    const defaults = normalizeCustomization(product, defaultCustomization(product));
    expect(defaults.plates?.[1].variantId).toBe('fast');
    expect(sizePrice(product, product.model, defaults).amount).toBe(4.5);
    const fine: Customization = { ...defaults, plates: { ...defaults.plates, 1: { ...defaults.plates![1], variantId: 'fine' } } };
    expect(sizePrice(product, product.model, fine).amount).toBe(8);
    expect(sizePrice(product, scaleDimensions(product.model, 0.5), fine).amount).toBe(1);
    const print = calculatePrice(product, { ...fine, dimensions: product.model }).lines[0];
    expect(print.note).toBe('Vase: Fine ($6.50); Mini vases: Standard ($1.50) at 100% of the original size');
    // the catalog starts from the cheapest variants at the smallest size
    expect(startingPrice(product)).toBeLessThan(sizePrice(product, product.model, defaults).amount);
  });

  it('falls back to the default for a variant the shop no longer offers, and snapshots the choice', () => {
    const product = starSet();
    expect(chosenVariant(product, { id: 1 }, { variantId: 'gone' })?.id).toBe('fast');
    const customization = normalizeCustomization(product, {
      ...defaultCustomization(product), plates: { 1: { ...defaultCustomization(product).plates![1], variantId: 'fine' } },
    });
    const summary = summarizeConfiguration(product, customization);
    expect(summary.plates?.map((plate) => plate.appearance?.printVariant?.label)).toEqual(['Fine', 'Standard']);
    expect(summary.plates?.[0].appearance?.printVariant).not.toHaveProperty('presets');
  });

  it('uses the volume estimate when a plate offers no variant', () => {
    const product = published([{ plateId: 1, variants: [variant('fine')], defaultVariantId: 'fine' }], { [variantPriceKey(1, 'fine')]: 6.5 });
    expect(usesVariantPricing(product)).toBe(false);
    expect(sizePrice(product, product.model).variants).toBeUndefined();
  });
});
