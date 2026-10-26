import { describe, expect, it } from 'vitest';
import { createSeedProducts } from '../data/seedProducts';
import type { Customization, Dimensions, Product } from '../types';
import { defaultCustomization, normalizeCustomization } from './customization';
import { calculatePrice, pricePerCm3, sizePrice, startingPrice } from './pricing';

// Spiral Vase: 110 × 110 × 200 mm, 95 cm³, $32 at original size, $5 fixed fee
// → the remaining $27 is spread over 95 cm³ = $0.284/cm³.
const vase = (): Product => createSeedProducts().find((p) => p.id === 'spiral-vase')!;
const dims = (widthMm: number, depthMm: number, heightMm: number): Dimensions => ({ widthMm, depthMm, heightMm });

describe('sizePrice', () => {
  it('spreads the price minus the fixed fee over the base volume', () => {
    expect(pricePerCm3(vase())).toBeCloseTo(27 / 95);
  });

  it('charges exactly the base price at the original size', () => {
    expect(sizePrice(vase(), dims(110, 110, 200))).toEqual({ volumeCm3: 95, amount: 32 });
  });

  it('adds the material for the scaled volume to the fixed fee', () => {
    expect(sizePrice(vase(), dims(55, 55, 100)).amount).toBe(8.38); // 50%: 5 + 27 × 0.125 = 8.375
    expect(sizePrice(vase(), dims(69.3, 69.3, 126)).amount).toBe(11.75); // 63%: 5 + 27 × 0.25 ≈ 11.75
    expect(sizePrice(vase(), dims(137.5, 137.5, 250)).amount).toBe(57.73); // 125%: 5 + 27 × 1.953125
  });

  it('has no flat stretch: never drops, and rises with every 1% step once that step is worth a cent', () => {
    const priceAt = (percent: number) => {
      const f = percent / 100;
      return sizePrice(vase(), dims(110 * f, 110 * f, 200 * f)).amount;
    };
    for (let percent = 6; percent <= 135; percent++) {
      expect(priceAt(percent)).toBeGreaterThanOrEqual(priceAt(percent - 1));
      // Below ~11% the material for a 1% step costs under a cent, so neighbours can round equal.
      if (percent >= 15) expect(priceAt(percent)).toBeGreaterThan(priceAt(percent - 1));
    }
  });

  it('never charges less than the fixed fee', () => {
    expect(sizePrice(vase(), dims(5, 5, 9.1)).amount).toBe(5);
  });

  it('is pure volume pricing with no fee, and flat with a fee equal to the base price', () => {
    expect(sizePrice({ ...vase(), fixedFee: 0 }, dims(55, 55, 100)).amount).toBe(4);
    expect(sizePrice({ ...vase(), fixedFee: 32 }, dims(55, 55, 100)).amount).toBe(32);
  });

  it('rounds to whole cents', () => {
    expect(sizePrice(vase(), dims(111, 110, 200)).amount).toBe(32.25); // 5 + 27 × 111/110 = 32.2454…
  });
});

describe('calculatePrice', () => {
  it('itemizes the print, color, engraving and texture', () => {
    const product = vase();
    const c: Customization = {
      dimensions: dims(110, 110, 200),
      colorId: 'gold',
      partColors: {},
      engravingText: 'Anna',
      engravingFont: 'Georgia',
      engravingColorId: null,
      textureDataUrl: 'data:image/jpeg;base64,xyz',
    };
    const { lines, unitPrice } = calculatePrice(product, c);
    expect(unitPrice).toBe(32 + 3 + 5 + 7);
    expect(lines.map((l) => l.label)).toEqual([
      'Print 110 × 110 × 200 mm',
      'Color: Silk Gold',
      'Engraving',
      'Picture texture',
    ]);
  });

  it('explains the print price as fee + material', () => {
    const product = vase();
    const half = { ...defaultCustomization(product), dimensions: dims(55, 55, 100) };
    expect(calculatePrice(product, half).lines[0].note).toBe('$5.00 fixed fee + 11.9 cm³ × $0.284/cm³');
    const noFee = { ...product, fixedFee: 0 };
    expect(calculatePrice(noFee, half).lines[0].note).toBe('11.9 cm³ × $0.337/cm³');
  });

  it('ignores whitespace-only engraving and disabled options', () => {
    const product = { ...vase(), texture: { enabled: false, price: 7 } };
    const c = { ...defaultCustomization(product), engravingText: ' \n ', textureDataUrl: 'data:x' };
    expect(calculatePrice(product, c).unitPrice).toBe(32);
  });
});

describe('startingPrice', () => {
  it('uses the smallest printable size and the cheapest color', () => {
    const product = vase();
    expect(startingPrice(product)).toBe(5);
    product.colors[0] = { ...product.colors[0], priceDelta: -2 };
    expect(startingPrice(product)).toBe(3);
  });
});

describe('multi-color models', () => {
  const tricolor = (): Product => ({
    ...vase(),
    mesh: {
      url: '/models/x.3mf',
      format: '3mf',
      fileName: 'x.3mf',
      sizeBytes: 1,
      triangleCount: 12,
      parts: [
        { key: 'base', name: 'Base', fileColor: '#2b2b2e' },
        { key: 'body', name: 'Body', fileColor: '#1f8a8a' },
        { key: 'rim', name: 'Rim', fileColor: '#c9a227' },
      ],
      plates: [],
      plate: null,
    },
  });
  const original = dims(110, 110, 200);

  it('charges nothing extra for the colors from the file', () => {
    const product = tricolor();
    expect(calculatePrice(product, defaultCustomization(product)).unitPrice).toBe(32);
  });

  it('ignores the single-color choice when the model has parts', () => {
    const product = tricolor();
    const c = { ...defaultCustomization(product), colorId: 'gold' };
    expect(calculatePrice(product, c).unitPrice).toBe(32);
  });

  it('charges each premium filament once, listing the parts that use it', () => {
    const product = tricolor();
    const c = {
      ...defaultCustomization(product),
      dimensions: original,
      partColors: { base: 'gold', rim: 'gold', body: 'marble' }, // gold +$3, marble +$2
    };
    const { lines, unitPrice } = calculatePrice(product, c);
    expect(unitPrice).toBe(32 + 3 + 2);
    expect(lines.slice(1)).toEqual([
      { label: 'Color: Silk Gold', amount: 3, note: 'Base, Rim' },
      { label: 'Color: Marble Grey', amount: 2, note: 'Body' },
    ]);
  });

  it('starts at no color surcharge, since the file colors are free', () => {
    const product = tricolor();
    product.colors = product.colors.map((c) => ({ ...c, priceDelta: 2 }));
    expect(startingPrice(product)).toBe(5);
  });

  it('drops part choices for removed parts or colors that are no longer offered', () => {
    const product = tricolor();
    const c = { ...defaultCustomization(product), partColors: { base: 'gold', body: 'discontinued', gone: 'red' } };
    expect(normalizeCustomization(product, c).partColors).toEqual({ base: 'gold' });
  });
});

describe('normalizeCustomization', () => {
  it('falls back to valid choices when options were removed', () => {
    const product = vase();
    const c = {
      dimensions: undefined,
      colorId: 'deleted',
      engravingText: 'Hi',
      engravingFont: 'Comic Sans',
      textureDataUrl: null,
    } as unknown as Customization;
    expect(normalizeCustomization(product, c)).toMatchObject({
      dimensions: dims(110, 110, 200),
      colorId: 'white',
      engravingFont: 'Georgia',
    });
  });

  it('keeps typed dimensions even when invalid, so the customer sees the error', () => {
    const product = vase();
    const c = { ...defaultCustomization(product), dimensions: dims(Number.NaN, 300, 200) };
    expect(normalizeCustomization(product, c).dimensions).toEqual(c.dimensions);
  });
});

describe('engraving text color', () => {
  // Spiral Vase: engraving $5, colored text +$3, Silk Gold filament +$3.
  const withText = (extra: Partial<Customization>) => {
    const product = vase();
    return { product, c: { ...defaultCustomization(product), engravingText: 'Anna', ...extra } };
  };

  it('adds the colored text surcharge, naming the color', () => {
    const { product, c } = withText({ engravingColorId: 'white' });
    const { lines, unitPrice } = calculatePrice(product, c);
    expect(unitPrice).toBe(32 + 5 + 3);
    expect(lines).toContainEqual({ label: 'Colored engraving', amount: 3, note: 'Arctic White' });
  });

  it('charges a premium filament used for the text once, even if the print uses it too', () => {
    const goldText = withText({ engravingColorId: 'gold' });
    expect(calculatePrice(goldText.product, goldText.c).lines).toContainEqual({
      label: 'Color: Silk Gold',
      amount: 3,
      note: 'Engraving',
    });
    expect(calculatePrice(goldText.product, goldText.c).unitPrice).toBe(32 + 5 + 3 + 3);

    const allGold = withText({ colorId: 'gold', engravingColorId: 'gold' });
    const { lines, unitPrice } = calculatePrice(allGold.product, allGold.c);
    expect(lines.filter((l) => l.label === 'Color: Silk Gold')).toEqual([
      { label: 'Color: Silk Gold', amount: 3, note: 'Print, Engraving' },
    ]);
    expect(unitPrice).toBe(32 + 3 + 5 + 3);
  });

  it('shares filament surcharges with the parts of a multi-color model', () => {
    const { product, c } = withText({ engravingColorId: 'gold', partColors: { base: 'gold' } });
    product.mesh = {
      url: '/x.3mf',
      format: '3mf',
      fileName: 'x.3mf',
      sizeBytes: 1,
      triangleCount: 1,
      parts: [{ key: 'base', name: 'Base', fileColor: '#000000' }],
      plates: [],
      plate: null,
    };
    expect(calculatePrice(product, c).lines).toContainEqual({ label: 'Color: Silk Gold', amount: 3, note: 'Base, Engraving' });
  });

  it('ignores the text color without text, or when the product does not offer it', () => {
    const noText = withText({ engravingText: ' ', engravingColorId: 'gold' });
    expect(calculatePrice(noText.product, noText.c).unitPrice).toBe(32);
    const off = withText({ engravingColorId: 'gold' });
    off.product.engraving = { ...off.product.engraving, colorChoice: false };
    expect(calculatePrice(off.product, off.c).unitPrice).toBe(32 + 5);
  });

  it('drops a text color the product no longer offers', () => {
    const { product, c } = withText({ engravingColorId: 'discontinued' });
    expect(normalizeCustomization(product, c).engravingColorId).toBeNull();
    product.engraving = { ...product.engraving, colorChoice: false };
    expect(normalizeCustomization(product, { ...c, engravingColorId: 'gold' }).engravingColorId).toBeNull();
  });
});
