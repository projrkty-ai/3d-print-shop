// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { ProductPreview } from '../../components/ProductPreview';
import type { CustomOrder } from '../../types';
import { AdminCustomOrderPage } from './AdminCustomOrderPage';
import { AdminCustomOrdersPage } from './AdminCustomOrdersPage';

const auth = vi.hoisted(() => ({ signOut: () => undefined }));
vi.mock('../../store/AdminAuthContext', () => ({ useAdminAuth: () => auth }));
const thumbnail = vi.hoisted(() => vi.fn((..._args: unknown[]) => 'data:image/png;base64,AA=='));
vi.mock('../../utils/modelThumbnail', () => ({ geometryThumbnail: thumbnail }));
vi.mock('../../components/LazyProductPreview', () => ({
  LazyProductPreview: (props: ComponentProps<typeof ProductPreview>) => (
    <div data-preview={props.meshUrl ?? ''} data-plates={props.meshPlates?.join(',')} data-caption={props.caption}
      data-color={props.color} data-parts={JSON.stringify(props.partColors)} />
  ),
}));

const STL = readFileSync(`${import.meta.dirname}/../../../fixtures/models/twisted-star-vase.stl`);

function request(patch: Partial<CustomOrder> = {}): CustomOrder {
  return {
    id: 'request-1', number: 'CP-261101-ABCD', status: 'submitted', quotedPrice: null, currency: 'USD', adminNote: '',
    customer: { name: 'Anna Nowak', email: 'anna@example.com', address: { line1: 'Długa 1', city: 'Kraków', postalCode: '30-001', country: 'PL' } },
    files: [
      { fileId: 'aaaaaaaaaaaaaaaaaaaaaaaa', fileName: 'wazon łódź.stl', format: 'stl', sizeBytes: STL.length, quantity: 3 },
      { fileId: 'bbbbbbbbbbbbbbbbbbbbbbbb', fileName: 'lid.3mf', format: '3mf', sizeBytes: 2048, quantity: 1 },
    ],
    customerNote: 'Black PETG, please',
    createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z',
    ...patch,
  };
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  // Files download for their miniatures as soon as a request opens; by default they never arrive.
  vi.spyOn(api, 'downloadCustomOrderFile').mockReturnValue(new Promise(() => undefined));
  vi.spyOn(api, 'getLog').mockResolvedValue([]);
  vi.spyOn(api, 'getMailDelivery').mockResolvedValue({ transport: 'smtp', from: 'PrintForge <shop@example.com>' });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === text)!;

async function until(check: () => boolean, what: string) {
  for (let i = 0; i < 300 && !check(); i++) await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  if (!check()) throw new Error(`Timed out waiting for ${what}:\n${container.textContent}`);
}

function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

const renderDetail = () => act(async () => root.render(
  <MemoryRouter initialEntries={['/admin/custom-orders/request-1']}>
    <Routes>
      <Route path="/admin/custom-orders/:orderId" element={<AdminCustomOrderPage />} />
      <Route path="/admin/custom-orders" element={<p>List</p>} />
    </Routes>
  </MemoryRouter>,
));

describe('print requests list', () => {
  it('lists requests with files, quote and status, and filters them', async () => {
    const list = vi.spyOn(api, 'listCustomOrders').mockResolvedValue([
      request(),
      request({ id: 'request-2', number: 'CP-261102-WXYZ', status: 'approved', quotedPrice: 42.5, customer: { ...request().customer, name: 'Jan Kowalski' } }),
    ]);
    await act(async () => root.render(<MemoryRouter><AdminCustomOrdersPage /></MemoryRouter>));
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows.map((row) => row.querySelector('a')?.textContent)).toEqual(['CP-261101-ABCD', 'CP-261102-WXYZ']);
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/admin/custom-orders/request-1');
    expect(rows[0].textContent).toContain('2 files · 4 prints');
    expect(rows[0].textContent).toContain('wazon łódź.stl, lid.3mf');
    expect(rows[0].textContent).toContain('Not quoted');
    expect(rows[0].textContent).toContain('Awaiting review');
    expect(rows[1].textContent).toContain('$42.50');
    expect(rows[1].textContent).toContain('Approved');
    expect(container.textContent).toContain('2 print requests · 1 awaiting review');

    await act(async () => type(container.querySelector<HTMLInputElement>('input[type="search"]')!, 'kowalski'));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    await act(async () => type(container.querySelector<HTMLInputElement>('input[type="search"]')!, 'łódź'));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);

    const select = container.querySelector<HTMLSelectElement>('select')!;
    await act(async () => {
      select.value = 'submitted';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(list).toHaveBeenLastCalledWith('submitted');
  });
});

describe('print request review', () => {
  it('shows the files, puts order processing and the log book under them, and saves the status with a quote and email', async () => {
    vi.spyOn(api, 'getCustomOrder').mockResolvedValue(request());
    const update = vi.spyOn(api, 'updateCustomOrder').mockImplementation(async (_id, changes) => request({ ...changes, updatedAt: '2026-11-02T10:00:00.000Z' }));
    // The approval email states the quote, so it can't be sent without one.
    const preview = vi.spyOn(api, 'previewStatusEmail').mockImplementation(async (_kind, _id, input) => ({
      to: 'anna@example.com', template: 'customOrder.approved', subject: 'Your print request CP-261101-ABCD is approved',
      body: `Price: ${input.quotedPrice ?? ''}`, required: ['orderNumber', 'quotedPrice'], missing: input.quotedPrice == null ? ['quotedPrice'] : [],
    }));
    const sent = {
      id: 'e1', orderKind: 'customOrder', orderId: 'request-1', createdAt: '2026-11-02T10:00:00.000Z', type: 'emailSent',
      to: 'anna@example.com', subject: 'Approved', body: 'Price', template: 'customOrder.approved', delivery: 'sent', messageId: '<1@x>',
    } as const;
    const log = vi.spyOn(api, 'getLog').mockResolvedValue([]);
    await renderDetail();
    expect(container.querySelector('h1')?.textContent).toContain('CP-261101-ABCD');
    const files = [...container.querySelectorAll('.custom-file')];
    expect(files.map((file) => file.querySelector('.custom-file__name')?.textContent)).toEqual(['wazon łódź.stl', 'lid.3mf']);
    expect(files[0].textContent).toContain('× 3');
    expect(container.textContent).toContain('2 files · 4 prints');
    expect(container.querySelector('a[href^="mailto:anna@example.com"]')).not.toBeNull();
    // The printing instructions moved to the side; processing and the log book follow the models.
    const headings = (selector: string) => [...container.querySelectorAll(`${selector} > section > h2, ${selector} > section > .card__header > h2`)]
      .map((h) => h.textContent);
    expect(headings('.order-detail__layout > div')).toEqual(['Models', 'Order processing', 'Log book']);
    expect(headings('.order-detail__layout > aside')).toEqual(["Customer's printing instructions", 'Customer']);
    expect(container.querySelector('aside')?.textContent).toContain('Black PETG, please');

    const processing = container.querySelector<HTMLElement>('.order-processing')!;
    const save = () => [...processing.querySelectorAll('button')].find((b) => /^Save/.test(b.textContent!))!;
    expect(save().disabled).toBe(true);
    const quote = processing.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!;
    await act(async () => type(quote, '-5'));
    expect(quote.getAttribute('aria-invalid')).toBe('true');
    expect(save().disabled).toBe(true);
    await act(async () => {
      type(quote, '');
      const status = processing.querySelector<HTMLSelectElement>('select')!;
      status.value = 'approved';
      status.dispatchEvent(new Event('change', { bubbles: true }));
      type(processing.querySelector<HTMLTextAreaElement>('textarea')!, 'Needs supports');
    });
    await until(() => !!processing.querySelector('.status-email__missing'), 'the preview');
    expect(processing.querySelector('.status-email__missing')?.textContent).toBe('Set the quoted price: this email states it.');
    expect(save().textContent).toBe('Save and send email');
    expect(save().disabled).toBe(true);
    await act(async () => type(quote, '24,50'));
    await until(() => !save().disabled, 'the preview with the quote');
    expect(preview).toHaveBeenLastCalledWith('customOrder', 'request-1', { status: 'approved', note: '', quotedPrice: 24.5 });
    expect(processing.querySelector('.email-preview')?.textContent).toContain('Price: 24.5');

    log.mockResolvedValue([sent]);
    await act(async () => save().click());
    expect(update).toHaveBeenCalledWith('request-1', { status: 'approved', adminNote: 'Needs supports', notify: true, quotedPrice: 24.5 });
    expect(processing.querySelector('[role="status"]')?.textContent).toBe('Changes saved. Email sent to anna@example.com.');
    expect(container.querySelector('h1 .status-badge')?.textContent).toBe('Approved');
    expect(quote.value).toBe('24.5');
    expect(save().disabled).toBe(true);
    expect(container.querySelector('.logbook__entry')?.textContent).toContain('Email to anna@example.com');

    // Clearing the quote withdraws it; without a status change nothing is emailed.
    await act(async () => type(quote, ''));
    await act(async () => save().click());
    expect(update).toHaveBeenLastCalledWith('request-1', { status: 'approved', adminNote: 'Needs supports', quotedPrice: null });
  });

  it('shows each model as a miniature with size, volume and triangles, opening it in 3D on click', async () => {
    vi.spyOn(api, 'getCustomOrder').mockResolvedValue(request());
    // The second file claims to be a 3MF but isn't one, so it can't be previewed.
    const download = vi.spyOn(api, 'downloadCustomOrderFile').mockResolvedValue(new Blob([STL]));
    let objectUrls = 0;
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:admin/model-${++objectUrls}`), revokeObjectURL: vi.fn() }));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.startsWith('blob:admin/')
      ? new Response(STL, { headers: { 'Content-Type': 'application/octet-stream' } })
      : Response.json({ error: 'Not found' }, { status: 404 }))));
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
    await renderDetail();
    const rows = () => [...container.querySelectorAll<HTMLElement>('.custom-file')];
    expect(rows()[0].textContent).toContain('Loading preview…');
    await until(() => !container.textContent!.includes('Loading preview…'), 'both files to be read');

    // Files are fetched with the admin key, one download each.
    expect(download.mock.calls).toEqual([['request-1', 'aaaaaaaaaaaaaaaaaaaaaaaa'], ['request-1', 'bbbbbbbbbbbbbbbbbbbbbbbb']]);
    const [vase, lid] = rows();
    expect(vase.querySelector('.custom-file__thumb img')?.getAttribute('src')).toBe('data:image/png;base64,AA==');
    const facts = vase.querySelector('.custom-file__facts')!.textContent;
    expect(facts).toMatch(/^Size \d+(\.\d)? × \d+(\.\d)? × \d+(\.\d)? mmVolume \d+(\.\d)? cm³Triangles [\d,]+$/);
    expect(lid.querySelector('.custom-file__thumb img')).toBeNull();
    expect(lid.querySelector('.custom-file__thumb')?.textContent).toBe('3MF');
    expect(lid.textContent).toContain("Preview unavailable: This file isn't a valid 3MF archive.");
    expect(lid.querySelector<HTMLButtonElement>('.custom-file__open')?.disabled).toBe(true);
    // The miniature and description are the way into 3D; there is no separate button.
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'View in 3D')).toBe(false);

    const open = vase.querySelector<HTMLButtonElement>('.custom-file__open')!;
    expect(open.getAttribute('aria-label')).toBe('View wazon łódź.stl in 3D');
    expect(open.contains(vase.querySelector('.custom-file__thumb'))).toBe(true);
    expect(open.contains(vase.querySelector('.custom-file__facts'))).toBe(true);
    expect(open.contains(vase.querySelector('.custom-file__copies'))).toBe(false);
    open.focus();
    await act(async () => open.click());
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.querySelector('h2')?.textContent).toBe('wazon łódź.stl');
    expect(dialog.textContent).toContain('Print request CP-261101-ABCD, file 1');
    expect(dialog.querySelector('[data-preview]')?.getAttribute('data-preview')).toBe('blob:admin/model-1');
    expect(dialog.textContent).toMatch(/Size\d+(\.\d)? × \d+(\.\d)? × \d+(\.\d)? mm/);
    expect(dialog.textContent).toContain('Triangles');
    expect(dialog.textContent).toContain('Fits the 270 mm build volume.');
    expect(dialog.querySelector('[data-preview]')?.getAttribute('data-caption')).toMatch(/ mm$/);

    // Saving reuses the downloaded file.
    await act(async () => [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Download')!.click());
    expect(clicked.map((link) => [link.getAttribute('href'), link.download])).toEqual([['blob:admin/model-1', 'CP-261101-ABCD-wazon łódź.stl']]);
    expect(download).toHaveBeenCalledTimes(2);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  it('shows the chosen nozzle, layer height and filaments with an estimate the admin can use as the quote', async () => {
    const pla = { id: 'pla', name: 'PLA', pricePerKg: 80, densityGPerCm3: 1.24 };
    const ordered = request({
      files: [{
        ...request().files[0],
        nozzle: { id: 'nozzle-0-6', diameterMm: 0.6, priceMultiplier: 0.9 },
        layerHeight: { id: 'layer-0-16', heightMm: 0.16, priceMultiplier: 1.5 },
        parts: [{ key: 'model', name: 'Model', filament: pla, color: { id: 'red', name: 'Red', hex: '#c62828' } }],
      }],
    });
    vi.spyOn(api, 'getCustomOrder').mockResolvedValue(ordered);
    vi.spyOn(api, 'downloadCustomOrderFile').mockResolvedValue(new Blob([STL]));
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:admin/model-1'), revokeObjectURL: vi.fn() }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(STL, { headers: { 'Content-Type': 'application/octet-stream' } })));
    thumbnail.mockClear();
    await renderDetail();
    await until(() => !!container.querySelector('.custom-file__estimate'), 'the estimate');

    const row = container.querySelector('.custom-file')!;
    expect(row.querySelector('.print-choices')?.textContent).toBe('Nozzle 0.6 mm · layers 0.16 mmPLA, Red');
    const estimate = row.querySelector('.custom-file__estimate')!.textContent!;
    const [, grams, each, total] = /^Estimate: (\d+) g · \$([\d.]+) each · \$([\d.]+) for 3 copies$/.exec(estimate)!;
    // The admin sees the weight: the file's volume in PLA at $80/kg, × 0.9 for the nozzle and × 1.5 for the layers.
    expect(Number(each)).toBeCloseTo(Number(grams) / 1000 * 80 * 0.9 * 1.5, 1);
    expect(Number(total)).toBeCloseTo(Number(each) * 3, 2);
    // The miniature is drawn in the ordered filament color.
    expect(thumbnail).toHaveBeenCalledWith(expect.anything(), '#c62828', { model: '#c62828' });

    expect(container.querySelector('.custom-order__estimate')?.textContent).toBe(`Estimated from the files: $${total}Use estimate`);
    await act(async () => button('Use estimate').click());
    expect(container.querySelector<HTMLInputElement>('input[inputmode="decimal"]')?.value).toBe(String(Number(total)));
    expect(button('Save changes').disabled).toBe(false);

    await act(async () => container.querySelector<HTMLButtonElement>('.custom-file__open')!.click());
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const preview = dialog.querySelector('[data-preview]')!;
    expect(preview.getAttribute('data-color')).toBe('#c62828');
    expect(JSON.parse(preview.getAttribute('data-parts')!)).toEqual({ model: '#c62828' });
    expect(dialog.textContent).toContain('Print optionsNozzle 0.6 mm · layers 0.16 mmPLA, Red');
    expect(dialog.textContent).toContain(estimate);
  });

  it('handles requests placed before print options existed', async () => {
    vi.spyOn(api, 'getCustomOrder').mockResolvedValue(request({ files: [request().files[0]] }));
    vi.spyOn(api, 'downloadCustomOrderFile').mockResolvedValue(new Blob([STL]));
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:admin/model-1'), revokeObjectURL: vi.fn() }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(STL, { headers: { 'Content-Type': 'application/octet-stream' } })));
    await renderDetail();
    await until(() => !container.textContent!.includes('Loading preview…'), 'the file to be read');
    expect(container.querySelector('.custom-file')?.textContent).toContain('No print options (requested before they existed)');
    expect(container.querySelector('.custom-file__estimate')).toBeNull();
    expect(container.querySelector('.custom-order__estimate')?.textContent).toBe("No estimate: some files can't be read or have no print options.");
  });

  it('reports files that cannot be downloaded', async () => {
    vi.spyOn(api, 'getCustomOrder').mockResolvedValue(request());
    const { ApiError } = await import('../../api/client');
    vi.spyOn(api, 'downloadCustomOrderFile').mockRejectedValue(new ApiError(404, 'Model file not found.'));
    await renderDetail();
    await until(() => container.querySelectorAll('.custom-file__open:disabled').length === 2, 'both previews to fail');
    expect(container.querySelector('.custom-file')?.textContent).toContain('Preview unavailable: Model file not found.');
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Download lid.3mf"]')!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Model file not found.');
  });

  it('deletes a request after confirmation and returns to the list', async () => {
    vi.spyOn(api, 'getCustomOrder').mockResolvedValue(request());
    const remove = vi.spyOn(api, 'deleteCustomOrder').mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await renderDetail();
    await act(async () => button('Delete request').click());
    expect(remove).not.toHaveBeenCalled();
    await act(async () => button('Delete request').click());
    expect(confirm).toHaveBeenLastCalledWith('Delete print request CP-261101-ABCD and its model files? This cannot be undone.');
    expect(remove).toHaveBeenCalledWith('request-1');
    expect(container.textContent).toBe('List');
  });
});
