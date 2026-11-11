// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../api/client';
import type { Printer, PrinterModelWithPrinters } from '../../types';
import { AdminPrintersPage } from './AdminPrintersPage';

const auth = vi.hoisted(() => ({ signOut: () => undefined }));
vi.mock('../../store/AdminAuthContext', () => ({ useAdminAuth: () => auth }));

const U1: PrinterModelWithPrinters = {
  id: 'u1', name: 'Snapmaker U1', manufacturer: 'Snapmaker', plate: { widthMm: 270, depthMm: 270, heightMm: 270 }, maxColors: 4,
  createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', printers: [{ id: 'p1', name: 'U1-01' }],
  profiles: {
    fileId: 'aaaaaaaaaaaaaaaaaaaaaaaa', fileName: 'Snapmaker U1.orca_printer', sizeBytes: 20480, uploadedAt: '2026-11-02T10:00:00.000Z',
    entries: [{ name: 'printer/Snapmaker U1 (0.4 nozzle).json', sizeBytes: 9000 }],
    presets: { machine: ['Snapmaker U1 (0.4 nozzle)'], process: ['0.20 Standard @Snapmaker U1 (0.4 nozzle)'], filament: [] },
  },
};
const A1: PrinterModelWithPrinters = {
  ...U1, id: 'a1', name: 'Bambu Lab A1 mini', manufacturer: 'Bambu Lab', plate: { widthMm: 180, depthMm: 180, heightMm: 180 }, printers: [{ id: 'p2', name: 'A1-01' }], profiles: null,
};
const modelOf = ({ printers: _printers, ...model }: PrinterModelWithPrinters) => model;
const U1_01: Printer = {
  id: 'p1', name: 'U1-01', modelId: 'u1', model: modelOf(U1), location: 'Room 2, rack B', notes: '',
  createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', queue: { length: 0, nextStart: '2026-11-10T10:00:00.000Z' },
};
const A1_01: Printer = {
  ...U1_01, id: 'p2', name: 'A1-01', modelId: 'a1', model: modelOf(A1), location: '', notes: 'Spare', queue: { length: 2, nextStart: '2026-11-10T15:00:00.000Z' },
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(api, 'listPrinters').mockResolvedValue([A1_01, U1_01]);
  vi.spyOn(api, 'listPrinterModels').mockResolvedValue([A1, U1]);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const $$ = <T extends Element = HTMLElement>(selector: string) => [...container.querySelectorAll<T>(selector)];
const button = (text: string) => $$<HTMLButtonElement>('button').find((b) => b.textContent === text)!;
const fieldLabels = () => $$('label.field').map((l) => l.querySelector('span')?.textContent);
const field = <T extends HTMLElement = HTMLInputElement>(label: string) =>
  $$('label.field').find((l) => l.querySelector('span')?.textContent === label)!.querySelector<T>('input, select, textarea')!;
const rows = () => $$('tbody tr');
const cells = (row: Element) => [...row.querySelectorAll('td')].map((cell) => cell.textContent);

const type = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => act(async () => {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype
    : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
});
const click = (element: HTMLElement) => act(async () => element.click());
const submit = () => act(async () => $('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

function Where() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}
const render = () => act(async () => root.render(
  <MemoryRouter initialEntries={['/admin/printers']}>
    <Routes><Route path="*" element={<><AdminPrintersPage /><Where /></>} /></Routes>
  </MemoryRouter>,
));

describe('printers warehouse: printers', () => {
  it('lists the printers with the plate, colors and profiles of their models', async () => {
    await render();
    expect($('h1')?.textContent).toBe('Printers');
    expect($$('.printers-nav a').map((a) => [a.textContent, a.className])).toEqual([['Printers', 'is-active'], ['Printer models', '']]);
    expect(container.textContent).toContain('2 printers');
    const [a1, u1] = rows();
    expect(cells(u1).slice(0, 6)).toEqual([
      'U1-01', 'Snapmaker U1', '270 × 270 × 270 mm', '4', 'Room 2, rack B', 'Snapmaker U1.orca_printer20 KB · presets: 1 printer, 1 process, 0 filament',
    ]);
    expect(u1.querySelectorAll('td')[1].querySelector('a')?.getAttribute('href')).toBe('/admin/printer-models/u1');
    expect(cells(a1).slice(0, 6)).toEqual(['A1-01Spare', 'Bambu Lab A1 mini', '180 × 180 × 180 mm', '4', 'Not set', 'None']);
    // Each printer's queue, linked like its name.
    expect(cells(u1)[6]).toBe('Empty');
    expect(cells(a1)[6]).toMatch(/^2 ordersnext start /);
    expect(a1.querySelectorAll('td')[6].querySelector('a')?.getAttribute('href')).toBe('/admin/printers/p2');
    expect(a1.querySelector('td a')?.getAttribute('href')).toBe('/admin/printers/p2');
  });

  it('adds a printer of a model, with only its name, model, location and notes editable', async () => {
    const create = vi.spyOn(api, 'createPrinter').mockImplementation(async (input) => ({ ...U1_01, ...input, id: 'p3', model: modelOf(U1) }));
    await render();
    await click(button('Add printer'));
    expect($('form')?.getAttribute('aria-label')).toBe('Add printer');
    expect(fieldLabels()).toEqual(['Unique name', 'Model', 'Location', 'Notes']);
    expect($$('input[type="number"], input[type="file"]')).toEqual([]);
    // Submitting an empty form lists the problems instead of calling the API.
    await submit();
    expect($('.printer-editor__problems')?.textContent).toBe('Enter a name for the printer (up to 80 characters).Choose the printer model.');
    expect(create).not.toHaveBeenCalled();

    await type(field('Unique name'), ' u1-01 ');
    expect($('.printer-editor__problems')?.textContent).toContain('A printer named "u1-01" already exists.');
    await type(field('Unique name'), 'U1-02');
    const picker = field<HTMLSelectElement>('Model');
    expect([...picker.options].map((option) => option.textContent)).toEqual([
      'Choose a model…', 'Bambu Lab A1 mini — 180 × 180 × 180 mm, 4 colors', 'Snapmaker U1 — 270 × 270 × 270 mm, 4 colors',
    ]);
    expect($('[data-testid="model-facts"]')).toBeNull();
    await type(picker, 'u1');
    expect($('[data-testid="model-facts"]')?.textContent).toContain('270 × 270 × 270 mm');
    expect($('[data-testid="model-facts"]')?.textContent).toContain('Snapmaker U1.orca_printer');
    expect($('[data-testid="model-facts"] a')?.getAttribute('href')).toBe('/admin/printer-models/u1');
    await type(field('Location'), ' Room 3 ');

    await submit();
    expect(create).toHaveBeenCalledWith({ name: 'U1-02', modelId: 'u1', location: 'Room 3', notes: '' });
    expect($('form')).toBeNull();
    expect($('.banner--success')?.textContent).toBe('Added printer "U1-02".');
    expect(rows().map((row) => row.querySelector('td')?.textContent)).toEqual(['A1-01Spare', 'U1-01', 'U1-02']);
  });

  it('moves a printer to another model and shows server problems in the form', async () => {
    const update = vi.spyOn(api, 'updatePrinter')
      .mockRejectedValueOnce(new ApiError(400, 'The printer has problems.', ['The chosen printer model does not exist any more. Choose another one.']))
      .mockResolvedValue({ ...U1_01, modelId: 'a1', model: modelOf(A1) });
    await render();
    await click(rows()[1].querySelector<HTMLButtonElement>('button.btn')!);
    expect($('h2')?.textContent).toBe('Edit printer: U1-01');
    expect(field<HTMLSelectElement>('Model').value).toBe('u1');
    await type(field<HTMLSelectElement>('Model'), 'a1');
    expect($('[data-testid="model-facts"]')?.textContent).toContain('180 × 180 × 180 mm');
    await submit();
    expect($('form .banner--error')?.textContent).toBe('The printer has problems.The chosen printer model does not exist any more. Choose another one.');
    await submit();
    expect(update).toHaveBeenLastCalledWith('p1', { name: 'U1-01', modelId: 'a1', location: 'Room 2, rack B', notes: '' });
    expect($('.banner--success')?.textContent).toBe('Saved printer "U1-01".');
    expect(cells(rows()[1]).slice(0, 3)).toEqual(['U1-01', 'Bambu Lab A1 mini', '180 × 180 × 180 mm']);
  });

  it('downloads the model profiles from the list and deletes printers after confirming', async () => {
    const download = vi.spyOn(api, 'downloadPrinterModelProfiles').mockResolvedValue(new Blob(['PK']));
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:profiles'), revokeObjectURL: vi.fn() }));
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    const del = vi.spyOn(api, 'deletePrinter').mockResolvedValue();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    await render();
    await click(button('Snapmaker U1.orca_printer'));
    expect(download).toHaveBeenCalledWith('u1');
    expect(clicked).toEqual(['Snapmaker U1.orca_printer']);

    await click(rows()[0].querySelector<HTMLButtonElement>('button.btn--danger')!);
    expect(confirm).toHaveBeenCalledWith('Delete printer "A1-01"? This cannot be undone.');
    expect(del).not.toHaveBeenCalled();
    await click(rows()[0].querySelector<HTMLButtonElement>('button.btn--danger')!);
    expect(del).toHaveBeenCalledWith('p2');
    expect(rows().map((row) => row.querySelector('td')?.textContent)).toEqual(['U1-01']);
    expect(container.textContent).toContain('1 printer');
  });

  it('asks for a printer model before printers can be added', async () => {
    vi.spyOn(api, 'listPrinters').mockResolvedValue([]);
    vi.spyOn(api, 'listPrinterModels').mockResolvedValue([]);
    await render();
    expect(button('Add printer').disabled).toBe(true);
    expect($('.banner--info')?.textContent).toContain('Printers need a model first');
    await click($<HTMLAnchorElement>('.banner--info a')!);
    expect($('[data-testid="path"]')?.textContent).toBe('/admin/printer-models/new');
  });
});
