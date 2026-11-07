// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { ProjectOrder, ReadyProduct } from '../types';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

const product = (id: string, patch: Partial<ReadyProduct> = {}): ReadyProduct => ({
  id,
  title: `Planter set ${id}`,
  description: 'Self-watering planter with saucer.',
  project: {
    source: 'printables', id: '12345', title: 'Planter', description: '', license: 'CC BY 4.0',
    thumbnailUrl: 'https://media.printables.com/cover.jpg', url: 'https://www.printables.com/model/12345-planter', author: 'Prusa',
  },
  items: [
    { file: { id: '9', name: 'planter.stl', sizeBytes: 20480, thumbnailUrl: null }, settings: { quantity: 1, scalePercent: 100, filaments: [{ material: 'PETG', color: 'Black' }] } },
    { file: { id: '10', name: 'saucer.stl', sizeBytes: null, thumbnailUrl: null }, settings: { quantity: 2, scalePercent: 120, filaments: [{ material: 'TPU', color: '' }, { material: 'PLA', color: 'White' }] } },
  ],
  price: { total: 17.6, handlingFee: 4.5, setPrice: 13.1, currency: 'USD' },
  createdAt: '', updatedAt: '',
  ...patch,
});

function stubApi(products: ReadyProduct[] = [product('a'), product('b', { title: 'Hook', price: { total: 9, handlingFee: 4.5, setPrice: 4.5, currency: 'USD' } })]) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/project-products') return Response.json(products);
    const ordered = /^\/api\/project-products\/([^/]+)\/orders$/.exec(url);
    if (ordered) {
      const body = JSON.parse(String(init?.body));
      const chosen = products.find((p) => p.id === ordered[1])!;
      // Like the server: another material than offered makes it a quote request.
      const materialsChanged = chosen.items.some((item, i) => item.settings.filaments.some((f, slot) => f.material !== body.items[i].filaments[slot].material));
      return Response.json({
        id: 'po', number: 'PJ-261107-ABCD', status: 'new', customer: body.customer, project: chosen.project, projectVerified: true,
        items: chosen.items, sameSettingsForAll: false, notes: body.notes, adminNote: '', createdAt: '', updatedAt: '',
        requiresQuote: materialsChanged,
        ...(!materialsChanged && { review: { total: Math.round((chosen.price.handlingFee + body.sets * chosen.price.setPrice) * 100) / 100, currency: 'USD' } }),
        product: { id: chosen.id, title: chosen.title, sets: body.sets, materialsChanged },
      } satisfies ProjectOrder, { status: 201 });
    }
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const cards = () => [...container.querySelectorAll<HTMLElement>('.model-result')];
const panel = () => container.querySelector<HTMLElement>('.project-order')!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const orderButton = () => panel().querySelector<HTMLButtonElement>('.project-order__submit')!;
function fill(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
const named = (name: string) => dialog()!.querySelector<HTMLInputElement & HTMLSelectElement>(`[aria-label="${name}"]`)!;
function choose(select: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}
function fillCustomer() {
  for (const [label, value] of [['Full name', 'Anna Nowak'], ['Email', 'anna@example.com'], ['Address', 'Długa 1'], ['City', 'Kraków'], ['Postal code', '30-001'], ['Country', 'Poland']]) {
    fill(inDialog(label), value);
  }
}
const inDialog = (label: string) => [...dialog()!.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent === label)!
  .querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')!;

async function open() {
  const fetch = stubApi();
  history.replaceState(null, '', '/ready-to-print');
  await act(async () => root.render(<App />));
  return fetch;
}

describe('ready-to-print projects', () => {
  it('has its own tab listing projects like search results, with their printing price', async () => {
    stubApi();
    await act(async () => root.render(<App />));
    const tab = [...container.querySelectorAll<HTMLAnchorElement>('header nav a')].find((a) => a.textContent === 'Ready to print')!;
    expect(tab.getAttribute('href')).toBe('/ready-to-print');
    await act(async () => tab.click());
    expect(container.querySelector('h1')?.textContent).toBe('Ready to print');
    expect(cards()).toHaveLength(2);
    const [first] = cards();
    expect(first.querySelector('h2')?.textContent).toBe('Planter set a');
    expect(first.querySelector('.source-badge')?.textContent).toBe('Printables');
    expect(first.querySelector('img')?.getAttribute('src')).toBe('https://media.printables.com/cover.jpg');
    expect(first.querySelector('.model-result__description')?.textContent).toBe('Self-watering planter with saucer.');
    expect(first.querySelector('.model-result__price')?.textContent).toBe('Printed for $17.60');
    expect(first.querySelector<HTMLAnchorElement>('a.model-result__link')?.href).toBe('https://www.printables.com/model/12345-planter');
    expect(cards()[1].querySelector('.model-result__price')?.textContent).toBe('Printed for $9.00');
  });

  it('orders sets of the fixed models at the fixed price and replaces the confirmation on the next click', async () => {
    const fetch = await open();
    expect(panel().textContent).toContain('No project selected yet');
    await act(async () => cards()[0].click());
    expect(panel().querySelector('.project-order__title')?.textContent).toBe('Planter set a');
    expect(panel().querySelector('.project-order__price')?.textContent).toBe('$17.60');
    expect(orderButton().textContent).toBe('Order for $17.60…');

    await act(async () => orderButton().click());
    const models = [...dialog()!.querySelectorAll('.project-items-summary > li')];
    expect(models[0].querySelector('.project-model__head')?.textContent).toBe('planter.stl20 kB');
    expect(models[0].querySelector('.project-items-summary__settings')?.textContent).toBe('1 × at 100%');
    expect(models[1].querySelector('.project-items-summary__settings')?.textContent).toBe('2 × at 120%');
    // Every filament starts as offered; quantities and scale are fixed.
    expect(named('Material for planter.stl').value).toBe('PETG');
    expect(named('Color for planter.stl').value).toBe('Black');
    expect(named('Material for saucer.stl, color 1').value).toBe('TPU');
    expect(named('Color for saucer.stl, color 2').value).toBe('White');
    expect(dialog()!.querySelectorAll('input[type="number"]')).toHaveLength(1);
    expect(dialog()!.querySelector('.ready-dialog__total strong')?.textContent).toBe('$17.60');

    await act(async () => fill(inDialog('Number of sets') as HTMLInputElement, '3'));
    expect(dialog()!.querySelector('.ready-dialog__total strong')?.textContent).toBe('$43.80');
    expect(dialog()!.querySelector('.ready-dialog__total small')?.textContent).toBe('3 × $13.10 + handling $4.50');
    expect(dialog()!.querySelector('button[type="submit"]')?.textContent).toBe('Order for $43.80');
    // New colors keep the price.
    await act(async () => {
      fill(named('Color for planter.stl'), ' Glow in the dark ');
      fill(named('Color for saucer.stl, color 1'), 'Red');
    });
    expect(dialog()!.querySelector('.ready-dialog__total strong')?.textContent).toBe('$43.80');
    expect(dialog()!.querySelector('button[type="submit"]')?.textContent).toBe('Order for $43.80');
    await act(async () => {
      fill(inDialog('Notes for the workshop'), ' Gift wrap ');
      fillCustomer();
    });
    await act(async () => dialog()!.querySelector('form')!.requestSubmit());
    const [url, init] = fetch.mock.calls.find(([called]) => called.endsWith('/orders'))!;
    expect(url).toBe('/api/project-products/a/orders');
    expect(JSON.parse(String(init!.body))).toEqual({
      customer: { name: 'Anna Nowak', email: 'anna@example.com', address: { line1: 'Długa 1', city: 'Kraków', postalCode: '30-001', country: 'Poland' } },
      sets: 3, notes: 'Gift wrap',
      items: [
        { fileId: '9', filaments: [{ material: 'PETG', color: 'Glow in the dark' }] },
        { fileId: '10', filaments: [{ material: 'TPU', color: 'Red' }, { material: 'PLA', color: 'White' }] },
      ],
    });
    expect(dialog()).toBeNull();
    expect(panel().querySelector('[role="status"]')?.textContent).toContain('Order PJ-261107-ABCD received.');
    expect(panel().textContent).toContain('We will print it for $43.80');

    await act(async () => cards()[1].click());
    expect(panel().textContent).not.toContain('received');
    expect(panel().querySelector('.project-order__title')?.textContent).toBe('Hook');
  });

  it('turns the order into a quote request when the customer changes a material', async () => {
    const fetch = await open();
    await act(async () => cards()[0].click());
    await act(async () => orderButton().click());
    await act(async () => choose(named('Material for saucer.stl, color 2'), 'PETG'));
    expect(dialog()!.querySelector('[role="status"]')?.textContent).toContain('You changed a material, so the shown price no longer applies');
    expect(dialog()!.querySelector('.ready-dialog__total strong')?.textContent).toBe('Quote needed');
    expect(dialog()!.querySelector('button[type="submit"]')?.textContent).toBe('Request a quote');
    expect(named('Material for saucer.stl, color 2').closest('li')?.classList.contains('is-changed')).toBe(true);

    // Restoring the offered materials brings the price back, keeping colors.
    await act(async () => fill(named('Color for saucer.stl, color 2'), 'Blue'));
    await act(async () => [...dialog()!.querySelectorAll('button')].find((b) => b.textContent === 'Use the offered materials')!.click());
    expect(named('Material for saucer.stl, color 2').value).toBe('PLA');
    expect(named('Color for saucer.stl, color 2').value).toBe('Blue');
    expect(dialog()!.querySelector('button[type="submit"]')?.textContent).toBe('Order for $17.60');

    await act(async () => choose(named('Material for planter.stl'), 'ABS'));
    await act(async () => fillCustomer());
    await act(async () => dialog()!.querySelector('form')!.requestSubmit());
    const body = JSON.parse(String(fetch.mock.calls.find(([url]) => url.endsWith('/orders'))![1]!.body));
    expect(body.items[0].filaments).toEqual([{ material: 'ABS', color: 'Black' }]);
    expect(panel().querySelector('[role="status"]')?.textContent).toContain('With the changed materials we need to quote it first; we will email the price to anna@example.com.');
    expect(panel().textContent).not.toContain('We will print it for');
  });

  it('says when nothing is offered yet', async () => {
    stubApi([]);
    history.replaceState(null, '', '/ready-to-print');
    await act(async () => root.render(<App />));
    expect(container.textContent).toContain('No ready-to-print projects yet.');
  });
});
