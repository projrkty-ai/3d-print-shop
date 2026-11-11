// @vitest-environment jsdom
import { File as NodeFile } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { ProductPreview } from '../components/ProductPreview';
import type { SliceSettings } from '../slicer/protocol';
import type { CustomOrderInput, Order, PrintSettings } from '../types';

/** What the storefront sends to place the order: the models of one source, with estimates per color part. */
type Placed = Omit<CustomOrderInput, 'files'> & {
  source: 'upload';
  items: (Omit<CustomOrderInput['files'][number], 'estimate'> & { estimate?: { printMinutes: number; filaments: { key: string; grams: number }[] } })[];
};

/** Read-time thumbnails are a fixed image; ones redrawn in chosen colors name their color. */
const thumbnail = vi.hoisted(() => vi.fn((_geometry: unknown, color: string, partColors?: Record<string, string>) =>
  (partColors ? `data:image/png;color=${color}` : 'data:image/png;base64,AA==')));
vi.mock('../utils/modelThumbnail', () => ({ geometryThumbnail: thumbnail }));
/**
 * The browser slicer, without a Web Worker: one copy takes 60 min and 20 g at the model's size,
 * time growing with the scale², filament with the scale³ (and +10% with supports).
 */
const slices = vi.hoisted(() => [] as SliceSettings[]);
/** When set, slicing waits here after reporting half its progress. */
const gate = vi.hoisted(() => ({ wait: null as Promise<void> | null }));
vi.mock('../slicer/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../slicer/client')>();
  return {
    ...actual,
    createSlicerClient: () => ({
      inspect: vi.fn(),
      slice: vi.fn(async (_bytes: ArrayBuffer, _name: string, settings: SliceSettings, onProgress: (stage: string, fraction: number) => void) => {
        slices.push(settings);
        onProgress('perimeters', 0.5);
        if (gate.wait) await gate.wait;
        const scale = settings.scale ?? 1;
        const grams = 20 * scale ** 3 * (settings.support === 'on' ? 1.1 : 1);
        return { result: { time_s: 3600 * scale ** 2, weight_g: grams, per_extruder: [{ extruder: 1, weight_g: grams, length_m: 1 }] } };
      }),
      cancel: vi.fn(),
      dispose: vi.fn(),
    }),
  };
});
vi.mock('../components/LazyProductPreview', () => ({
  LazyProductPreview: (props: ComponentProps<typeof ProductPreview>) => (
    <div data-preview={props.meshUrl ?? ''} data-plates={props.meshPlates?.join(',')} data-caption={props.caption} />
  ),
}));

/** jsdom's File has no arrayBuffer(); Node's implements the standard like browsers do. */
const file = (parts: (string | Uint8Array)[], name: string) => new NodeFile(parts, name, { lastModified: 1_700_000_000_000 }) as unknown as File;
const STL = readFileSync(`${import.meta.dirname}/../../fixtures/models/twisted-star-vase.stl`);

const U1_04 = 'Snapmaker U1 (0.4 nozzle)';
const U1_06 = 'Snapmaker U1 (0.6 nozzle)';
const SETTINGS: PrintSettings = {
  profiles: {
    printers: [U1_04, U1_06],
    processes: ['0.20 Standard @Snapmaker U1 (0.4 nozzle)', '0.20 Standard @Snapmaker U1 (0.6 nozzle)', '0.30 Standard @Snapmaker U1 (0.6 nozzle)'],
    filaments: ['Generic PLA @U1 0.4 nozzle', 'Generic PLA @U1 0.6 nozzle', 'Generic PLA @System'],
  },
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
let created: Placed[];
/** Replies to POST /api/orders in turn; the last one repeats. */
let createReplies: (() => Response)[];

const placed = (input: Placed): Order => ({
  id: 'request-1', number: 'CP-261101-ABCD', status: 'received', source: 'upload', customer: input.customer, customerNote: input.customerNote ?? '', currency: 'USD',
  items: input.items.map(({ quantity }) => ({ model: { source: 'upload' }, quantity, unitPrice: null, lineTotal: null })),
  price: { mode: 'quote', handlingFee: 5, estimated: null, reviewed: null, total: null },
  createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z',
});

const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
  if (url === '/api/products') return Response.json([]);
  if (url === '/api/print-settings') return (settingsReplies.length > 1 ? settingsReplies.shift()! : settingsReplies[0])();
  if (url === '/api/uploads') {
    uploads++;
    const name = decodeURIComponent((init.headers as Record<string, string>)['X-File-Name']);
    return Response.json({ fileId: `${uploads}`.padStart(24, 'a'), uploadKey: `key-${uploads}-${'x'.repeat(30)}`, fileName: name, format: 'stl', sizeBytes: 1 }, { status: 201 });
  }
  if (url === '/api/uploads/estimate') {
    // $2 an hour plus each part's filament price per kilogram; $5 handling
    const { items: files } = JSON.parse(init.body as string) as { items: { parts: { key: string; filamentId: string }[]; estimate: Placed['items'][number]['estimate'] & object }[] };
    const unitPrice = (file: (typeof files)[number]) => Math.round((file.estimate.printMinutes / 60 * 2 + file.estimate.filaments.reduce((sum, part) => {
      const filament = SETTINGS.filaments.find((f) => f.id === file.parts.find((p) => p.key === part.key)!.filamentId)!;
      return sum + part.grams / 1000 * filament.pricePerKg;
    }, 0)) * 100) / 100;
    return Response.json({ items: files.map((file) => ({ unitPrice: unitPrice(file) })), handlingFee: 5, total: 0, currency: 'USD' });
  }
  if (url === '/api/orders') {
    created.push(JSON.parse(init.body as string) as Placed);
    return (createReplies.length > 1 ? createReplies.shift()! : createReplies[0])();
  }
  return Response.json({ error: 'Not found' }, { status: 404 });
});

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  slices.length = 0;
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
  await until(() => !!$('.custom-print__total-price'), 'the price estimate');
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
    // One price, at the bottom: 3 × (60 min × $2/h + 20 g × $80/kg) + $5 handling
    expect(container.querySelectorAll('.custom-print__total')).toHaveLength(1);
    expect($('.custom-print__total')!.textContent).toBe(
      'Estimated price≈ $15.803 prints in total · Handling fee included. The shop slices your models again and confirms the final price.');
    expect($('form.checkout')!.contains($('.custom-print__total'))).toBe(true);
    expect(container.querySelectorAll('.model-row__estimate')).toHaveLength(0);
    // Customers see prices only: no print times, weights or rates.
    expect(container.textContent).not.toMatch(/\d g\b|\/g|\/kg|per (gram|kilogram)|\d min\b/);
    expect($('.model-row__copies')?.textContent).toBe('3 copies');
    expect(uploads).toBe(0); // nothing is sent before confirming

    await fillContact();
    await submit();
    await until(() => container.textContent!.includes('CP-261101-ABCD'), 'the confirmation');

    const upload = fetchMock.mock.calls.find(([url]) => url === '/api/uploads')!;
    expect(upload[1]).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'vase.stl' } });
    expect(created).toEqual([{
      source: 'upload',
      customer: {
        name: 'Anna Nowak', email: 'anna@example.com',
        address: { line1: 'Długa 1', city: 'Kraków', postalCode: '30-001', country: 'Poland' },
      },
      items: [{
        fileId: 'aaaaaaaaaaaaaaaaaaaaaaa1', uploadKey: `key-1-${'x'.repeat(30)}`, quantity: 3,
        profile: { printer: U1_04, process: '0.20 Standard @Snapmaker U1 (0.4 nozzle)', filament: 'Generic PLA @U1 0.4 nozzle', support: false, scale: 1 },
        estimate: { printMinutes: 60, filaments: [{ key: 'model', grams: 20 }] },
        parts: [{ key: 'model', name: 'Model', filamentId: 'pla', colorId: 'black' }],
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
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/orders' || url === '/api/uploads')).toBe(false);
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

  it('lets the customer choose one slicing profile, scale, filament type and color per model, seeing only prices', async () => {
    await act(async () => root.render(<App />));
    await pick(file([STL], 'vase.stl'));
    await until(() => !!$('.model-row__options'), 'the print options');
    // The only price shown is the request's total, at the bottom ($5 handling included).
    const total = () => Number(/≈ \$([\d.]+)/.exec($('.custom-print__total-price')?.textContent ?? '')?.[1] ?? NaN);
    const each = () => Math.round((total() - 5) * 100) / 100;
    await until(() => !!$('.custom-print__total-price'), 'the first estimate');
    expect(container.querySelectorAll('.custom-print__total')).toHaveLength(1);
    expect($('.model-row__estimate')).toBeNull();
    // 60 min × $2/h + 20 g × $80/kg
    expect(each()).toBe(3.6);
    expect(slices).toEqual([expect.objectContaining({
      useProjectSettings: false, printer: U1_04, process: '0.20 Standard @Snapmaker U1 (0.4 nozzle)', filament: 'Generic PLA @U1 0.4 nozzle',
      support: 'off', scale: 1, plate: 1, calibration: true,
    })]);
    const select = (label: string) => $<HTMLSelectElement>(`select[aria-label="${label} for vase.stl"]`)!;
    const labels = (element: HTMLSelectElement) => [...element.options].map((o) => o.textContent);
    expect(labels(select('Printer'))).toEqual([U1_04, U1_06]);
    expect(labels(select('Print profile'))).toEqual(['0.20 Standard @Snapmaker U1 (0.4 nozzle)']);
    expect(labels(select('Filament profile'))).toEqual(['Generic PLA @U1 0.4 nozzle', 'Generic PLA @System']);
    expect($('.print-options__hint')?.textContent).toMatch(/^0\.4 mm nozzle, 0\.20 mm layers\. Printed size: /);

    const choose = (element: HTMLSelectElement, value: string) => act(async () => {
      element.value = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // Another printer takes its default process and filament; the model is sliced again.
    await choose(select('Printer'), U1_06);
    expect(labels(select('Print profile'))).toEqual(['0.20 Standard @Snapmaker U1 (0.6 nozzle)', '0.30 Standard @Snapmaker U1 (0.6 nozzle)']);
    await choose(select('Print profile'), '0.20 Standard @Snapmaker U1 (0.6 nozzle)');
    await act(async () => $<HTMLInputElement>('input[aria-label="Supports for vase.stl"]')!.click());
    await act(async () => type($<HTMLInputElement>('input[aria-label="Scale of vase.stl in percent"]')!, '50'));
    await until(() => slices.at(-1)?.scale === 0.5 && !!$('.custom-print__total-price') && each() !== 3.6, 'the estimate at 50%');
    expect(slices.at(-1)).toMatchObject({ printer: U1_06, process: '0.20 Standard @Snapmaker U1 (0.6 nozzle)', support: 'on', scale: 0.5 });
    // 15 min ($0.50) + 2.75 g at $80/kg ($0.22)
    expect(each()).toBe(0.72);
    // Another filament type changes the price, not the slicing.
    const slicedTimes = slices.length;
    const filament = $<HTMLSelectElement>('select[aria-label="Filament type for vase.stl"]')!;
    expect(labels(filament)).toEqual(['PLA', 'PETG']);
    await choose(filament, 'petg');
    await until(() => each() === 0.77, 'the PETG price');
    expect(slices).toHaveLength(slicedTimes);
    expect($('.filament-picker legend')?.textContent).toBe('Filament: PETG, Black');
    await act(async () => $<HTMLInputElement>('[aria-label="Color for vase.stl"] input[aria-label="Translucent"]')!.click());
    expect($('.filament-picker legend')?.textContent).toBe('Filament: PETG, Translucent');
    await until(() => $('.model-row__thumb img')?.getAttribute('src') === 'data:image/png;color=#d9e7ef', 'the redrawn miniature');
    await act(async () => type($<HTMLInputElement>('input[aria-label="Copies of vase.stl"]')!, '2'));
    // 2 × $0.77 with the handling fee
    expect(total()).toBe(6.54);

    // The summary lists the choices and the estimated total; the preview shows the chosen color.
    await act(async () => button('Continue to summary')!.click());
    expect($('.print-choices')?.textContent).toBe(`${U1_06} · 0.20 Standard @Snapmaker U1 (0.6 nozzle) · Generic PLA @U1 0.6 nozzleScale 50% · with supportsPETG, Translucent`);
    expect($('.custom-print__total')?.textContent).toContain('Estimated price≈ $6.54');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:shop/1'), revokeObjectURL: vi.fn() }));
    await act(async () => $<HTMLButtonElement>('.model-row__open')!.click());
    expect($('[role="dialog"]')?.textContent).not.toContain('$');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));

    await fillContact();
    await submit();
    await until(() => container.textContent!.includes('CP-261101-ABCD'), 'the confirmation');
    expect(created[0].items[0]).toMatchObject({
      quantity: 2,
      profile: { printer: U1_06, process: '0.20 Standard @Snapmaker U1 (0.6 nozzle)', filament: 'Generic PLA @U1 0.6 nozzle', support: true, scale: 0.5 },
      estimate: { printMinutes: 15, filaments: [{ key: 'model', grams: 2.75 }] },
      parts: [{ key: 'model', name: 'Model', filamentId: 'petg', colorId: 'clear' }],
    });
  }, 20_000);

  it('shows a progress bar while the models are sliced, then the one estimated price', async () => {
    let release = () => {};
    gate.wait = new Promise((resolve) => { release = resolve; });
    try {
      await act(async () => root.render(<App />));
      await pick(file([STL], 'vase.stl'));
      await until(() => !!$('.model-row__estimate--pending progress') && $('.model-row__estimate--pending')!.textContent!.includes('50%'), 'the slicing progress');
      expect($<HTMLProgressElement>('.model-row__estimate--pending progress')!.value).toBe(0.5);
      const totalBar = $<HTMLProgressElement>('.custom-print__total progress')!;
      expect(totalBar.value).toBeCloseTo(0.475, 3);
      expect($('.custom-print__total')!.textContent).toBe('Estimating the price… 48%');
      expect($('.custom-print__total-price')).toBeNull();
      release();
      await until(() => !!$('.custom-print__total-price'), 'the estimate');
      expect($('.model-row__estimate')).toBeNull();
      expect($('.custom-print__total-price')!.textContent).toBe('≈ $8.60');
    } finally {
      gate.wait = null;
    }
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
    await until(() => !!$('.print-choices')?.textContent?.endsWith('Scale 100%PLA, Black'), 'the new offer');
    await submit();
    await until(() => container.textContent!.includes('CP-261101-ABCD'), 'the confirmation');
    expect(created.map((input) => input.items[0].parts[0].filamentId)).toEqual(['petg', 'pla']);
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
    expect(created.map((input) => input.items[0].fileId)).toEqual(['aaaaaaaaaaaaaaaaaaaaaaa1', 'aaaaaaaaaaaaaaaaaaaaaaa2']);
  });
});
