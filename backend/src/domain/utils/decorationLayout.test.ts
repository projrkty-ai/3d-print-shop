import { describe, expect, it } from 'vitest';
import { createSeedProducts } from '../data/seedProducts';
import { defaultCustomization } from './customization';
import { decorationLayoutErrors, decorationLayoutFor, DEFAULT_TEXT_LAYOUT, DEFAULT_TEXTURE_LAYOUT } from './decorationLayout';
import { summarizeConfiguration } from './orderLines';
import { calculatePrice } from './pricing';
import { validateProduct } from './validation';

describe('administrator decoration layouts', () => {
  it('leaves legacy products unset and uses independent plate settings, not the root layout', () => {
    const product = createSeedProducts()[0];
    expect(decorationLayoutFor(product)).toBeUndefined();
    product.decorationLayout = { text: { ...DEFAULT_TEXT_LAYOUT, centerX: 20 } };
    const plate = { id: 1, name: 'Base', objectCount: 1 };
    expect(decorationLayoutFor(product, plate)).toBeUndefined();
    expect(decorationLayoutFor(product)).toEqual(product.decorationLayout);
  });

  it.each([NaN, Infinity, -1, 101])('rejects invalid coordinates (%s) in admin validation', (centerX) => {
    const product = createSeedProducts()[0];
    product.decorationLayout = { text: { ...DEFAULT_TEXT_LAYOUT, centerX } };
    expect(validateProduct(product)).toContain('Text horizontal position must be between 0 and 100%.');
  });

  it.each([NaN, Infinity, 0, 100.1])('rejects invalid texture size (%s)', (width) => {
    expect(decorationLayoutErrors({ texture: { ...DEFAULT_TEXTURE_LAYOUT, width } })).toContain('Texture width must be between 1 and 100%.');
  });

  it('accepts boundary coordinates and sizes and identifies invalid plate settings by name', () => {
    expect(decorationLayoutErrors({
      text: { centerX: 0, centerY: 100, horizontalAlign: 'right', verticalAlign: 'bottom' },
      texture: { centerX: 100, centerY: 0, width: 1, height: 100 },
    })).toEqual([]);
    const product = createSeedProducts()[0];
    product.mesh = {
      url: '/model.3mf', format: '3mf', fileName: 'model.3mf', sizeBytes: 1, triangleCount: 1, parts: [], plate: 1,
      plates: [{ id: 1, name: 'Lid', objectCount: 1, decorationLayout: { texture: { ...DEFAULT_TEXTURE_LAYOUT, height: 0 } } }],
    };
    expect(validateProduct(product)).toContain('Lid: Texture height must be between 1 and 100%.');
  });

  it('snapshots a deep copy of the trusted product placement without changing price', () => {
    const product = createSeedProducts()[0];
    const customization = defaultCustomization(product);
    const before = calculatePrice(product, customization);
    product.decorationLayout = { text: { ...DEFAULT_TEXT_LAYOUT, centerX: 23 }, texture: { ...DEFAULT_TEXTURE_LAYOUT, width: 40 } };
    const snapshot = summarizeConfiguration(product, customization);
    expect(snapshot.decorationLayout).toEqual(product.decorationLayout);
    product.decorationLayout.text!.centerX = 78;
    expect(snapshot.decorationLayout?.text?.centerX).toBe(23);
    expect(calculatePrice(product, customization)).toEqual(before);
  });
});
