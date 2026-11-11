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
  it('has one Orders tab for every order, and sends the former print request and project order addresses there', async () => {
    sessionStorage.setItem('printforge.adminToken', 'test-key');
    const fetch = vi.fn().mockImplementation(async (url: string) => (url.includes('/orders/po-1')
      ? Response.json({ error: 'Order not found.' }, { status: 404 })
      : Response.json([])));
    vi.stubGlobal('fetch', fetch);
    history.replaceState(null, '', '/admin/custom-orders');
    await act(async () => root.render(<App />));
    const tabs = [...container.querySelectorAll<HTMLAnchorElement>('.admin-tabs a')];
    expect(tabs.map((tab) => [tab.textContent, tab.getAttribute('href')])).toEqual([
      ['Products', '/admin'], ['Orders', '/admin/orders'], ['Email templates', '/admin/email-templates'],
      ['Print on Demand', '/admin/print-on-demand'], ['Pricing', '/admin/pricing'], ['Slicer test', '/admin/slicer'], ['Printers', '/admin/printers'],
    ]);
    expect(`${location.pathname}${location.search}`).toBe('/admin/orders?source=upload');
    expect(container.querySelector('.admin-tabs [aria-current="page"]')?.textContent).toBe('Orders');
    expect(container.querySelector('h1')?.textContent).toBe('Orders');
    expect(container.textContent).toContain('No orders yet.');
    expect(fetch.mock.calls.at(-1)?.[0]).toBe('/api/orders?source=upload');
    await act(async () => root.unmount());
    root = createRoot(container);
    history.replaceState(null, '', '/admin/project-orders/po-1');
    await act(async () => root.render(<App />));
    expect(location.pathname).toBe('/admin/orders/po-1');
    expect(container.textContent).toContain('Order not found.');
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
    ['/admin/print-on-demand', 'Print on Demand'],
  ])('keeps search-integration navigation active on %s', async (path, title) => {
    sessionStorage.setItem('printforge.adminToken', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json([])));
    history.replaceState(null, '', path);
    await act(async () => root.render(<App />));
    expect(container.querySelector('h1')?.textContent).toBe(title);
    expect(container.querySelectorAll('.admin-tabs [aria-current="page"]')).toHaveLength(1);
    expect(container.querySelector('.admin-tabs [aria-current="page"]')?.textContent).toBe(title);
    expect(container.querySelector('a[href="/admin/orders"]')).not.toBeNull();
  });
  it('requires admin sign-in for product previews', async () => {
    history.replaceState(null, '', `/product/${createSeedProducts()[0].id}`);
    await act(async () => root.render(<App />));
    expect(container.textContent).toContain('Admin sign-in');
    expect(container.querySelector('[data-preview]')).toBeNull();
  });
  it('adds the slicer tab without replacing existing administration sections', async () => {
    sessionStorage.setItem('printforge.adminToken', 'test-key');
    history.replaceState(null, '', '/admin/slicer');
    await act(async () => root.render(<App />));
    expect(container.querySelector('h1')?.textContent).toBe('Slicer test');
    expect(container.querySelectorAll('.admin-tabs [aria-current="page"]')).toHaveLength(1);
    expect(container.querySelector('.admin-tabs [aria-current="page"]')?.getAttribute('href')).toBe('/admin/slicer');
    expect([...container.querySelectorAll('.admin-tabs a')].map((tab) => tab.textContent)).toEqual([
      'Products', 'Orders', 'Email templates', 'Print on Demand', 'Pricing', 'Slicer test', 'Printers',
    ]);
  });
  it('has a printers warehouse tab, marked current on its page', async () => {
    sessionStorage.setItem('printforge.adminToken', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json([])));
    history.replaceState(null, '', '/admin/printers');
    await act(async () => root.render(<App />));
    expect(container.querySelector('h1')?.textContent).toBe('Printers');
    expect(container.querySelectorAll('.admin-tabs [aria-current="page"]')).toHaveLength(1);
    expect(container.querySelector('.admin-tabs [aria-current="page"]')?.getAttribute('href')).toBe('/admin/printers');
    expect(container.textContent).toContain('No printers yet.');
    expect([...container.querySelectorAll('button')].map((button) => button.textContent)).toContain('Add printer');
  });
  it.each([
    ['/admin/printer-models', 'Printer models'],
    ['/admin/printer-models/new', 'Add printer model'],
  ])('keeps the Printers tab current on the printer model page %s', async (path, title) => {
    sessionStorage.setItem('printforge.adminToken', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json([])));
    history.replaceState(null, '', path);
    await act(async () => root.render(<App />));
    expect(container.querySelector('h1')?.textContent).toBe(title);
    expect(container.querySelectorAll('.admin-tabs [aria-current="page"]')).toHaveLength(1);
    expect(container.querySelector('.admin-tabs [aria-current="page"]')?.getAttribute('href')).toBe('/admin/printers');
    expect(container.querySelector('.printers-nav .is-active')?.textContent).toBe('Printer models');
  });
  it('requires admin sign-in for the printers warehouse', async () => {
    history.replaceState(null, '', '/admin/printers');
    await act(async () => root.render(<App />));
    expect(container.querySelector('h1')?.textContent).toBe('Admin sign-in');
  });
  it('requires admin sign-in for the slicer tool', async () => {
    history.replaceState(null, '', '/admin/slicer');
    await act(async () => root.render(<App />));
    expect(container.querySelector('h1')?.textContent).toBe('Admin sign-in');
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });
});
