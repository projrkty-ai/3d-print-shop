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
  it('contains no admin route or admin navigation and never sends an admin token', async () => {
    history.replaceState(null, '', '/admin');
    const fetch = vi.fn().mockResolvedValue(Response.json([]));
    vi.stubGlobal('fetch', fetch);
    await act(async () => root.render(<App />));
    expect(container.querySelector('a[href="/admin"]')).toBeNull();
    expect(container.textContent).not.toContain('Admin sign-in');
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(fetch).toHaveBeenCalledWith('/api/products', { method: 'GET' });
  });
  it('cannot preview unpublished products even with the legacy preview flag', async () => {
    const product = { ...createSeedProducts()[0], published: false };
    history.replaceState(null, '', `/product/${product.id}?preview=1`);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([product])));
    await act(async () => root.render(<App />));
    expect(container.textContent).toContain('no longer available');
    expect(container.querySelector('textarea')).toBeNull();
  });
});
