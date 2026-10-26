// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeedProducts } from '../data/seedProducts';
import type { Product } from '../types';
import { modelThumbnail } from '../utils/modelThumbnail';
import { ProductThumbnail } from './ProductThumbnail';

vi.mock('../utils/modelThumbnail', () => ({ modelThumbnail: vi.fn() }));

let container: HTMLDivElement;
let root: Root;
let product: Product;
const png = 'data:image/png;base64,dGh1bWJuYWls';

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('IntersectionObserver', undefined);
  vi.mocked(modelThumbnail).mockReset().mockResolvedValue(png);
  product = createSeedProducts()[0];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderProduct() {
  await act(async () => root.render(<ProductThumbnail product={product} />));
}

describe('product list thumbnails', () => {
  it('prefers the configured product photo without loading a model', async () => {
    product.imageUrl = '/product-photo.jpg';
    await renderProduct();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/product-photo.jpg');
    expect(container.querySelector('img')?.getAttribute('loading')).toBe('lazy');
    expect(modelThumbnail).not.toHaveBeenCalled();
  });

  it('shows a generated image from the real file, not a live canvas or shape icon', async () => {
    await renderProduct();
    expect(container.querySelector('img')?.getAttribute('src')).toBe(png);
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(modelThumbnail).toHaveBeenCalledWith({
      url: product.mesh?.url, plate: null, plates: undefined, color: product.colors[0].hex,
    });
  });

  it('passes the selected plate set and regenerates when the model or color changes', async () => {
    if (!product.mesh) throw new Error('Missing fixture model.');
    product.mesh = { ...product.mesh, plate: 2, selectedPlates: [2, 3] };
    await renderProduct();
    expect(modelThumbnail).toHaveBeenLastCalledWith(expect.objectContaining({ plate: 2, plates: [2, 3] }));
    product = { ...product, mesh: { ...product.mesh, url: '/models/replacement.3mf' } };
    await renderProduct();
    expect(modelThumbnail).toHaveBeenLastCalledWith(expect.objectContaining({ url: '/models/replacement.3mf' }));
  });

  it('uses a shape icon only when the product has no model or photo', async () => {
    product.mesh = null;
    await renderProduct();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(modelThumbnail).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('unavailable');
  });

  it('labels and logs model failures explicitly', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(modelThumbnail).mockRejectedValueOnce(new Error('Model file is missing.'));
    await renderProduct();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.textContent).toContain('Preview unavailable');
    expect(container.querySelector('[title]')?.getAttribute('title')).toBe('Model file is missing.');
    expect(warning).toHaveBeenCalledOnce();
  });

  it('does not replace a newer product image with a stale model request', async () => {
    let finish: ((image: string) => void) | undefined;
    vi.mocked(modelThumbnail).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await renderProduct();
    product = { ...product, imageUrl: '/new-photo.jpg' };
    await renderProduct();
    await act(async () => finish?.(png));
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/new-photo.jpg');
  });

  it('does not load off-screen models until they approach the viewport', async () => {
    let callback: IntersectionObserverCallback | undefined;
    let observer: IntersectionObserver | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class implements IntersectionObserver {
      root = null;
      rootMargin = '200px';
      scrollMargin = '0px';
      thresholds = [0];
      constructor(cb: IntersectionObserverCallback) { callback = cb; observer = this; }
      observe = observe;
      disconnect = disconnect;
      unobserve() {}
      takeRecords() { return []; }
    });
    await renderProduct();
    expect(observe).toHaveBeenCalledOnce();
    expect(modelThumbnail).not.toHaveBeenCalled();
    if (!callback || !observer) throw new Error('The thumbnail was not observed.');
    const entry: IntersectionObserverEntry = {
      isIntersecting: true, target: container, time: 0, intersectionRatio: 1,
      boundingClientRect: new DOMRect(), intersectionRect: new DOMRect(), rootBounds: null,
    };
    const trigger = callback;
    const activeObserver = observer;
    await act(async () => trigger([entry], activeObserver));
    expect(modelThumbnail).toHaveBeenCalledOnce();
    expect(container.querySelector('img')?.getAttribute('src')).toBe(png);
    expect(disconnect).toHaveBeenCalled();
  });
});
