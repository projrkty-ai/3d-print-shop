import { describe, expect, it } from 'vitest';
import { createSeedProducts } from '../data/seedProducts';
import { uniqueSlug } from './ids';
import { validateEngraving, validateProduct } from './validation';

describe('validateProduct', () => {
  it('accepts every seed product', () => {
    for (const product of createSeedProducts()) expect(validateProduct(product)).toEqual([]);
  });

  it('reports missing name, options and bad values', () => {
    const product = {
      ...createSeedProducts()[0],
      name: ' ',
      basePrice: Number.NaN,
      fixedFee: -1,
      model: { widthMm: 300, depthMm: 100, heightMm: Number.NaN, volumeCm3: 0 },
      colors: [{ id: 'c', name: 'Bad', hex: 'red', priceDelta: 0 }],
      engraving: { enabled: true, maxLength: 0, maxLines: 0, price: 1, fonts: [], colorChoice: true, colorPrice: -1 },
    };
    const errors = validateProduct(product);
    expect(errors).toContain('Name is required.');
    expect(errors).toContain('Base price must be 0 or more.');
    expect(errors).toContain('Fixed fee must be 0 or more.');
    expect(errors).toContain('Model width must be between 5 and 270 mm (the original size must be printable).');
    expect(errors).toContain('Model height must be between 5 and 270 mm (the original size must be printable).');
    expect(errors).toContain('Model volume must be greater than 0 cm³.');
    expect(errors).toContain('Color Bad: "red" is not a valid hex color.');
    expect(errors).toContain('Pick at least one engraving font.');
    expect(errors).toContain('Engraving max length must be a whole number of at least 1.');
    expect(errors).toContain('Engraving max lines must be a whole number from 1 to 5.');
    expect(errors).toContain('Colored text surcharge must be 0 or more.');
  });

  it('requires a valid plate for products made from a multi-plate project', () => {
    const product = createSeedProducts()[0];
    const plates = [
      { id: 1, name: 'Vase', objectCount: 1 },
      { id: 2, name: 'Minis', objectCount: 2 },
    ];
    expect(validateProduct({ ...product, mesh: { ...product.mesh!, plates, plate: 2 } })).toEqual([]);
    expect(validateProduct({ ...product, mesh: { ...product.mesh!, plates, plate: 7 } })).toEqual([
      'Choose which plate of the project this product is.',
    ]);
  });

  it('rejects a fixed fee above the original-size price', () => {
    expect(validateProduct({ ...createSeedProducts()[0], basePrice: 10, fixedFee: 12 })).toEqual([
      "Fixed fee can't be more than the price at original size.",
    ]);
  });

  it('validates multi-plate selections and allows the combined volume of several plates', () => {
    const original = createSeedProducts()[0];
    const product = {
      ...original,
      model: { widthMm: 10, depthMm: 10, heightMm: 10, volumeCm3: 2 },
      mesh: { ...original.mesh!, plates: [
        { id: 1, name: 'A', objectCount: 1 }, { id: 2, name: 'B', objectCount: 1 },
      ], plate: 1, selectedPlates: [1, 2] },
    };
    expect(validateProduct(product)).toEqual([]);
    for (const selectedPlates of [[], [1, 1], [1, 99]]) {
      expect(validateProduct({ ...product, mesh: { ...product.mesh, selectedPlates } }))
        .toContain('Choose at least one valid, distinct plate for this product.');
    }
  });

  it('catches a volume entered in mm³ instead of cm³', () => {
    const product = { ...createSeedProducts()[0], model: { widthMm: 100, depthMm: 100, heightMm: 100, volumeCm3: 95000 } };
    expect(validateProduct(product)).toEqual([
      "Model volume (95000 cm³) can't exceed its bounding box (1000.0 cm³). Check that it's in cm³, not mm³.",
    ]);
  });
});

describe('validateEngraving', () => {
  const single = { maxLength: 20, maxLines: 1 };
  const threeLines = { maxLength: 20, maxLines: 3 };

  it('accepts letters with diacritics and punctuation', () => {
    expect(validateEngraving('Zażółć, gęślą!', single)).toBeNull();
  });

  it('rejects text that is too long or has unsupported characters', () => {
    expect(validateEngraving('abcdef', { maxLength: 5, maxLines: 1 })).toMatch(/at most 5/);
    expect(validateEngraving('<script>', single)).toMatch(/Use letters/);
    expect(validateEngraving('Hi\n<b>', threeLines)).toMatch(/Use letters/);
  });

  it('enforces the line limit', () => {
    expect(validateEngraving('Happy\nBirthday', single)).toMatch(/single line/);
    expect(validateEngraving('a\nb\nc', threeLines)).toBeNull();
    expect(validateEngraving('a\nb\nc\nd', threeLines)).toMatch(/at most 3 lines/);
  });

  it('ignores blank lines at the edges and does not count line breaks as characters', () => {
    expect(validateEngraving('\n\nHello\n\n', single)).toBeNull();
    expect(validateEngraving('0123456789\r\n0123456789', threeLines)).toBeNull();
  });
});

describe('uniqueSlug', () => {
  it('slugifies and avoids collisions', () => {
    expect(uniqueSlug('Spiral Vase!', [])).toBe('spiral-vase');
    expect(uniqueSlug('Spiral Vase', ['spiral-vase', 'spiral-vase-2'])).toBe('spiral-vase-3');
    expect(uniqueSlug('Łódź Mug', [])).toBe('lodz-mug');
    expect(uniqueSlug('!!!', [])).toBe('product');
  });
});
