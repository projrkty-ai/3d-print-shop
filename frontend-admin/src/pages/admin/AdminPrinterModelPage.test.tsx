// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../api/client';
import type { PrinterModelTemplate, PrinterModelWithPrinters } from '../../types';
import { AdminPrinterModelPage } from './AdminPrinterModelPage';
import { AdminPrinterModelsPage } from './AdminPrinterModelsPage';

const auth = vi.hoisted(() => ({ signOut: () => undefined }));
vi.mock('../../store/AdminAuthContext', () => ({ useAdminAuth: () => auth }));

const U1: PrinterModelWithPrinters = {
  id: 'u1', name: 'Snapmaker U1', manufacturer: 'Snapmaker', plate: { widthMm: 270, depthMm: 270, heightMm: 270 }, maxColors: 4,
  createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', printers: [{ id: 'p1', name: 'U1-01' }, { id: 'p2', name: 'U1-02' }],
  profiles: {
    fileId: 'aaaaaaaaaaaaaaaaaaaaaaaa', fileName: 'Snapmaker U1.orca_printer', sizeBytes: 20480, uploadedAt: '2026-11-02T10:00:00.000Z',
    entries: [{ name: 'printer/Snapmaker U1 (0.4 nozzle).json', sizeBytes: 9000 }, { name: 'process/0.20 Standard.json', sizeBytes: 4000 }],
    presets: { machine: ['Snapmaker U1 (0.4 nozzle)'], process: ['0.20 Standard @Snapmaker U1 (0.4 nozzle)'], filament: [] },
  },
};
const UNUSED: PrinterModelWithPrinters = { ...U1, id: 'x1', name: 'Prusa XL', manufacturer: '', maxColors: 5, printers: [], profiles: null };
const TEMPLATES: PrinterModelTemplate[] = [
  { name: 'Bambu Lab A1 mini', manufacturer: 'Bambu Lab', plate: { widthMm: 180, depthMm: 180, heightMm: 180 }, maxColors: 4 },
];

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(api, 'listPrinterModels').mockResolvedValue([UNUSED, U1]);
  vi.spyOn(api, 'listPrinterModelTemplates').mockResolvedValue(TEMPLATES);
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
const field = <T extends HTMLElement = HTMLInputElement>(label: string) =>
  $$('label.field').find((l) => l.querySelector('span')?.textContent === label)!.querySelector<T>('input, select, textarea')!;
const rows = () => $$('tbody tr');
const path = () => $('[data-testid="path"]')?.textContent;

const type = (element: HTMLInputElement | HTMLSelectElement, value: string) => act(async () => {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
});
const click = (element: HTMLElement) => act(async () => element.click());
const submit = () => act(async () => $('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
async function chooseFile(file: File) {
  const input = $<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}

function Where() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}
const render = (at: string) => act(async () => root.render(
  <MemoryRouter initialEntries={[at]}>
    <Routes>
      <Route path="/admin/printer-models" element={<><AdminPrinterModelsPage /><Where /></>} />
      <Route path="/admin/printer-models/new" element={<><AdminPrinterModelPage /><Where /></>} />
      <Route path="/admin/printer-models/:modelId" element={<><AdminPrinterModelPage /><Where /></>} />
      <Route path="*" element={<Where />} />
    </Routes>
  </MemoryRouter>,
));

describe('printer models list', () => {
  it('lists the models with their plate, colors, profiles and printers', async () => {
    await render('/admin/printer-models');
    expect($('h1')?.textContent).toBe('Printer models');
    expect($$('.printers-nav a').map((a) => [a.textContent, a.className])).toEqual([['Printers', ''], ['Printer models', 'is-active']]);
    const [xl, u1] = rows();
    expect([...u1.querySelectorAll('td')].slice(0, 5).map((cell) => cell.textContent)).toEqual([
      'Snapmaker U1Snapmaker', '270 × 270 × 270 mm', '4', 'Snapmaker U1.orca_printer20 KB · presets: 1 printer, 1 process, 0 filament', '2: U1-01, U1-02',
    ]);
    expect(u1.querySelector('a')?.getAttribute('href')).toBe('/admin/printer-models/u1');
    expect([...xl.querySelectorAll('td')].slice(3, 5).map((cell) => cell.textContent)).toEqual(['None', 'None']);
    // Only unused models can be deleted.
    expect(u1.querySelector<HTMLButtonElement>('button.btn--danger')?.disabled).toBe(true);
    expect(xl.querySelector<HTMLButtonElement>('button.btn--danger')?.disabled).toBe(false);
  });

  it('deletes an unused model after confirming and shows refusals from the server', async () => {
    const del = vi.spyOn(api, 'deletePrinterModel')
      .mockRejectedValueOnce(new ApiError(409, '"Prusa XL" is the model of XL-01. Delete these printers or give them another model first.'))
      .mockResolvedValue();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await render('/admin/printer-models');
    await click(rows()[0].querySelector<HTMLButtonElement>('button.btn--danger')!);
    expect($('.banner--error')?.textContent).toContain('is the model of XL-01');
    expect(rows()).toHaveLength(2);
    await click(rows()[0].querySelector<HTMLButtonElement>('button.btn--danger')!);
    expect(del).toHaveBeenCalledWith('x1');
    expect($('.banner--success')?.textContent).toBe('Deleted printer model "Prusa XL".');
    expect(rows().map((row) => row.querySelector('a')?.textContent)).toEqual(['Snapmaker U1']);
  });
});

describe('printer model page', () => {
  it('adds a model from a known printer, uploads its profiles and opens its edit page', async () => {
    const created: PrinterModelWithPrinters = { ...UNUSED, id: 'a1', ...TEMPLATES[0], name: 'A1 mini (AMS lite)' };
    const create = vi.spyOn(api, 'createPrinterModel').mockResolvedValue(created);
    const upload = vi.spyOn(api, 'uploadPrinterModelProfiles').mockResolvedValue({ ...created, profiles: { ...U1.profiles!, fileName: 'a1.zip' } });
    await render('/admin/printer-models/new');
    expect($('h1')?.textContent).toBe('Add printer model');
    expect($$('.printers-nav a.is-active').map((a) => a.textContent)).toEqual(['Printer models']);
    expect(container.textContent).not.toContain('Printers of this model');

    await submit();
    expect($('.printer-editor__problems')?.textContent).toBe(
      'Enter the model name (up to 120 characters).Print plate width, depth and height must be between 1 and 5000 mm.',
    );
    await type(field<HTMLSelectElement>('Start from a known printer'), 'Bambu Lab A1 mini');
    expect([field('Model name').value, field('Manufacturer').value, field('Width (X)').value, field('Max height (Z)').value, field('Max colors').value])
      .toEqual(['Bambu Lab A1 mini', 'Bambu Lab', '180', '180', '4']);
    await type(field('Model name'), 'snapmaker u1');
    expect($('.printer-editor__problems')?.textContent).toBe('A printer model named "snapmaker u1" already exists. Model names must be unique.');
    await type(field('Model name'), ' A1 mini (AMS lite) ');
    await chooseFile(new File(['PK'], 'a1.zip', { type: 'application/zip' }));
    expect(container.textContent).toContain('a1.zip (0 KB) will be uploaded when you save.');

    vi.mocked(api.listPrinterModels).mockResolvedValue([{ ...created, profiles: { ...U1.profiles!, fileName: 'a1.zip' } }, UNUSED, U1]);
    await submit();
    expect(create).toHaveBeenCalledWith({ name: 'A1 mini (AMS lite)', manufacturer: 'Bambu Lab', plate: TEMPLATES[0].plate, maxColors: 4 });
    expect(upload).toHaveBeenCalledWith('a1', expect.any(File));
    expect(path()).toBe('/admin/printer-models/a1');
    expect($('h1')?.textContent).toBe('Edit printer model: A1 mini (AMS lite)');
    expect($('.banner--success')?.textContent).toBe('Added printer model "A1 mini (AMS lite)".');
    expect($('.printer-editor__current')?.textContent).toContain('a1.zip');
  });

  it('edits a model for all its printers, keeping its profiles unless they are replaced or removed', async () => {
    const update = vi.spyOn(api, 'updatePrinterModel').mockImplementation(async (_id, input) => ({ ...U1, ...input }));
    const remove = vi.spyOn(api, 'removePrinterModelProfiles').mockImplementation(async () => ({ ...U1, maxColors: 8, profiles: null }));
    const upload = vi.spyOn(api, 'uploadPrinterModelProfiles');
    await render('/admin/printer-models/u1');
    expect($('h1')?.textContent).toBe('Edit printer model: Snapmaker U1');
    expect(container.textContent).toContain('Changes apply to all 2 printers of this model.');
    expect($$('.printer-model-page__printers li').map((li) => li.textContent)).toEqual(['U1-01', 'U1-02']);
    expect($$('label.field').map((l) => l.querySelector('span')?.textContent)).not.toContain('Start from a known printer');
    expect($('.printer-editor__current')?.textContent).toContain('Snapmaker U1.orca_printer');
    expect($('.printer-editor__contents')?.textContent).toContain('Printer presets: Snapmaker U1 (0.4 nozzle)');
    expect(button('Save model').disabled).toBe(true);
    expect(button('Delete model').disabled).toBe(true);

    await type(field('Max colors'), '8');
    await type(field('Max height (Z)'), '260');
    expect(button('Save model').disabled).toBe(false);
    await submit();
    expect(update).toHaveBeenCalledWith('u1', { name: 'Snapmaker U1', manufacturer: 'Snapmaker', plate: { widthMm: 270, depthMm: 270, heightMm: 260 }, maxColors: 8 });
    expect(upload).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect($('.banner--success')?.textContent).toBe('Saved printer model "Snapmaker U1" for 2 printers.');
    expect(path()).toBe('/admin/printer-models/u1');
    expect(button('Save model').disabled).toBe(true);

    await click(button('Remove'));
    expect(container.textContent).toContain('The profiles will be removed when you save.');
    await submit();
    expect(remove).toHaveBeenCalledWith('u1');
    expect($('.printer-editor__current')).toBeNull();
    expect(container.textContent).toContain('Upload a ZIP archive');
  });

  it('reports a failed profile upload after saving the model, and rejects non-ZIP files before uploading', async () => {
    vi.spyOn(api, 'updatePrinterModel').mockResolvedValue(UNUSED);
    vi.spyOn(api, 'uploadPrinterModelProfiles').mockRejectedValue(new ApiError(400, 'This does not look like a ZIP archive.'));
    await render('/admin/printer-models/x1');
    await chooseFile(new File(['solid'], 'model.stl', { type: 'model/stl' }));
    expect($('form [role="alert"]')?.textContent).toContain('Choose a ZIP archive');
    expect(button('Save model').disabled).toBe(true);
    await chooseFile(new File(['PK'], 'Export.ORCA_PRINTER', { type: '' }));
    expect($('form [role="alert"]')).toBeNull();
    await submit();
    expect($('.banner--error')?.textContent).toBe('The printer model was saved, but its profiles could not be updated: This does not look like a ZIP archive.');
  });

  it('deletes an unused model and returns to the list', async () => {
    const del = vi.spyOn(api, 'deletePrinterModel').mockResolvedValue();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await render('/admin/printer-models/x1');
    expect(container.textContent).toContain('No printers of this model yet.');
    await click(button('Delete model'));
    expect(del).toHaveBeenCalledWith('x1');
    expect(path()).toBe('/admin/printer-models');
    expect($('.banner--success')?.textContent).toBe('Deleted printer model "Prusa XL".');
  });

  it('explains a model that no longer exists', async () => {
    await render('/admin/printer-models/gone');
    expect($('h1')?.textContent).toBe('Printer model not found');
    expect($('a.btn')?.getAttribute('href')).toBe('/admin/printer-models');
  });
});
