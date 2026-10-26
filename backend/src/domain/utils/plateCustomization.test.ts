import { describe, expect, it } from 'vitest';
import { createSeedProducts } from '../data/seedProducts';
import type { Product } from '../types';
import { customizationSurfaces, defaultCustomization, defaultSurfaceCustomization, normalizeCustomization, normalizeCustomizationText } from './customization';
import { summarizeConfiguration } from './orderLines';
import { calculatePrice, sizePrice, startingPrice } from './pricing';
import { customizationEngravingErrors } from './validation';

function product(): Product {
  const base = createSeedProducts()[0];
  const shared = { key: 'shared', name: 'Shared paint', fileColor: '#123456' };
  const lid = { key: 'lid', name: 'Lid', fileColor: '#654321' };
  return {
    ...base,
    texture: { enabled: true, price: 7 },
    mesh: {
      ...base.mesh!,
      parts: [shared, lid],
      plates: [
        { id: 1, name: 'Base plate', objectCount: 1, parts: [shared] },
        { id: 2, name: 'Lid plate', objectCount: 2, parts: [shared, lid] },
        { id: 3, name: 'Not included', objectCount: 1, parts: [] },
      ],
      plate: 1, selectedPlates: [1, 2],
    },
  };
}

describe('independent plate customization', () => {
  it('creates independent defaults for only the selected plates', () => {
    const customization = defaultCustomization(product());
    expect(Object.keys(customization.plates ?? {})).toEqual(['1', '2']);
    expect(customization.plates?.['1']).not.toBe(customization.plates?.['2']);
    expect(customization.plates?.['1']?.partColors).not.toBe(customization.plates?.['2']?.partColors);
  });

  it('inherits legacy shared choices without losing text, colors or texture', () => {
    const p = product();
    const legacy = { ...defaultSurfaceCustomization(p), dimensions: p.model, partColors: { shared: 'gold' }, engravingText: 'Legacy' };
    const normalized = normalizeCustomization(p, legacy);
    expect(normalized.plates?.['1']).toMatchObject({ partColors: { shared: 'gold' }, engravingText: 'Legacy' });
    expect(normalized.plates?.['2']).toMatchObject({ partColors: { shared: 'gold' }, engravingText: 'Legacy' });
  });

  it('retains different choices for the same painted part on different plates', () => {
    const p = product();
    const defaults = defaultSurfaceCustomization(p);
    const c = normalizeCustomization(p, {
      ...defaultCustomization(p),
      plates: {
        '1': { ...defaults, partColors: { shared: 'gold', lid: 'red', deleted: 'white' }, engravingText: 'One' },
        '2': { ...defaults, partColors: { shared: 'red', lid: 'discontinued' }, engravingText: 'Two' },
        '3': { ...defaults, engravingText: '<invalid unused plate>' },
      },
    });
    expect(c.plates?.['1']).toMatchObject({ partColors: { shared: 'gold' }, engravingText: 'One' });
    expect(c.plates?.['2']).toMatchObject({ partColors: { shared: 'red' }, engravingText: 'Two' });
    expect(c.plates?.['3']).toBeUndefined();
    expect(customizationEngravingErrors(p, c)).toEqual([]);
  });

  it('drops disabled options on every plate', () => {
    const p = product();
    p.engraving.enabled = false;
    p.texture.enabled = false;
    const c = normalizeCustomization(p, {
      ...defaultCustomization(p),
      plates: { '1': { ...defaultSurfaceCustomization(p), engravingText: 'Ignored', engravingColorId: 'gold', textureDataUrl: 'data:image/png;base64,AA==' } },
    });
    expect(c.plates?.['1']).toMatchObject({ engravingText: '', engravingColorId: null, textureDataUrl: null });
  });

  it('validates and normalizes engraving on each plate separately', () => {
    const p = product();
    const c = {
      ...defaultCustomization(p),
      plates: {
        '1': { ...defaultSurfaceCustomization(p), engravingText: 'First  \n\n' },
        '2': { ...defaultSurfaceCustomization(p), engravingText: '<bad>' },
      },
    };
    expect(customizationEngravingErrors(p, c)).toEqual([{ plateId: 2, message: expect.stringContaining('Lid plate: Use letters') }]);
    expect(normalizeCustomizationText(c).plates?.['1']?.engravingText).toBe('First');
  });

  it('charges additions once across plates while allowing different text, textures and filament colors', () => {
    const p = product();
    const defaults = defaultSurfaceCustomization(p);
    const c = {
      ...defaultCustomization(p),
      plates: {
        '1': { ...defaults, partColors: { shared: 'gold' }, engravingText: 'First', engravingColorId: 'gold', textureDataUrl: 'data:image/png;base64,AA==' },
        '2': { ...defaults, partColors: { shared: 'gold', lid: 'marble' }, engravingText: 'Second', engravingColorId: 'marble', textureDataUrl: 'data:image/png;base64,AQ==' },
      },
    };
    const result = calculatePrice(p, c);
    expect(result.unitPrice).toBe(29 + 3 + 2 + 5 + 3 + 7);
    for (const label of ['Engraving', 'Colored engraving', 'Picture texture', 'Color: Silk Gold']) {
      expect(result.lines.filter((line) => line.label === label)).toHaveLength(1);
    }
    expect(result.lines.find((line) => line.label === 'Colored engraving')?.note).toBe('Silk Gold, Marble Grey');
    const summary = summarizeConfiguration(p, c);
    expect(summary.plates?.[0].appearance?.parts?.[0].colorName).toBe('Silk Gold');
    expect(summary.plates?.[1].appearance?.parts?.[1].colorName).toBe('Marble Grey');
  });

  it('uses only plate appearances when present, not stale shared additions', () => {
    const p = product();
    const c = { ...defaultCustomization(p), engravingText: 'Ignored shared text', textureDataUrl: 'data:image/png;base64,AA==', partColors: { shared: 'gold' } };
    expect(calculatePrice(p, c).unitPrice).toBe(29);
  });

  it('keeps scaling global and prices the combined volume once', () => {
    const p = product();
    const original = defaultCustomization(p);
    const half = { ...original, dimensions: { widthMm: p.model.widthMm / 2, depthMm: p.model.depthMm / 2, heightMm: p.model.heightMm / 2 } };
    expect(customizationSurfaces(p, half).map((surface) => surface.choices)).toEqual(customizationSurfaces(p, original).map((surface) => surface.choices));
    expect(sizePrice(p, half.dimensions).volumeCm3).toBe(p.model.volumeCm3 / 8);
    expect(calculatePrice(p, half).unitPrice).toBe(7.13);
  });

  it('accounts for an uncolored plate in the set starting price', () => {
    const p = product();
    p.colors = p.colors.map((color) => ({ ...color, priceDelta: 2 }));
    const original = startingPrice(p);
    p.mesh!.plates[1].parts = [];
    expect(startingPrice(p)).toBe(original + 2);
  });
});
