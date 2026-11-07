// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { createSeedProducts } from './data/seedProducts';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  sessionStorage.setItem('printforge.adminToken', 'stale-token-from-before-separation');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

describe('customer-only application', () => {
  it.each([
    ['/print-your-model', 'Print your own model'],
    ['/search', 'Search 3D models'],
    ['/ready-to-print', 'Ready to print'],
  ])('exposes both feature flows at %s', async (path, title) => {
    history.replaceState(null, '', path);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([])));
    await act(async () => root.render(<App />));
    expect(container.querySelector('h1')?.textContent).toBe(title);
    expect(container.querySelector('a[href="/print-your-model"]')).not.toBeNull();
    expect(container.querySelector('a[href="/ready-to-print"]')).not.toBeNull();
    expect(container.querySelector('.header form')).not.toBeNull();
  });
  it('contains no admin route or admin navigation and never sends an admin token', async () => {
    history.replaceState(null, '', '/admin');
    const fetch = vi.fn().mockResolvedValue(Response.json([]));
    vi.stubGlobal('fetch', fetch);
    await act(async () => root.render(<App />));
    expect(container.querySelector('a[href="/admin"]')).toBeNull();
    expect(container.textContent).not.toContain('Admin sign-in');
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(fetch).toHaveBeenCalledWith('/api/products', { method: 'GET', signal: expect.any(AbortSignal) });
  });
  it('cannot preview unpublished products even with the legacy preview flag', async () => {
    const product = { ...createSeedProducts()[0], published: false };
    history.replaceState(null, '', `/product/${product.id}?preview=1`);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([product])));
    await act(async () => root.render(<App />));
    expect(container.textContent).toContain('no longer available');
    expect(container.querySelector('textarea')).toBeNull();
  });
  it('warns in the cart when a chosen shop texture was withdrawn, before checkout rejects it', async () => {
    const product = createSeedProducts().find((p) => p.id === 'spiral-vase')!;
    const marble = { id: 'marble', name: 'Marble', url: '/api/media-files/marble' };
    product.texture = { enabled: true, price: 7, options: [{ ...marble, id: 'marble-v2' }] };
    localStorage.setItem('printforge.cart', JSON.stringify([{
      id: 'item-1', productId: product.id, productName: product.name, quantity: 1, unitPrice: 39,
      addedAt: '2026-10-01T12:00:00.000Z', sizeLabel: '110 × 110 × 200 mm', colorName: 'Arctic White', colorHex: '#f4f4f2',
      texture: { source: 'library', ...marble },
      customization: {
        dimensions: { widthMm: 110, depthMm: 110, heightMm: 200 }, colorId: 'white', partColors: {},
        engravingText: '', engravingFont: 'Georgia', engravingColorId: null, textureDataUrl: null, textureId: 'marble',
      },
    }]));
    history.replaceState(null, '', '/cart');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([product])));
    await act(async () => root.render(<App />));
    expect(container.textContent).toContain('Shop texture: Marble');
    const warning = container.querySelector('.cart-item [role="alert"]');
    expect(warning?.textContent).toContain('The chosen texture is no longer available.');
    expect(warning?.querySelector('a')?.getAttribute('href')).toBe('/product/spiral-vase');
  });
});
