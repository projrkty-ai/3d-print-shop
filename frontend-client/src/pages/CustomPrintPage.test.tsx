// @vitest-environment jsdom
import { File as NodeFile } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { ProductPreview } from '../components/ProductPreview';
import type { CustomOrder, CustomOrderInput, PrintSettings } from '../types';

/** Read-time thumbnails are a fixed image; ones redrawn in chosen colors name their color. */
const thumbnail = vi.hoisted(() => vi.fn((_geometry: unknown, color: string, partColors?: Record<string, string>) =>
  (partColors ? `data:image/png;color=${color}` : 'data:image/png;base64,AA==')));
vi.mock('../utils/modelThumbnail', () => ({ geometryThumbnail: thumbnail }));
vi.mock('../components/LazyProductPreview', () => ({
  LazyProductPreview: (props: ComponentProps<typeof ProductPreview>) => (
    <div data-preview={props.meshUrl ?? ''} data-plates={props.meshPlates?.join(',')} data-caption={props.caption} />
  ),
}));

/** jsdom's File has no arrayBuffer(); Node's implements the standard like browsers do. */
const file = (parts: (string | Uint8Array)[], name: string) => new NodeFile(parts, name, { lastModified: 1_700_000_000_000 }) as unknown as File;
const STL = readFileSync(`${import.meta.dirname}/../../fixtures/models/twisted-star-vase.stl`);

const SETTINGS: PrintSettings = {
  nozzles: [
    { id: 'nozzle-0-4', diameterMm: 0.4, priceMultiplier: 1 },
    { id: 'nozzle-0-6', diameterMm: 0.6, priceMultiplier: 0.9 },
  ],
  defaultNozzleId: 'nozzle-0-4',
  layerHeights: [
    { id: 'layer-0-12', heightMm: 0.12, priceMultiplier: 1.5 },
    { id: 'layer-0-2', heightMm: 0.2, priceMultiplier: 1 },
    { id: 'layer-0-28', heightMm: 0.28, priceMultiplier: 0.8 },
    { id: 'layer-0-4', heightMm: 0.4, priceMultiplier: 0.7 },
  ],
  defaultLayerHeightId: 'layer-0-2',
  filaments: [
    {
      id: 'pla', name: 'PLA', description: 'Everyday material.', pricePerKg: 80, densityGPerCm3: 1.24,
      colors: [{ id: 'black', name: 'Black', hex: '#1c1c1e' }, { id: 'white', name: 'White', hex: '#f4f4f2' }, { id: 'red', name: 'Red', hex: '#c62828' }],
    },
    {
      id: 'petg', name: 'PETG', description: 'Tough and heat resistant.', pricePerKg: 100, densityGPerCm3: 1.27,
      colors: [{ id: 'black', name: 'Black', hex: '#1c1c1e' }, { id: 'clear', name: 'Translucent', hex: '#d9e7ef' }],
    },
  ],
  updatedAt: '2026-11-01T00:00:00.000Z',
};

let container: HTMLDivElement;
let root: Root;
let uploads: number;
/** Replies to GET /api/print-settings in turn; the last one repeats. */
let settingsReplies: (() => Response)[];
let created: CustomOrderInput[];
/** Replies to POST /api/custom-orders in turn; the last one repeats. */
let createReplies: (() => Response)[];

const placed = (input: CustomOrderInput): CustomOrder => ({
  id: 'request-1', number: 'CP-261101-ABCD', status: 'submitted', customer: input.customer, quotedPrice: null, currency: 'USD',
  files: input.files.map(({ fileId, quantity }) => ({ fileId, quantity, fileName: 'vase.stl', format: 'stl', sizeBytes: STL.length })),
  createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z',
});

const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
  if (url === '/api/products') return Response.json([]);
  if (url === '/api/print-settings') return (settingsReplies.length > 1 ? settingsReplies.shift()! : settingsReplies[0])();
  if (url === '/api/custom-orders/files') {
    uploads++;
    const name = decodeURIComponent((init.headers as Record<string, string>)['X-File-Name']);
    return Response.json({ fileId: `${uploads}`.padStart(24, 'a'), uploadKey: `key-${uploads}-${'x'.repeat(30)}`, fileName: name, format: 'stl', sizeBytes: 1 }, { status: 201 });
  }
  if (url === '/api/custom-orders') {
    created.push(JSON.parse(init.body as string) as CustomOrderInput);
    return (createReplies.length > 1 ? createReplies.shift()! : createReplies[0])();
  }
  return Response.json({ error: 'Not found' }, { status: 404 });
});

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  uploads = 0;
  created = [];
  settingsReplies = [() => Response.json(SETTINGS)];
  createReplies = [() => Response.json(placed(created.at(-1)!), { status: 201 })];
  history.replaceState(null, '', '/print-your-model');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === text) ?? null;

async function until(check: () => boolean, what: string) {
  for (let i = 0; i < 400 && !check(); i++) await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  if (!check()) throw new Error(`Timed out waiting for ${what}:\n${container.textContent}`);
}

async function pick(...files: File[]) {
  const input = $<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}

function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

async function fillContact() {
  const fields: Record<string, string> = {
    name: 'Anna Nowak', email: 'anna@example.com', 'address-line1': 'Długa 1', 'address-level2': 'Kraków',
    'postal-code': '30-001', 'country-name': 'Poland',
  };
  await act(async () => {
    for (const [autoComplete, value] of Object.entries(fields)) type($<HTMLInputElement>(`input[autocomplete="${autoComplete}"]`)!, value);
  });
}

async function submit() {
  await act(async () => $<HTMLFormElement>('form.checkout')!.requestSubmit());
}

/** Adds one good model with 3 copies and a note, then goes to the summary. */
async function prepareRequest() {
  await act(async () => root.render(<App />));
  await pick(file([STL], 'vase.stl'));
  await until(() => !!button('Continue to summary') && !button('Continue to summary')!.disabled, 'the model to be read');
  await act(async () => {
    type($<HTMLInputElement>('input[aria-label="Copies of vase.stl"]')!, '3');
    type($<HTMLTextAreaElement>('textarea')!, 'Black PETG, please');
  });
  await act(async () => button('Continue to summary')!.click());
}

describe('print your own model', () => {
  it('is a tab of the shop navigation', async () => {
    history.replaceState(null, '', '/');
    await act(async () => root.render(<App />));
    const link = [...container.querySelectorAll('.header__nav a')].find((a) => a.textContent === 'Print your model');
    expect(link?.getAttribute('href')).toBe('/print-your-model');
  });

  it('accepts only readable STL/3MF files in the first step and measures them', async () => {
    await act(async () => root.render(<App />));
    expect($('.steps [aria-current="step"]')?.textContent).toContain('Upload files');
    expect(button('Continue to summary')?.disabled).toBe(true);
    await pick(file(['hello'], 'notes.txt'), file([STL], 'vase.stl'), file(['solid broken'], 'broken.stl'), file([], 'empty.3mf'));
    await until(() => container.textContent!.includes('broken.stl: '), 'the broken file to be rejected');
    const problems = [...container.querySelectorAll('[role="alert"] li')].map((li) => li.textContent);
    expect(problems).toEqual([
      'notes.txt: only STL and 3MF files can be printed.',
      'empty.3mf: the file is empty.',
      expect.stringMatching(/^broken\.stl: /),
    ]);
    const rows = container.querySelectorAll('.model-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('vase.stl');
    expect(rows[0].textContent).toMatch(/STL · \d+(\.\d)? KB/);
    expect(rows[0].textContent).toMatch(/\d+(\.\d)? × \d+(\.\d)? × \d+(\.\d)? mm · \d+(\.\d)? cm³/);
    expect(rows[0].querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AA==');

    // The same file again is reported, not added twice.
    await pick(file([STL], 'vase.stl'));
    expect(container.querySelectorAll('.model-row')).toHaveLength(1);
    expect(container.textContent).toContain('vase.stl: this file is already added.');
    await act(async () => $<HTMLButtonElement>('button[aria-label="Remove vase.stl"]')!.click());
    expect(container.querySelectorAll('.model-row')).toHaveLength(0);
    expect(button('Continue to summary')?.disabled).toBe(true);
  });

  it('shows a summary and persists the confirmed request with files, copies, note and contact details', async () => {
    await prepareRequest();
    expect($('.steps [aria-current="step"]')?.textContent).toContain('Summary and confirmation');
    expect(document.activeElement?.textContent).toBe('2. Summary');
    const summary = $('.custom-print__summary')!.textContent;
    expect(summary).toContain('Prints in total3');
    expect(summary).toContain('Black PETG, please');
    expect(summary).toMatch(/Estimated price≈ \$[\d.]+/);
    // Customers see prices only: no weights or rates.
    expect(container.textContent).not.toMatch(/\d g\b|\/g|\/kg|per (gram|kilogram)/);
    expect(summary).toContain('The shop confirms the final price after reviewing your files.');
    expect($('.model-row__copies')?.textContent).toBe('3 copies');
    expect(uploads).toBe(0); // nothing is sent before confirming

    await fillContact();
    await submit();
    await until(() => container.textContent!.includes('CP-261101-ABCD'), 'the confirmation');

    const upload = fetchMock.mock.calls.find(([url]) => url === '/api/custom-orders/files')!;
    expect(upload[1]).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'vase.stl' } });
    expect(created).toEqual([{
      customer: {
        name: 'Anna Nowak', email: 'anna@example.com',
        address: { line1: 'Długa 1', city: 'Kraków', postalCode: '30-001', country: 'Poland' },
      },
      files: [{
        fileId: 'aaaaaaaaaaaaaaaaaaaaaaa1', uploadKey: `key-1-${'x'.repeat(30)}`, quantity: 3,
        nozzleId: 'nozzle-0-4', layerHeightId: 'layer-0-2', parts: [{ key: 'model', name: 'Model', filamentId: 'pla', colorId: 'black' }],
      }],
      customerNote: 'Black PETG, please',
    }]);
    expect(container.textContent).toContain('Thank you — we received your print request!');
    expect(container.textContent).toContain('anna@example.com');
    expect(container.textContent).toContain('1 file · 3 prints in total');

    // A new request starts empty.
    await act(async () => button('Send another model')!.click());
    expect(container.querySelectorAll('.model-row')).toHaveLength(0);
    expect($<HTMLTextAreaElement>('textarea')!.value).toBe('');
  });

  it('opens a 3D preview of an added model from its miniature or description, in both steps', async () => {
    const createObjectURL = vi.fn(() => 'blob:shop/model-1');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    await act(async () => root.render(<App />));
    await pick(file([STL], 'vase.stl'));
    const open = () => $<HTMLButtonElement>('.model-row__open')!;
    await until(() => !!open() && !open().disabled, 'the model to be read');
    expect(open().getAttribute('aria-label')).toBe('Preview vase.stl in 3D');
    expect(open().contains($('.model-row__thumb img'))).toBe(true);
    expect(open().contains($('.model-row__name'))).toBe(true);
    expect(open().contains($('.model-row__controls'))).toBe(false);

    open().focus();
    await act(async () => open().click());
    const dialog = $('[role="dialog"]')!;
    expect(dialog.querySelector('h2')?.textContent).toBe('vase.stl');
    expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ name: 'vase.stl' }));
    const preview = dialog.querySelector('[data-preview]')!;
    expect(preview.getAttribute('data-preview')).toBe('blob:shop/model-1');
    expect(preview.getAttribute('data-caption')).toMatch(/^\d+(\.\d)? × \d+(\.\d)? × \d+(\.\d)? mm$/);
    expect(dialog.textContent).toContain('FormatSTL');
    expect(dialog.textContent).toContain('Copies1');
    expect(dialog.textContent).toContain('the file is sent when you confirm the order');
    expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/custom-orders'))).toBe(false);
    expect(document.activeElement?.textContent).toBe('Close');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect($('[role="dialog"]')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:shop/model-1');
    expect(document.activeElement).toBe(open());

    // The summary's models open the same preview; clicking outside closes it.
    await act(async () => button('Continue to summary')!.click());
    await act(async () => open().click());
    expect($('[role="dialog"] [data-preview]')).not.toBeNull();
    await act(async () => $('.model-dialog__backdrop')!.click());
    expect($('[role="dialog"]')).toBeNull();
  });

  it('lets the customer choose nozzle, layer height, filament type and color per model, seeing only prices', async () => {
    await act(async () => root.render(<App />));
    await pick(file([STL], 'vase.stl'));
    await until(() => !!$('.model-row__options'), 'the print options');
    const estimate = () => $('.model-row__estimate')!.textContent!;
    const each = () => Number(/≈ \$([\d.]+) each/.exec(estimate())![1]);
    expect(estimate()).toMatch(/^Estimated price ≈ \$[\d.]+ each$/);
    const nozzle = $<HTMLSelectElement>('select[aria-label="Nozzle diameter for vase.stl"]')!;
    const layer = () => $<HTMLSelectElement>('select[aria-label="Layer height for vase.stl"]')!;
    const labels = (select: HTMLSelectElement) => [...select.options].map((o) => o.textContent);
    expect([nozzle.value, layer().value]).toEqual(['nozzle-0-4', 'layer-0-2']);
    expect(labels(nozzle)).toEqual(['0.4 mm', '0.6 mm']);
    // A 0.4 mm nozzle prints 0.1–0.32 mm layers, so 0.40 mm isn't offered.
    expect(labels(layer())).toEqual(['0.12 mm', '0.20 mm', '0.28 mm']);
    expect($('.print-options__hint')?.textContent).toBe(
      'A 0.4 mm nozzle prints layers from 0.10 mm to 0.32 mm. Thinner layers and smaller nozzles give finer detail but take longer.',
    );
    const filament = $<HTMLSelectElement>('select[aria-label="Filament type for vase.stl"]')!;
    expect(labels(filament)).toEqual(['PLA', 'PETG']);
    expect($('.filament-picker legend')?.textContent).toBe('Filament: PLA, Black');
    const standardPla = each();

    const choose = (select: HTMLSelectElement, value: string) => act(async () => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await choose(layer(), 'layer-0-12');
    expect(each()).toBeCloseTo(standardPla * 1.5, 1);
    // A 0.6 mm nozzle prints 0.15–0.48 mm layers: 0.12 mm is replaced by the closest it can print.
    await choose(nozzle, 'nozzle-0-6');
    expect(labels(layer())).toEqual(['0.20 mm', '0.28 mm', '0.40 mm']);
    expect(layer().value).toBe('layer-0-2');
    expect(each()).toBeCloseTo(standardPla * 0.9, 1);
    await choose(layer(), 'layer-0-4');
    expect(each()).toBeCloseTo(standardPla * 0.9 * 0.7, 1);
    // PETG is offered in black too, so the color stays.
    await choose(filament, 'petg');
    expect($('.filament-picker legend')?.textContent).toBe('Filament: PETG, Black');
    expect(each()).toBeGreaterThan(standardPla * 0.9 * 0.7);
    expect([...container.querySelectorAll<HTMLInputElement>('[aria-label="Color for vase.stl"] input')].map((i) => i.getAttribute('aria-label')))
      .toEqual(['Black', 'Translucent']);
    await act(async () => $<HTMLInputElement>('[aria-label="Color for vase.stl"] input[aria-label="Translucent"]')!.click());
    expect($('.filament-picker legend')?.textContent).toBe('Filament: PETG, Translucent');
    // The miniature is redrawn in the chosen filament color once the customer settles on it.
    await until(() => $('.model-row__thumb img')?.getAttribute('src') === 'data:image/png;color=#d9e7ef', 'the redrawn miniature');
    expect(thumbnail).toHaveBeenLastCalledWith(expect.anything(), '#d9e7ef', { model: '#d9e7ef' });
    await act(async () => type($<HTMLInputElement>('input[aria-label="Copies of vase.stl"]')!, '2'));
    expect(estimate()).toContain(`≈ $${(each() * 2).toFixed(2)} for 2 copies`);
    expect($('.custom-print__actions')?.textContent).toContain(`Estimated price ≈ $${(each() * 2).toFixed(2)}`);

    // The summary lists the choices and the estimated total; the preview shows the chosen color.
    await act(async () => button('Continue to summary')!.click());
    expect($('.print-choices')?.textContent).toBe('Nozzle 0.6 mm · layers 0.40 mmPETG, Translucent');
    expect($('.model-row__thumb img')?.getAttribute('src')).toBe('data:image/png;color=#d9e7ef');
    expect($('.custom-print__summary')?.textContent).toContain(`Estimated price≈ $${(each() * 2).toFixed(2)}`);
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:shop/1'), revokeObjectURL: vi.fn() }));
    await act(async () => $<HTMLButtonElement>('.model-row__open')!.click());
    expect($('[role="dialog"]')?.textContent).toContain('Print optionsNozzle 0.6 mm · layers 0.40 mmPETG, Translucent');
    expect($('[role="dialog"]')?.textContent).toContain(`Estimated price≈ $${each().toFixed(2)} each`);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));

    await fillContact();
    await submit();
    await until(() => container.textContent!.includes('CP-261101-ABCD'), 'the confirmation');
    expect(created[0].files[0]).toMatchObject({
      quantity: 2, nozzleId: 'nozzle-0-6', layerHeightId: 'layer-0-4',
      parts: [{ key: 'model', name: 'Model', filamentId: 'petg', colorId: 'clear' }],
    });
  });

  it('offers to retry when the print options cannot be loaded', async () => {
    settingsReplies = [() => Response.json({ error: 'Print options are not set up yet.' }, { status: 404 }), () => Response.json(SETTINGS)];
    await act(async () => root.render(<App />));
    await pick(file([STL], 'vase.stl'));
    await until(() => !!$('.model-row__open:not(:disabled)'), 'the model to be read');
    expect($('[role="alert"]')?.textContent).toContain('The print options could not be loaded. Print options are not set up yet.');
    expect(button('Continue to summary')?.disabled).toBe(true);
    expect($('.model-row__options')).toBeNull();
    await act(async () => button('Try again')!.click());
    await until(() => !!$('.model-row__options'), 'the print options');
    expect(button('Continue to summary')?.disabled).toBe(false);
  });

  it('reloads the print options when the shop rejects a choice it no longer offers', async () => {
    const withoutPetg = { ...SETTINGS, filaments: SETTINGS.filaments.slice(0, 1) };
    settingsReplies = [() => Response.json(SETTINGS), () => Response.json(withoutPetg)];
    createReplies = [
      () => Response.json({ error: 'Some print options need attention.', details: ['File 1: Model: the chosen filament is no longer offered. Please choose again.'] }, { status: 400 }),
      () => Response.json(placed(created.at(-1)!), { status: 201 }),
    ];
    await prepareRequest();
    await act(async () => button('Change files')!.click());
    const filament = $<HTMLSelectElement>('select[aria-label="Filament type for vase.stl"]')!;
    await act(async () => {
      filament.value = 'petg';
      filament.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => button('Continue to summary')!.click());
    await fillContact();
    await submit();
    await until(() => !!$('.banner--error'), 'the error');
    expect($('.banner--error')?.textContent).toContain('the chosen filament is no longer offered');
    // The current offer replaces the withdrawn filament with the default, so confirming again works.
    await until(() => $('.print-choices')?.textContent === 'Nozzle 0.4 mm · layers 0.20 mmPLA, Black', 'the new offer');
    await submit();
    await until(() => container.textContent!.includes('CP-261101-ABCD'), 'the confirmation');
    expect(created.map((input) => input.files[0].parts[0].filamentId)).toEqual(['petg', 'pla']);
  });

  it('keeps the chosen files while the customer visits other pages', async () => {
    await prepareRequest();
    const shop = [...container.querySelectorAll<HTMLAnchorElement>('.header__nav a')].find((a) => a.textContent === 'Shop')!;
    await act(async () => shop.click());
    const back = [...container.querySelectorAll<HTMLAnchorElement>('.header__nav a')].find((a) => a.textContent === 'Print your model')!;
    await act(async () => back.click());
    expect($('.model-row')?.textContent).toContain('vase.stl');
    expect($<HTMLInputElement>('input[aria-label="Copies of vase.stl"]')?.value).toBe('3');
  });

  it('reports a failed confirmation and retries without uploading accepted files again', async () => {
    createReplies = [
      () => Response.json({ error: 'Invalid request.', details: ['customer.email: Enter a valid email address.'] }, { status: 400 }),
      () => Response.json(placed(created.at(-1)!), { status: 201 }),
    ];
    await prepareRequest();
    await fillContact();
    await submit();
    await until(() => !!$('.banner--error'), 'the error');
    expect($('.banner--error')?.textContent).toContain('customer.email: Enter a valid email address.');
    expect(button('Confirm order')?.disabled).toBe(false);
    await submit();
    await until(() => container.textContent!.includes('CP-261101-ABCD'), 'the confirmation');
    expect(uploads).toBe(1);
    expect(created).toHaveLength(2);
  });

  it('uploads the files again when the shop no longer has the earlier uploads', async () => {
    createReplies = [
      () => Response.json({ error: 'Some files of your print request need attention.', details: ['File 1: expired'] }, { status: 409 }),
      () => Response.json(placed(created.at(-1)!), { status: 201 }),
    ];
    await prepareRequest();
    await fillContact();
    await submit();
    await until(() => container.textContent!.includes('CP-261101-ABCD'), 'the confirmation');
    expect(uploads).toBe(2);
    expect(created.map((input) => input.files[0].fileId)).toEqual(['aaaaaaaaaaaaaaaaaaaaaaa1', 'aaaaaaaaaaaaaaaaaaaaaaa2']);
  });
});
