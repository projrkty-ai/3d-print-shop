import { describe, expect, it } from 'vitest';
import { createSeedProducts } from '../data/seedProducts';
import type { Customization, Product } from '../types';
import { defaultCustomization, normalizeCustomization, offersTexture } from './customization';
import { summarizeConfiguration } from './orderLines';
import { calculatePrice } from './pricing';
import { customizationTextureErrors, validateProduct } from './validation';

const PICTURE = 'data:image/png;base64,AA==';
const marble = { id: 'marble', name: 'Marble', url: '/api/media-files/0123456789abcdef01234567' };
const waves = { id: 'waves', name: 'Waves', url: '/api/media-files/abcdef0123456789abcdef01' };

/** Spiral Vase (texture $7) offering two shop textures next to customer uploads. */
function vase(texture: Partial<Product['texture']> = {}): Product {
  const product = createSeedProducts().find((p) => p.id === 'spiral-vase')!;
  return { ...product, texture: { enabled: true, price: 7, options: [marble, waves], allowCustom: true, ...texture } };
}

/** Twisted Star Vase sold as a two-plate set with the same texture library. */
function plateSet(): Product {
  const base = createSeedProducts()[0];
  return {
    ...base,
    texture: { enabled: true, price: 7, options: [marble, waves] },
    mesh: {
      ...base.mesh!,
      plates: [{ id: 1, name: 'Base plate', objectCount: 1 }, { id: 2, name: 'Lid plate', objectCount: 1 }],
      plate: 1, selectedPlates: [1, 2],
    },
  };
}

const choose = (product: Product, patch: Partial<Customization>): Customization => ({ ...defaultCustomization(product), ...patch });

describe('shop texture library', () => {
  it('keeps a chosen shop texture and drops an uploaded picture sent alongside it', () => {
    const p = vase();
    expect(normalizeCustomization(p, choose(p, { textureId: 'marble', textureDataUrl: PICTURE })))
      .toMatchObject({ textureId: 'marble', textureDataUrl: null });
    expect(normalizeCustomization(p, choose(p, { textureDataUrl: PICTURE })))
      .toMatchObject({ textureDataUrl: PICTURE });
  });

  it('omits textureId when no shop texture is chosen, keeping older payloads unchanged', () => {
    const p = vase();
    expect(normalizeCustomization(p, choose(p, {}))).not.toHaveProperty('textureId');
    expect(normalizeCustomization(p, choose(p, { textureId: null }))).not.toHaveProperty('textureId');
  });

  it('repairs textures the product no longer offers', () => {
    expect(normalizeCustomization(vase(), choose(vase(), { textureId: 'removed' }))).not.toHaveProperty('textureId');
    const noUploads = vase({ allowCustom: false });
    expect(normalizeCustomization(noUploads, choose(noUploads, { textureDataUrl: PICTURE })).textureDataUrl).toBeNull();
    const disabled = vase({ enabled: false });
    expect(normalizeCustomization(disabled, choose(disabled, { textureId: 'marble' }))).not.toHaveProperty('textureId');
  });

  it('treats products saved before the library as upload-only', () => {
    const legacy = vase({ options: undefined, allowCustom: undefined });
    expect(offersTexture(legacy)).toBe(true);
    expect(normalizeCustomization(legacy, choose(legacy, { textureDataUrl: PICTURE })).textureDataUrl).toBe(PICTURE);
    expect(customizationTextureErrors(legacy, choose(legacy, { textureDataUrl: PICTURE }))).toEqual([]);
    expect(offersTexture(vase({ options: [], allowCustom: false }))).toBe(false);
  });

  it('charges the texture fee once and names shop textures in the price note', () => {
    const p = vase();
    const library = calculatePrice(p, normalizeCustomization(p, choose(p, { textureId: 'waves' })));
    expect(library.lines.at(-1)).toEqual({ label: 'Picture texture', amount: 7, note: 'Waves' });
    expect(library.unitPrice).toBe(32 + 7);
    const own = calculatePrice(p, normalizeCustomization(p, choose(p, { textureDataUrl: PICTURE })));
    expect(own.lines.at(-1)).toEqual({ label: 'Picture texture', amount: 7 });
    expect(calculatePrice(p, normalizeCustomization(p, choose(p, {}))).unitPrice).toBe(32);
  });

  it('charges a set once while listing every plate texture', () => {
    const p = plateSet();
    const c = normalizeCustomization(p, {
      ...defaultCustomization(p),
      plates: {
        1: { ...defaultCustomization(p).plates![1], textureId: 'marble' },
        2: { ...defaultCustomization(p).plates![2], textureDataUrl: PICTURE },
      },
    });
    const textureLines = calculatePrice(p, c).lines.filter((line) => line.label === 'Picture texture');
    expect(textureLines).toEqual([{ label: 'Picture texture', amount: 7, note: 'Marble, Custom picture' }]);
  });

  it('snapshots the shop texture name and image for fulfilment, per plate', () => {
    const p = plateSet();
    const c = normalizeCustomization(p, {
      ...defaultCustomization(p),
      plates: {
        1: { ...defaultCustomization(p).plates![1], textureId: 'marble' },
        2: { ...defaultCustomization(p).plates![2], textureDataUrl: PICTURE },
      },
    });
    const summary = summarizeConfiguration(p, c);
    expect(summary.plates?.map((plate) => plate.appearance?.texture)).toEqual([
      { source: 'library', id: 'marble', name: 'Marble', url: marble.url },
      { source: 'custom' },
    ]);
    expect(summarizeConfiguration(vase(), normalizeCustomization(vase(), choose(vase(), {})))).not.toHaveProperty('texture');
  });

  it('reports stale texture choices per plate instead of silently dropping them', () => {
    const p = plateSet();
    p.texture.options = [waves];
    const c = {
      ...defaultCustomization(p),
      plates: {
        1: { ...defaultCustomization(p).plates![1], textureId: 'marble' },
        2: { ...defaultCustomization(p).plates![2], textureId: 'waves' },
      },
    };
    expect(customizationTextureErrors(p, c)).toEqual([
      { plateId: 1, message: 'Base plate: the chosen texture is no longer available. Please configure the product again.' },
    ]);
    const noUploads = vase({ allowCustom: false });
    expect(customizationTextureErrors(noUploads, choose(noUploads, { textureDataUrl: PICTURE }))).toEqual([
      { plateId: null, message: expect.stringContaining('no longer accepted') },
    ]);
    expect(customizationTextureErrors(noUploads, choose(noUploads, { textureId: 'marble' }))).toEqual([]);
  });

  it('validates the texture library settings', () => {
    expect(validateProduct(vase())).toEqual([]);
    expect(validateProduct(vase({ options: [{ ...marble, name: ' ' }, { ...waves, url: '' }] }))).toEqual([
      'Shop texture #1 needs a name.', 'Shop texture Waves needs an image.',
    ]);
    expect(validateProduct(vase({ options: [marble, { ...waves, id: 'marble' }] }))).toEqual(['Each shop texture needs a unique id.']);
    expect(validateProduct(vase({ options: [], allowCustom: false }))).toEqual([
      'Offer at least one shop texture or let customers upload their own picture.',
    ]);
    expect(validateProduct(vase({ enabled: false, options: [], allowCustom: false }))).toEqual([]);
  });

  it('seeds valid products, including a two-plate set and a library of bundled shop textures', () => {
    for (const product of createSeedProducts()) expect(validateProduct(product), product.id).toEqual([]);
    const set = createSeedProducts().find((p) => p.id === 'star-vase-set')!;
    expect(set.mesh?.selectedPlates).toEqual([1, 2]);
    expect(set.texture.options?.map((option) => option.url)).toEqual([
      '/models/textures/terrazzo.png', '/models/textures/sunset.png', '/models/textures/waves.png',
    ]);
  });
});
