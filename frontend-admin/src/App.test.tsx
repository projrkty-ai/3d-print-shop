// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { createSeedProducts } from './data/seedProducts';

vi.mock('./components/LazyProductPreview', () => ({ LazyProductPreview: () => <div data-preview /> }));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  sessionStorage.clear();
  const product = { ...createSeedProducts()[0], published: false, mesh: null };
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json([product])));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

describe('standalone admin application', () => {
  it('opens administration at its root and has no customer cart', async () => {
    sessionStorage.setItem('printforge.adminToken', 'test-key');
    history.replaceState(null, '', '/');
    await act(async () => root.render(<App />));
    expect(location.pathname).toBe('/admin');
    expect(container.querySelector('h1')?.textContent).toBe('Products');
    expect(container.querySelector('a[href="/cart"]')).toBeNull();
    expect(container.querySelector('a[href="http://localhost:5173"]')).not.toBeNull();
  });
  it('previews unpublished products locally without customer stores or checkout', async () => {
    sessionStorage.setItem('printforge.adminToken', 'test-key');
    history.replaceState(null, '', `/product/${createSeedProducts()[0].id}`);
    await act(async () => root.render(<App />));
    expect(container.querySelector('[data-preview]')).not.toBeNull();
    expect(container.textContent).toContain('Admin preview only');
    expect(container.textContent).not.toContain('Add to cart');
  });
  it('requires admin sign-in for product previews', async () => {
    history.replaceState(null, '', `/product/${createSeedProducts()[0].id}`);
    await act(async () => root.render(<App />));
    expect(container.textContent).toContain('Admin sign-in');
    expect(container.querySelector('[data-preview]')).toBeNull();
  });
});
