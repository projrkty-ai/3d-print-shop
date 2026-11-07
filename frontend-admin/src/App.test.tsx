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
  it('has a print requests tab, marked current on its pages', async () => {
    sessionStorage.setItem('printforge.adminToken', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json([])));
    history.replaceState(null, '', '/admin/custom-orders');
    await act(async () => root.render(<App />));
    const tabs = [...container.querySelectorAll<HTMLAnchorElement>('.admin-tabs a')];
    expect(tabs.map((tab) => [tab.textContent, tab.getAttribute('href')])).toEqual([
      ['Products', '/admin'], ['Orders', '/admin/orders'], ['Print requests', '/admin/custom-orders'],
      ['Email templates', '/admin/email-templates'],
      ['Project orders', '/admin/project-orders'], ['Ready to print', '/admin/ready-to-print'],
      ['Pricing', '/admin/pricing'],
    ]);
    expect(container.querySelector('.admin-tabs [aria-current="page"]')?.textContent).toBe('Print requests');
    expect(container.querySelector('h1')?.textContent).toBe('Print requests');
    expect(container.textContent).toContain('No print requests yet.');
  });
  it('redirects the old print options URL to the active Pricing tab', async () => {
    sessionStorage.setItem('printforge.adminToken', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unavailable')));
    history.replaceState(null, '', '/admin/print-options');
    await act(async () => root.render(<App />));
    expect(location.pathname).toBe('/admin/pricing');
    expect(container.querySelector('.admin-tabs [aria-current="page"]')?.textContent).toBe('Pricing');
    expect(container.querySelector('a[href="/admin/print-options"]')).toBeNull();
    expect(container.querySelector('h1')?.textContent).toBe('Pricing');
    expect(container.querySelector('h2')?.textContent).toBe('Print options');
  });
  it.each([
    ['/admin/project-orders', 'Project orders'],
    ['/admin/ready-to-print', 'Ready to print'],
  ])('keeps search-integration navigation active on %s', async (path, title) => {
    sessionStorage.setItem('printforge.adminToken', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json([])));
    history.replaceState(null, '', path);
    await act(async () => root.render(<App />));
    expect(container.querySelector('h1')?.textContent).toBe(title);
    expect(container.querySelectorAll('.admin-tabs [aria-current="page"]')).toHaveLength(1);
    expect(container.querySelector('.admin-tabs [aria-current="page"]')?.textContent).toBe(title);
    expect(container.querySelector('a[href="/admin/custom-orders"]')).not.toBeNull();
  });
  it('requires admin sign-in for product previews', async () => {
    history.replaceState(null, '', `/product/${createSeedProducts()[0].id}`);
    await act(async () => root.render(<App />));
    expect(container.textContent).toContain('Admin sign-in');
    expect(container.querySelector('[data-preview]')).toBeNull();
  });
});
