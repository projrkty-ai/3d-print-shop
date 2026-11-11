// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { ModelSearchResponse, ModelSearchResult, Order, ProjectDetails } from '../types';

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

const model = (source: ModelSearchResult['source'], id: string, overrides: Partial<ModelSearchResult> = {}): ModelSearchResult => ({
  source, id, title: `${source} model ${id}`, description: `About ${id}`, thumbnailUrl: null, url: `https://example.com/${source}/${id}`, author: null,
  ...overrides,
});

const searchResponse: ModelSearchResponse = {
  query: 'wall hook',
  results: [
    model('thingiverse', '1', {
      title: 'Sturdy wall hook', description: 'Holds 5 kg. <b>Not bold</b>', author: 'maker_anna',
      thumbnailUrl: 'https://cdn.thingiverse.com/assets/1/preview.jpg', url: 'https://www.thingiverse.com/thing:1',
    }),
    model('printables', '12345', { title: 'Hook set', description: '', url: 'https://www.printables.com/model/12345-hook-set' }),
  ],
  sources: [
    { source: 'thingiverse', label: 'Thingiverse', status: 'ok', count: 1, total: 1843, hasMore: true, searchUrl: 'https://www.thingiverse.com/search?q=wall+hook&type=things' },
    { source: 'printables', label: 'Printables', status: 'ok', count: 1, total: null, hasMore: true, searchUrl: 'https://www.printables.com/search/models?q=wall+hook' },
    { source: 'makerworld', label: 'MakerWorld', status: 'error', count: 0, total: null, hasMore: false, searchUrl: 'https://makerworld.com/en/search/models?keyword=wall+hook' },
  ],
  nextCursor: 'cursor-page-2',
};

type Answer = (url: URL, init?: RequestInit) => Response | Promise<Response>;

const thingDetails: ProjectDetails = {
  project: {
    source: 'thingiverse', id: '1', title: 'Sturdy wall hook (verified)', description: '', license: null,
    thumbnailUrl: null, url: 'https://www.thingiverse.com/thing:1', author: 'maker_anna',
  },
  files: [{ id: '5', name: 'wall-hook.stl', sizeBytes: 1000, thumbnailUrl: null }],
  filesAvailable: true,
};

const projectDetails: ProjectDetails = {
  project: {
    source: 'printables', id: '12345', title: 'Hook set (verified)', description: 'Two hooks.', license: 'CC BY 4.0',
    thumbnailUrl: 'https://media.printables.com/cover.jpg', url: 'https://www.printables.com/model/12345-hook-set', author: 'Prusa',
  },
  files: [
    { id: '9', name: 'hook.stl', sizeBytes: 20480, thumbnailUrl: 'https://media.printables.com/9.png' },
    { id: '10', name: 'hook-large.stl', sizeBytes: 2_097_152, thumbnailUrl: null },
  ],
  filesAvailable: true,
};

/** Answers the catalog, search, project lookup and project order endpoints the way the backend does. */
function stubApi(
  search: Answer = () => Response.json(searchResponse),
  project: Answer = (url) => Response.json(url.searchParams.get('source') === 'thingiverse' ? thingDetails : projectDetails),
) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const parsed = new URL(url, 'http://shop.test');
    if (parsed.pathname === '/api/model-search/project') return project(parsed, init);
    if (parsed.pathname === '/api/model-search') return search(parsed, init);
    if (parsed.pathname === '/api/orders') {
      const body = JSON.parse(String(init?.body)) as { customer: Order['customer']; project: Omit<NonNullable<Order['project']>, 'description' | 'license' | 'verified'>; sameSettingsForAll: boolean };
      return Response.json({
        id: 'po-1', number: 'PJ-261106-K7QX', status: 'received', source: 'project', customer: body.customer, customerNote: '', currency: 'USD', items: [],
        project: { ...body.project, description: '', license: null, verified: true }, price: { mode: 'quote', handlingFee: 5, estimated: null, reviewed: null, total: null },
        createdAt: '', updatedAt: '',
      } satisfies Order, { status: 201 });
    }
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const calls = (fetch: ReturnType<typeof stubApi>, path: string) => fetch.mock.calls.filter(([url]) => url.startsWith(path));
const searchCalls = (fetch: ReturnType<typeof stubApi>) => fetch.mock.calls.map(([url]) => url).filter((url) => url.startsWith('/api/model-search'));

function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const cards = () => [...container.querySelectorAll<HTMLElement>('.model-result')];
const cardLink = (card: Element) => card.querySelector<HTMLAnchorElement>('a.model-result__link')!;
const panel = () => container.querySelector<HTMLElement>('.project-order')!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const orderButton = () => panel().querySelector<HTMLButtonElement>('.project-order__submit')!;
const modelBoxes = () => [...dialog()!.querySelectorAll<HTMLInputElement>('.project-model input[type="checkbox"]')];
/** A dialog control by its accessible name: aria-label, or the text of its label. */
function inDialog(name: string): HTMLInputElement {
  const labelled = dialog()!.querySelector<HTMLInputElement>(`[aria-label="${name}"]`);
  if (labelled) return labelled;
  const label = [...dialog()!.querySelectorAll('label')].find((l) => (l.querySelector('span')?.textContent ?? l.textContent) === name);
  if (!label) throw new Error(`No control named "${name}"`);
  return label.querySelector('input, select, textarea') as HTMLInputElement;
}
const button = (text: string, index = 0) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent === text || b.getAttribute('aria-label') === text)[index];
function fillCustomer() {
  for (const [name, value] of [['Full name', 'Anna Nowak'], ['Email', 'anna@example.com'], ['Address', 'Długa 1'], ['City', 'Kraków'], ['Postal code', '30-001'], ['Country', 'Poland']]) {
    fill(inDialog(name), value);
  }
}
function fill(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}
const statusText = () => container.querySelector('[aria-label="Searched websites"]')!.textContent!;
const loadMoreButton = () => [...container.querySelectorAll('button')].find((button) => /Load more|Loading more/.test(button.textContent!));

async function openResults(search?: Answer, project?: Answer) {
  const fetch = stubApi(search, project);
  history.replaceState(null, '', '/search?q=wall+hook');
  await act(async () => root.render(<App />));
  return fetch;
}

describe('model search', () => {
  it('offers a search bar at the top of every page and opens the results page', async () => {
    const fetch = stubApi();
    history.replaceState(null, '', '/cart');
    await act(async () => root.render(<App />));
    const form = container.querySelector<HTMLFormElement>('header form[role="search"]')!;
    const input = form.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(input.getAttribute('aria-label')).toBe('Search 3D models on Thingiverse, Printables and MakerWorld');

    await act(async () => type(input, '  wall   hook '));
    await act(async () => form.requestSubmit());
    expect(location.pathname).toBe('/search');
    expect(new URLSearchParams(location.search).get('q')).toBe('wall hook');
    expect(fetch).toHaveBeenCalledWith('/api/model-search?q=wall+hook', expect.objectContaining({ method: 'GET' }));
    expect(container.querySelector('h1')?.textContent).toBe('Models matching “wall hook”');
  });

  it('shows results from every site as the same card linking to the original posting', async () => {
    await openResults();
    expect(container.querySelector<HTMLInputElement>('header input[type="search"]')?.value).toBe('wall hook');

    expect(cards()).toHaveLength(2);
    for (const card of cards()) {
      expect(cardLink(card).target).toBe('_blank');
      expect(cardLink(card).rel).toBe('noopener noreferrer');
      expect(card.querySelector('.model-result__media')).not.toBeNull();
      expect(card.querySelector('h2')).not.toBeNull();
    }
    const [thingiverse, printables] = cards();
    expect(cardLink(thingiverse).href).toBe('https://www.thingiverse.com/thing:1');
    expect(thingiverse.querySelector('img')?.getAttribute('src')).toBe('https://cdn.thingiverse.com/assets/1/preview.jpg');
    expect(thingiverse.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(thingiverse.querySelector('.source-badge')?.textContent).toBe('Thingiverse');
    expect(thingiverse.querySelector('h2')?.textContent).toBe('Sturdy wall hook');
    expect(thingiverse.querySelector('.model-result__author')?.textContent).toBe('by maker_anna');
    // Descriptions are text: markup from other sites is never rendered.
    expect(thingiverse.querySelector('.model-result__description')?.textContent).toBe('Holds 5 kg. <b>Not bold</b>');
    expect(thingiverse.querySelector('b')).toBeNull();
    expect(thingiverse.textContent).toContain('View on Thingiverse');

    expect(cardLink(printables).href).toBe('https://www.printables.com/model/12345-hook-set');
    expect(printables.querySelector('img')).toBeNull();
    expect(printables.querySelector('.model-result__placeholder')).not.toBeNull();
    expect(printables.querySelector('.model-result__description')).toBeNull();
    expect(printables.textContent).toContain('View on Printables');
  });

  it('reports the total number of matches on each site, not the loaded count', async () => {
    await openResults();
    const items = [...container.querySelectorAll('.model-sources__item')].map((item) => item.textContent);
    expect(items[0]).toContain('1,843 results');
    expect(items[1]).toContain('1+ results'); // Printables did not report a total
    expect(items[2]).toContain("couldn't be searched right now");
    const links = [...container.querySelectorAll('[aria-label="Searched websites"] a')].map((link) => link.getAttribute('href'));
    expect(links).toContain('https://makerworld.com/en/search/models?keyword=wall+hook');
  });

  it('shows the license note at the top of the results', async () => {
    await openResults();
    const note = [...container.querySelectorAll('p')].find((p) => p.textContent!.startsWith('These models are published by their designers'))!;
    const grid = container.querySelector('.model-results')!;
    expect(note.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.compareDocumentPosition(cards()[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('loads more results with the cursor, appends them and hides the button at the end', async () => {
    let releasePage: () => void = () => undefined;
    const pageTwo: ModelSearchResponse = {
      query: 'wall hook',
      results: [model('thingiverse', '2'), model('printables', '12345'), model('printables', '777')],
      sources: [
        { ...searchResponse.sources[0], count: 1, hasMore: false },
        { ...searchResponse.sources[1], count: 2, hasMore: false },
      ],
      nextCursor: null,
    };
    const fetch = await openResults((url) => url.searchParams.get('cursor') === 'cursor-page-2'
      ? new Promise((resolve) => { releasePage = () => resolve(Response.json(pageTwo)); })
      : Response.json(searchResponse));
    expect(container.textContent).toContain('Showing 2 models');

    await act(async () => loadMoreButton()!.click());
    expect(searchCalls(fetch)).toEqual(['/api/model-search?q=wall+hook', '/api/model-search?q=wall+hook&cursor=cursor-page-2']);
    expect(loadMoreButton()?.textContent).toBe('Loading more models…');
    expect(loadMoreButton()?.disabled).toBe(true);
    expect(cards()).toHaveLength(2);

    await act(async () => releasePage());
    // Appended after the first page; the duplicate Printables model is shown once.
    expect(cards().map((card) => cardLink(card).href)).toEqual([
      'https://www.thingiverse.com/thing:1', 'https://www.printables.com/model/12345-hook-set',
      'https://example.com/thingiverse/2', 'https://example.com/printables/777',
    ]);
    expect(container.textContent).toContain('Showing 4 models');
    expect(statusText()).toContain('1,843 results');
    expect(statusText()).toContain('3 results'); // Printables: everything loaded
    expect(statusText()).toContain("couldn't be searched right now");
    expect(loadMoreButton()).toBeUndefined();
  });

  it('keeps loaded results when loading more fails and lets the customer retry', async () => {
    let failing = true;
    const fetch = await openResults((url) => {
      if (!url.searchParams.has('cursor')) return Response.json(searchResponse);
      return failing
        ? Response.json({ error: 'Something went wrong on our side.' }, { status: 500 })
        : Response.json({
          query: 'wall hook', results: [model('thingiverse', '2')], nextCursor: 'cursor-page-3',
          sources: [{ ...searchResponse.sources[0], hasMore: true }, { ...searchResponse.sources[1], status: 'error', count: 0, hasMore: false }],
        } satisfies ModelSearchResponse);
    });
    await act(async () => loadMoreButton()!.click());
    expect(container.querySelector('.model-search-page__more [role="alert"]')?.textContent).toBe('Something went wrong on our side.');
    expect(cards()).toHaveLength(2);
    expect(loadMoreButton()?.disabled).toBe(false);

    failing = false;
    await act(async () => loadMoreButton()!.click());
    expect(searchCalls(fetch)).toHaveLength(3);
    expect(container.querySelector('.model-search-page__more [role="alert"]')).toBeNull();
    expect(cards()).toHaveLength(3);
    const printables = [...container.querySelectorAll('.model-sources__item')][1].textContent;
    expect(printables).toContain('1 result');
    expect(printables).toContain("couldn't load more");
    expect(loadMoreButton()?.textContent).toBe('Load more results');
  });

  it('falls back to a placeholder when a thumbnail cannot be loaded', async () => {
    await openResults();
    const card = cards()[0];
    await act(async () => card.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('.model-result__placeholder')).not.toBeNull();
  });

  it('reports no matches and server errors with a retry', async () => {
    let answer = () => Response.json({ error: 'Something went wrong on our side.' }, { status: 500 });
    const fetch = stubApi(() => answer());
    history.replaceState(null, '', '/search?q=unicorn');
    await act(async () => root.render(<App />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Something went wrong on our side.');

    answer = () => Response.json({ ...searchResponse, query: 'unicorn', results: [], nextCursor: null });
    await act(async () => container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click());
    expect(searchCalls(fetch)).toHaveLength(2);
    expect(container.textContent).toContain('No models found for “unicorn”.');
    expect(loadMoreButton()).toBeUndefined();
  });

  it('shows only a preview of the last clicked result in the order box', async () => {
    const fetch = await openResults();
    expect(panel().textContent).toContain('No project selected yet');
    expect(panel().querySelector('.project-order__submit')).toBeNull();
    expect(calls(fetch, '/api/model-search/project')).toHaveLength(0);

    await act(async () => cards()[1].querySelector('h2')!.click());
    expect(cards()[1].dataset.selected).toBe('true');
    expect(cards()[1].querySelector('button')?.textContent).toBe('Selected for order');
    expect(calls(fetch, '/api/model-search/project').map(([url]) => url)).toEqual(['/api/model-search/project?source=printables&id=12345']);
    expect(panel().querySelector('.project-order__title')?.textContent).toBe('Hook set (verified)');
    expect(panel().textContent).toContain('License: CC BY 4.0');
    expect(panel().textContent).toContain('Models in this project: 2');
    expect(panel().querySelector('.project-order__project a')?.getAttribute('href')).toBe('https://www.printables.com/model/12345-hook-set');
    // Preview only: choices and contact details belong to the second step.
    expect(panel().querySelector('input[type="checkbox"], input[type="email"], select, textarea')).toBeNull();
    expect(dialog()).toBeNull();

    await act(async () => cards()[0].click());
    expect(panel().querySelector('.project-order__title')?.textContent).toBe('Sturdy wall hook (verified)');
  });

  it('orders with one selection for all models, including several materials and colors, in a dialog', async () => {
    const fetch = await openResults();
    await act(async () => cards()[1].click());
    await act(async () => orderButton().click());
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement?.textContent).toBe('Close');
    expect(dialog()!.querySelector('h2')?.textContent).toBe('Order “Hook set (verified)”');
    const same = inDialog('Use one selection for all models');
    expect(same.checked).toBe(true);
    expect(modelBoxes().map((box) => box.checked)).toEqual([true, true]);
    expect(dialog()!.textContent).toContain('2 MB');
    expect(dialog()!.querySelectorAll('.print-settings')).toHaveLength(1);

    await act(async () => {
      fill(inDialog('Quantity for all selected models'), '2');
      fill(inDialog('Scale in percent for all selected models'), '150');
      fill(inDialog('Material for all selected models'), 'PETG');
      fill(inDialog('Color for all selected models'), ' Black ');
    });
    await act(async () => button('+ Add material or color').click());
    await act(async () => {
      fill(inDialog('Material for all selected models, color 2'), 'TPU');
      fill(inDialog('Color for all selected models, color 2'), 'Red');
      fill(inDialog('Notes for the workshop'), 'No supports please');
      fillCustomer();
    });
    await act(async () => dialog()!.querySelector('form')!.requestSubmit());

    const body = JSON.parse(String((calls(fetch, '/api/orders')[0][1] as RequestInit).body));
    const settings = { quantity: 2, scalePercent: 150, filaments: [{ material: 'PETG', color: 'Black' }, { material: 'TPU', color: 'Red' }] };
    expect(body).toEqual({
      source: 'project',
      customer: { name: 'Anna Nowak', email: 'anna@example.com', address: { line1: 'Długa 1', city: 'Kraków', postalCode: '30-001', country: 'Poland' } },
      project: {
        source: 'printables', id: '12345', title: 'Hook set (verified)', url: 'https://www.printables.com/model/12345-hook-set',
        thumbnailUrl: 'https://media.printables.com/cover.jpg', author: 'Prusa',
      },
      items: [{ file: { id: '9', name: 'hook.stl' }, settings }, { file: { id: '10', name: 'hook-large.stl' }, settings }],
      sameSettingsForAll: true,
      customerNote: 'No supports please',
    });
    expect(dialog()).toBeNull();
    expect(panel().querySelector('[role="status"]')?.textContent).toContain('Order PJ-261106-K7QX received.');
    expect(orderButton().textContent).toBe('Order this project again…');
  });

  it('replaces the confirmation with the newly clicked project after an order was sent', async () => {
    await openResults();
    await act(async () => cards()[1].click());
    await act(async () => orderButton().click());
    await act(async () => fillCustomer());
    await act(async () => dialog()!.querySelector('form')!.requestSubmit());
    expect(panel().textContent).toContain('Order PJ-261106-K7QX received.');

    await act(async () => cards()[0].click());
    expect(panel().textContent).not.toContain('received');
    expect(panel().querySelector('.project-order__title')?.textContent).toBe('Sturdy wall hook (verified)');
    expect(cards()[0].dataset.selected).toBe('true');
    expect(orderButton().textContent).toBe('Order this project…');
    await act(async () => orderButton().click());
    expect(dialog()!.querySelector('h2')?.textContent).toBe('Order “Sturdy wall hook (verified)”');
    // Contact details typed for the first order are still there for the next one.
    expect(inDialog('Email').value).toBe('anna@example.com');
  });

  it('orders separate settings per model, starting from the shared selection', async () => {
    const fetch = await openResults();
    await act(async () => cards()[1].click());
    await act(async () => orderButton().click());
    await act(async () => fill(inDialog('Material for all selected models'), 'PLA'));
    await act(async () => inDialog('Use one selection for all models').click());
    expect(dialog()!.querySelectorAll('.print-settings')).toHaveLength(2);
    expect(inDialog('Material for hook.stl').value).toBe('PLA');
    expect(inDialog('Material for hook-large.stl').value).toBe('PLA');

    await act(async () => fill(inDialog('Quantity for hook.stl'), '4'));
    await act(async () => button('+ Add material or color', 1).click());
    await act(async () => {
      fill(inDialog('Color for hook-large.stl, color 1'), 'White');
      fill(inDialog('Material for hook-large.stl, color 2'), 'ABS');
      fill(inDialog('Color for hook-large.stl, color 2'), 'Gold');
    });
    await act(async () => button('Remove hook-large.stl, color 2').click());
    await act(async () => button('+ Add material or color', 1).click());
    await act(async () => fill(inDialog('Color for hook-large.stl, color 2'), 'Blue'));
    await act(async () => modelBoxes()[0].click());
    expect(dialog()!.querySelectorAll('.print-settings')).toHaveLength(1);
    await act(async () => modelBoxes()[0].click());
    await act(async () => fillCustomer());
    await act(async () => dialog()!.querySelector('form')!.requestSubmit());

    const body = JSON.parse(String((calls(fetch, '/api/orders')[0][1] as RequestInit).body));
    expect(body.sameSettingsForAll).toBe(false);
    expect(body.items).toEqual([
      { file: { id: '9', name: 'hook.stl' }, settings: { quantity: 4, scalePercent: 100, filaments: [{ material: 'PLA', color: '' }] } },
      {
        file: { id: '10', name: 'hook-large.stl' },
        settings: { quantity: 1, scalePercent: 100, filaments: [{ material: 'PLA', color: 'White' }, { material: 'any', color: 'Blue' }] },
      },
    ]);
  });

  it('requires a model, closes with Escape, and keeps the choices across reloads', async () => {
    const fetch = await openResults();
    await act(async () => cards()[1].click());
    await act(async () => orderButton().click());
    await act(async () => inDialog('Use one selection for all models').click());
    await act(async () => fill(inDialog('Quantity for hook.stl'), '3'));
    await act(async () => button('Select none').click());
    await act(async () => fillCustomer());
    await act(async () => dialog()!.querySelector('form')!.requestSubmit());
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toContain('Select at least one model to print.');
    expect(calls(fetch, '/api/orders')).toHaveLength(0);

    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(orderButton());
    expect(document.body.style.overflow).toBe('');

    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<App />));
    expect(cards()[1].dataset.selected).toBe('true');
    await act(async () => orderButton().click());
    expect(inDialog('Use one selection for all models').checked).toBe(false);
    expect(modelBoxes().map((box) => box.checked)).toEqual([false, false]);
    await act(async () => modelBoxes()[0].click());
    expect(inDialog('Quantity for hook.stl').value).toBe('3');
  });

  it('loads a pasted link and orders the whole project when the site lists no models', async () => {
    const fetch = await openResults(undefined, () => Response.json({ ...projectDetails, files: [], filesAvailable: false }));
    const urlInput = panel().querySelector<HTMLInputElement>('input[type="url"]')!;
    await act(async () => fill(urlInput, ' https://www.printables.com/model/12345-hook-set '));
    await act(async () => urlInput.form!.requestSubmit());
    expect(calls(fetch, '/api/model-search/project').map(([url]) => url)).toEqual([
      '/api/model-search/project?url=https%3A%2F%2Fwww.printables.com%2Fmodel%2F12345-hook-set',
    ]);
    expect(cards()[1].dataset.selected).toBe('true');
    expect(panel().textContent).toContain('Models are not listed separately');

    await act(async () => orderButton().click());
    expect(dialog()!.textContent).toContain('we will print the whole project');
    expect(dialog()!.querySelector('input[type="checkbox"]')).toBeNull();
    await act(async () => {
      fill(inDialog('Quantity for the whole project'), '5');
      fillCustomer();
    });
    await act(async () => dialog()!.querySelector('form')!.requestSubmit());
    const body = JSON.parse(String((calls(fetch, '/api/orders')[0][1] as RequestInit).body));
    expect(body.items).toEqual([{ file: null, settings: { quantity: 5, scalePercent: 100, filaments: [{ material: 'any', color: '' }] } }]);
    expect(body.sameSettingsForAll).toBe(true);
  });

  it('reports lookup errors while still previewing the clicked result', async () => {
    await openResults(undefined, () => Response.json({ error: 'This project could not be loaded from its website right now. Please try again later.' }, { status: 502 }));
    await act(async () => cards()[0].click());
    expect(panel().querySelector('[role="alert"]')?.textContent).toContain('could not be loaded from its website');
    expect(panel().querySelector('.project-order__title')?.textContent).toBe('Sturdy wall hook');
    expect(orderButton().disabled).toBe(true);
  });

  it('does not search for too short queries', async () => {
    const fetch = stubApi();
    history.replaceState(null, '', '/search?q=a');
    await act(async () => root.render(<App />));
    expect(container.textContent).toContain('Enter 2 to 100 characters to search.');
    expect(searchCalls(fetch)).toHaveLength(0);
  });
});
