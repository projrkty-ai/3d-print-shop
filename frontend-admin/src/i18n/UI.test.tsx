// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeedProducts } from '../data/seedProducts';
import type { Order, Product } from '../types';

vi.mock('../components/LazyProductPreview', () => ({ LazyProductPreview: () => <div data-preview /> }));
vi.mock('../components/ProductThumbnail', () => ({ ProductThumbnail: () => <div data-thumbnail /> }));

let container: HTMLDivElement;
let root: Root;
let product: Product;
let order: Order;
let request: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('scrollTo', vi.fn());
  vi.resetModules();
  sessionStorage.clear();
  product = {
    ...createSeedProducts()[0],
    name: 'Products',
    description: '<p>Save product <strong>Sign in</strong></p><video src="https://example.com/demo.mp4" title="Stored video title"></video>',
    descriptionFormat: 'html',
    mesh: null,
    published: false,
  };
  product.engraving.maxLines = 1;
  order = {
    id: 'original-order-id', number: 'PF-ORIGINAL', status: 'printing',
    customer: { name: 'Original Customer', email: 'customer@example.com', address: { line1: 'Original street', city: 'Original city', postalCode: '00-001', country: 'PL' } },
    items: [], total: 1234.5, currency: 'USD', adminNote: 'Stored English note',
    createdAt: '2026-10-26T12:30:00Z', updatedAt: '2026-10-26T12:30:00Z',
  };
  request = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/admin/session')) return new Response(null, { status: 401 });
    if (String(url).includes('/orders/')) return Response.json({ ...order, ...(options?.method === 'PATCH' ? JSON.parse(String(options.body)) : {}) });
    if (String(url).endsWith('/orders')) return Response.json([order]);
    if (options?.method === 'PUT') return Response.json({ ...product, ...JSON.parse(String(options.body)) });
    return Response.json([product]);
  });
  vi.stubGlobal('fetch', request);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

async function open(path: string, authenticated = true) {
  if (authenticated) sessionStorage.setItem('printforge.adminToken', 'test-key');
  history.replaceState(null, '', path);
  const { App } = await import('../App');
  await act(async () => root.render(<App />));
}

describe.each(['en', 'pl'] as const)('%s static administrator UI', (language) => {
  beforeEach(() => vi.stubEnv('VITE_APP_LANGUAGE', language));
  const label = (english: string, polish: string) => language === 'pl' ? polish : english;

  it('localizes sign-in and authentication failures', async () => {
    await open('/admin', false);
    expect(container.querySelector('h1')?.textContent).toBe(label('Admin sign-in', 'Logowanie administratora'));
    expect(container.querySelector('label')?.textContent).toContain(label('Admin key', 'Klucz administratora'));
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(container.querySelector('input'), 'wrong-key');
      container.querySelector('input')!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(label("That key isn't right.", 'Nieprawidłowy klucz.'));
  });

  it('localizes product controls, counts and accessibility but not stored names or identifiers', async () => {
    await open('/admin');
    expect(container.querySelector('h1')?.textContent).toBe(label('Products', 'Produkty'));
    expect(container.textContent).toContain(label('1 product', '1 produkt'));
    expect(container.querySelector('input[type="search"]')?.getAttribute('placeholder')).toBe(label('Search by name or category…', 'Szukaj według nazwy lub kategorii…'));
    expect(container.querySelector('input[type="checkbox"]')?.getAttribute('aria-label')).toBe(label('Published: Products', 'Opublikowany: Products'));
    expect(container.querySelector('.admin-table__name')?.textContent).toBe('Products');
    expect(container.querySelector('.admin-table__name')?.getAttribute('href')).toBe(`/admin/products/${product.id}`);
  });

  it('localizes network errors and retry controls', async () => {
    request.mockRejectedValueOnce(new TypeError('offline'));
    await open('/admin');
    expect(container.textContent).toContain(label('Something went wrong', 'Wystąpił błąd'));
    expect(container.textContent).toContain(label("Can't reach the shop server. Check your connection and try again.", 'Nie można połączyć się z serwerem sklepu. Sprawdź połączenie i spróbuj ponownie.'));
    expect(container.querySelector('button.btn--primary')?.textContent).toBe(label('Try again', 'Spróbuj ponownie'));
  });

  it('localizes previews without changing stored product HTML, names or video titles', async () => {
    await open(`/product/${product.id}`);
    expect(container.querySelector('h1')?.textContent).toBe('Products');
    expect(container.textContent).toContain(label('Admin preview only.', 'Podgląd tylko dla administratora.'));
    expect(container.querySelector('.rich-description p')?.innerHTML).toBe('Save product <strong>Sign in</strong>');
    expect(container.querySelector('.rich-description video')?.getAttribute('title')).toBe('Stored video title');
    expect(container.querySelector('[aria-roledescription]')?.getAttribute('aria-roledescription')).toBe(label('carousel', 'karuzela'));
    expect(container.querySelector('input[type="text"]')?.getAttribute('placeholder')).toBe(label('e.g. Happy Birthday Anna!', 'np. Wszystkiego najlepszego, Anno!'));
  });

  it('localizes the rich editor and save controls without serializing translated UI into the product', async () => {
    await import('../components/DescriptionEditor');
    await open(`/admin/products/${product.id}`);
    expect(container.textContent).toContain(label('Basic information', 'Podstawowe informacje'));
    expect(container.querySelector('[role="textbox"]')?.getAttribute('aria-label')).toBe(label('Product description', 'Opis produktu'));
    expect(container.textContent).toContain(label('Drag to move video', 'Przeciągnij, aby przenieść film'));
    expect(container.querySelector('[aria-label="' + label('Enable engraving', 'Włącz grawer') + '"]')).not.toBeNull();
    const addMedia = [...container.querySelectorAll('button')].find((button) => button.textContent === label('Add media link', 'Dodaj link do multimediów'));
    await act(async () => addMedia!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(label('Enter a valid HTTP(S) media URL.', 'Wprowadź prawidłowy adres HTTP(S) pliku multimedialnego.'));
    const save = [...container.querySelectorAll('button')].find((button) => button.textContent === label('Save product', 'Zapisz produkt'));
    expect(save).toBeDefined();
    await act(async () => save!.click());
    const write = request.mock.calls.find(([, options]) => options?.method === 'PUT');
    expect(write).toBeDefined();
    const body = JSON.parse(String(write![1]?.body)) as Product;
    expect(body.name).toBe(product.name);
    expect(body.description).toBe(product.description);
    expect(body.descriptionFormat).toBe('html');
    expect(body.colors).toEqual(product.colors);
    expect(body.engraving).toEqual(product.engraving);
    expect(body.shape).toBe(product.shape);
    expect(body.description).not.toContain(label('Drag to move video', 'Przeciągnij, aby przenieść film'));
  });

  it('localizes order statuses and dates while keeping status option values and customer data unchanged', async () => {
    await open('/admin/orders');
    expect(container.querySelector('h1')?.textContent).toBe(label('Orders', 'Zamówienia'));
    const printing = container.querySelector<HTMLOptionElement>('option[value="printing"]');
    expect(printing?.textContent).toBe(label('Printing', 'W druku'));
    expect(printing?.value).toBe('printing');
    expect(container.textContent).toContain('Original Customer');
    expect(container.textContent).toContain('PF-ORIGINAL');
    const expectedLocale = language === 'pl' ? 'pl-PL' : 'en-US';
    expect(container.textContent).toContain(new Intl.DateTimeFormat(expectedLocale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(order.createdAt)));
    expect(container.textContent).toContain(new Intl.NumberFormat(expectedLocale, { style: 'currency', currency: 'USD' }).format(order.total));
  });

  it('localizes fulfillment controls without changing saved status IDs or internal notes', async () => {
    await open(`/admin/orders/${order.id}`);
    expect(container.textContent).toContain(label('Fulfilment', 'Realizacja'));
    expect(container.querySelector('textarea')?.value).toBe('Stored English note');
    expect(container.textContent).toContain('Original street');
    await act(async () => {
      const status = container.querySelector('select')!;
      status.value = 'paid';
      status.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const save = [...container.querySelectorAll('button')].find((button) => button.textContent === label('Save changes', 'Zapisz zmiany'));
    await act(async () => save!.click());
    const write = request.mock.calls.find(([, options]) => options?.method === 'PATCH');
    expect(JSON.parse(String(write?.[1]?.body))).toEqual({ status: 'paid', adminNote: 'Stored English note' });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(label('Order updated.', 'Zamówienie zaktualizowane.'));
  });
});
