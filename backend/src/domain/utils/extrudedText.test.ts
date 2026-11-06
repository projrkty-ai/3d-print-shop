import { describe, expect, it } from 'vitest';
import { createSeedProducts } from '../data/seedProducts';
import type { ExtrudedTextLayout, Product } from '../types';
import {
  clampExtrudedSizeMm, defaultCustomization, extrudedSizeBounds, extrudedTextChoice, normalizeCustomization,
} from './customization';
import { defaultExtrudedTextLayout } from './decorationLayout';
import { customizationExtrudedTextErrors, validateExtrudedText, validateProduct } from './validation';

const lettering = (patch: Partial<ExtrudedTextLayout> = {}): ExtrudedTextLayout => ({
  x: 0, y: -55, z: 100, rotationDeg: 0, tiltDeg: 0, sizeMm: 12, depthMm: 1.5, lineSpacing: 1.2,
  horizontalAlign: 'center', verticalAlign: 'middle', defaultText: 'Hello', ...patch,
});

/** Spiral Vase with 3D lettering on the front. */
function vase(patch: Partial<ExtrudedTextLayout> = {}): Product {
  const product = createSeedProducts().find((p) => p.id === 'spiral-vase')!;
  return { ...product, decorationLayout: { ...product.decorationLayout, extrudedText: lettering(patch) } };
}

describe('3D lettering', () => {
  it('suggests an upright front placement sized to the model', () => {
    expect(defaultExtrudedTextLayout({ widthMm: 110, depthMm: 95, heightMm: 200 })).toEqual({
      x: 0, y: -47.5, z: 100, rotationDeg: 0, tiltDeg: 0, sizeMm: 24, depthMm: 1.5, lineSpacing: 1.2,
      horizontalAlign: 'center', verticalAlign: 'middle', defaultText: '',
    });
    expect(defaultExtrudedTextLayout({ widthMm: 20, depthMm: 20, heightMm: 12 }).sizeMm).toBe(1);
  });

  it('keeps only customer choices that differ from the suggestion, clamping the size', () => {
    const p = vase();
    const base = defaultCustomization(p);
    expect(normalizeCustomization(p, base)).not.toHaveProperty('extrudedText');
    const changed = normalizeCustomization(p, { ...base, extrudedText: 'Anna', extrudedSizeMm: 17.84 });
    expect(changed).toMatchObject({ extrudedText: 'Anna', extrudedSizeMm: 17.8 });
    expect(normalizeCustomization(p, { ...base, extrudedText: 'Hello', extrudedSizeMm: 12 })).not.toHaveProperty('extrudedText');
    expect(extrudedSizeBounds(lettering())).toEqual({ min: 6, max: 24 });
    expect(normalizeCustomization(p, { ...base, extrudedSizeMm: 500 }).extrudedSizeMm).toBe(24);
    expect(clampExtrudedSizeMm(lettering(), Number.NaN)).toBe(12);
    // Without lettering on the product, the choices are dropped.
    const plain = createSeedProducts().find((product) => product.id === 'spiral-vase')!;
    expect(normalizeCustomization(plain, { ...base, extrudedText: 'Anna', extrudedSizeMm: 17 })).not.toHaveProperty('extrudedText');
  });

  it('resolves the effective lettering: suggestion, override, or removed with empty text', () => {
    const layout = { extrudedText: lettering() };
    const base = defaultCustomization(vase());
    expect(extrudedTextChoice(layout, base)).toEqual({ lettering: lettering(), text: 'Hello', sizeMm: 12 });
    expect(extrudedTextChoice(layout, { ...base, extrudedText: 'Anna', extrudedSizeMm: 20 }))
      .toMatchObject({ text: 'Anna', sizeMm: 20 });
    expect(extrudedTextChoice(layout, { ...base, extrudedText: ' ' })).toBeNull();
    expect(extrudedTextChoice(undefined, base)).toBeNull();
    expect(extrudedTextChoice({}, base)).toBeNull();
  });

  it('validates lettering text for the bundled 3D font', () => {
    expect(validateExtrudedText('Zażółć gęślą jaźń!')).toBeNull();
    expect(validateExtrudedText('a\nb\nc\nd')).toContain('3 lines');
    expect(validateExtrudedText('x'.repeat(61))).toContain('60 characters');
    expect(validateExtrudedText('№ 5')).toContain('Latin letters');
    expect(validateExtrudedText('日本')).toContain('Latin letters');
  });

  it('reports invalid customer lettering instead of printing it', () => {
    const p = vase();
    const base = defaultCustomization(p);
    expect(customizationExtrudedTextErrors(p, base)).toEqual([]);
    expect(customizationExtrudedTextErrors(p, { ...base, extrudedText: '☠' })).toEqual([
      { plateId: null, message: expect.stringContaining('Latin letters') },
    ]);
  });

  it('validates the shop settings', () => {
    expect(validateProduct(vase())).toEqual([]);
    expect(validateProduct(vase({ z: 900 }))).toEqual(['3D lettering: the Z position must be between −500 and 500 mm.']);
    expect(validateProduct(vase({ tiltDeg: 120 }))).toEqual(['3D lettering: tilt must be between 0 and 90 degrees.']);
    expect(validateProduct(vase({ sizeMm: 0 }))).toEqual(['3D lettering: size must be between 1 and 100 mm.']);
    expect(validateProduct(vase({ depthMm: 50 }))).toEqual(['3D lettering: depth must be between 0.2 and 20 mm.']);
    expect(validateProduct(vase({ lineSpacing: 5 }))).toEqual(['3D lettering: line spacing must be between 0.8 and 3.']);
    expect(validateProduct(vase({ rotationDeg: 720 }))).toEqual(['3D lettering: rotation must be between −360 and 360 degrees.']);
    expect(validateProduct(vase({ defaultText: '☠' }))).toEqual([
      expect.stringContaining('3D lettering suggested text:'),
    ]);
    expect(validateProduct(vase({ defaultText: '' }))).toEqual([]);
  });
});
