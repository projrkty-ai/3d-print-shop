// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../api/client';
import type { ProductPreview } from '../../components/ProductPreview';
import { createSeedProducts } from '../../data/seedProducts';
import type { CatalogModel, Order, OrderItem, PricingSettings, Printer, PrintJob, Product, ProjectProduct, UploadModel } from '../../types';
import { readFileBytes } from '../../utils/files';
import { AdminOrderPage } from './AdminOrderPage';
import { AdminOrdersPage } from './AdminOrdersPage';

const auth = vi.hoisted(() => ({ signOut: () => undefined }));
vi.mock('../../store/AdminAuthContext', () => ({ useAdminAuth: () => auth }));
const catalog = vi.hoisted(() => ({ products: [] as Product[] }));
vi.mock('../../store/ProductsContext', () => ({
  useProducts: () => ({ getProduct: (id: string) => catalog.products.find((product) => product.id === id), reload: async () => undefined }),
}));
const thumbnail = vi.hoisted(() => vi.fn((..._args: unknown[]) => 'data:image/png;base64,AA=='));
vi.mock('../../utils/modelThumbnail', () => ({ geometryThumbnail: thumbnail }));
vi.mock('../../components/LazyProductPreview', () => ({
  LazyProductPreview: (props: ComponentProps<typeof ProductPreview>) => (
    <div data-preview={props.meshUrl ?? ''} data-caption={props.caption} data-color={props.color} data-parts={JSON.stringify(props.partColors)} />
  ),
}));

/** The browser slicer without a Web Worker: every plate sliced in 70 min with 22 g on extruder 1. */
const slices = vi.hoisted(() => [] as { name: string; settings: Record<string, unknown> }[]);
vi.mock('../../slicer/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../slicer/client')>();
  return {
    ...actual,
    createSlicerClient: () => ({
      inspect: vi.fn(),
      slice: vi.fn(async (_bytes: ArrayBuffer, name: string, settings: Record<string, unknown>, onProgress: (stage: string, fraction: number) => void) => {
        slices.push({ name, settings });
        onProgress('infill', 0.5);
        return { result: { time_s: 4200, weight_g: 22, per_extruder: [{ extruder: 1, weight_g: 22, length_m: 7 }] } };
      }),
      cancel: vi.fn(),
      dispose: vi.fn(),
    }),
  };
});

const STL = readFileSync(`${import.meta.dirname}/../../../fixtures/models/twisted-star-vase.stl`);
const U1 = { printer: 'Snapmaker U1 (0.4 nozzle)', process: '0.20 Standard @Snapmaker U1 (0.4 nozzle)', filament: 'Generic PLA @U1 0.4 nozzle' };
const pricing: PricingSettings = {
  hourlyRate: 3, handlingFee: 4.5, filamentPricePerKg: { PLA: 20, PETG: 30, ABS: 25, ASA: 35, TPU: 50, resin: 60 }, updatedAt: '2026-11-05T10:00:00.000Z',
};
const customer = { name: 'Anna Nowak', email: 'anna@example.com', phone: '+48 600 000 000', address: { line1: 'Długa 1', city: 'Kraków', postalCode: '30-001', country: 'PL' } };
const pla = { id: 'pla', name: 'PLA', pricePerKg: 80, densityGPerCm3: 1.24 };
const project = {
  source: 'printables' as const, id: '12345', title: 'Self-watering planter', description: 'Keeps herbs alive.', license: 'CC BY 4.0',
  thumbnailUrl: 'https://media.printables.com/cover.jpg', url: 'https://www.printables.com/model/12345-self-watering-planter', author: 'Prusa',
  verified: true, sameSettingsForAll: false,
};

function order(patch: Partial<Order> = {}): Order {
  return {
    id: 'order-1', number: 'CP-261101-ABCD', status: 'received', source: 'upload', customer, customerNote: 'Black PETG, please', adminNote: '', currency: 'USD',
    items: [
      { model: { source: 'upload', fileId: 'aaaaaaaaaaaaaaaaaaaaaaaa', fileName: 'wazon łódź.stl', format: 'stl', sizeBytes: STL.length }, quantity: 3, unitPrice: null, lineTotal: null },
      { model: { source: 'upload', fileId: 'bbbbbbbbbbbbbbbbbbbbbbbb', fileName: 'lid.3mf', format: '3mf', sizeBytes: 2048 }, quantity: 1, unitPrice: null, lineTotal: null },
    ],
    price: { mode: 'quote', handlingFee: 5, estimated: null, reviewed: null, total: null },
    createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z',
    ...patch,
  };
}

const projectOrder = (patch: Partial<Order> = {}) => order({
  id: 'po-1', number: 'PJ-261106-K7QX', source: 'project', project, customerNote: 'Print the saucer first.',
  items: [
    {
      model: { source: 'project', file: { id: '9', name: 'planter.stl', sizeBytes: 20480, thumbnailUrl: null }, scalePercent: 120, filaments: [{ material: 'PETG', color: 'matte black' }, { material: 'TPU', color: '' }] },
      quantity: 2, unitPrice: null, lineTotal: null,
    },
    { model: { source: 'project', file: { id: '10', name: 'saucer.stl', sizeBytes: 2_097_152, thumbnailUrl: null }, scalePercent: 100, filaments: [{ material: 'PLA', color: 'white' }] }, quantity: 1, unitPrice: null, lineTotal: null },
  ],
  ...patch,
});

const variant = { id: 'fine', label: 'Fine', nozzleMm: 0.4, layerHeightMm: 0.2, material: 'PETG' as const, presets: U1, support: true, overrides: { sparse_infill_density: '20%' } };
const podOrder = (patch: Partial<Order> = {}) => order({
  id: 'pod-1', number: 'PJ-261107-POD1', source: 'printOnDemand', project,
  items: [{
    model: {
      source: 'printOnDemand', productId: 'pp-1', title: 'Planter kit', materialsChanged: false,
      models: [{ file: { id: '9', name: 'planter.stl', sizeBytes: null, thumbnailUrl: null }, settings: { quantity: 1, scalePercent: 120, filaments: [{ material: 'PETG', color: 'blue' }] } }],
      print: { scale: 1.2, plates: [{ plateId: 1, name: 'Pot', variant }, { plateId: 2, name: 'Saucer', variant: { ...variant, id: 'std', support: false, overrides: {} } }] },
    },
    quantity: 2, unitPrice: 6.55, lineTotal: 13.1,
  }],
  price: { mode: 'fixed', handlingFee: 4.5, estimated: null, reviewed: 17.6, total: 17.6 },
  ...patch,
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  catalog.products = [];
  slices.length = 0;
  // Files download for their miniatures as soon as an order opens; by default they never arrive.
  vi.spyOn(api, 'downloadOrderFile').mockReturnValue(new Promise(() => undefined));
  // Project files are downloaded from their site only when needed; by default that never ends.
  vi.spyOn(api, 'downloadProjectFile').mockReturnValue(new Promise(() => undefined));
  vi.spyOn(api, 'getLog').mockResolvedValue([]);
  vi.spyOn(api, 'getPricing').mockResolvedValue(pricing);
  vi.spyOn(api, 'getMailDelivery').mockResolvedValue({ transport: 'smtp', from: 'PrintForge <shop@example.com>' });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const $ = <T extends Element = HTMLElement>(selector: string, within: ParentNode = container) => within.querySelector<T>(selector);
const button = (text: string, within: ParentNode = container) => [...within.querySelectorAll('button')].find((b) => b.textContent === text)!;
const byLabel = <T extends Element = HTMLInputElement>(label: string) => $<T>(`[aria-label="${label}"]`)!;

async function until(check: () => boolean, what: string) {
  for (let i = 0; i < 300 && !check(); i++) await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  if (!check()) throw new Error(`Timed out waiting for ${what}:\n${container.textContent}`);
}

function type(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname}{location.search}</output>;
}

async function openOrder(shown: Order) {
  vi.spyOn(api, 'getOrder').mockResolvedValue(shown);
  await act(async () => root.render(
    <MemoryRouter initialEntries={[`/admin/orders/${shown.id}`]}>
      <Routes>
        <Route path="/admin/orders/:orderId" element={<AdminOrderPage />} />
        <Route path="/admin/orders" element={<p>List</p>} />
      </Routes>
    </MemoryRouter>,
  ));
}

/** Serves the order's files (and public model files) as the twisted vase STL, with object URLs. */
function serveFiles() {
  vi.spyOn(api, 'downloadOrderFile').mockResolvedValue(new Blob([STL]));
  let objectUrls = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:admin/model-${++objectUrls}`), revokeObjectURL: vi.fn() }));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(STL, { headers: { 'Content-Type': 'application/octet-stream' } })));
}

/** The server downloads the order's project files from their site (`failing`: these answer with an error). */
function servesProjectFiles(failing: Record<string, ApiError> = {}, names: Record<string, string> = { 9: 'planter.stl', 10: 'saucer.stl' }) {
  return vi.spyOn(api, 'downloadProjectFile').mockImplementation(async (_orderId, sourceFileId) => {
    if (failing[sourceFileId]) throw failing[sourceFileId];
    return { blob: new Blob([STL]), fileName: names[sourceFileId] ?? `${sourceFileId}.stl`, format: 'stl' };
  });
}

/** Saved downloads: the file name and contents of every link the page clicked. */
function captureDownloads() {
  const saved: { name: string; blob: Blob }[] = [];
  const blobs = new Map<string, Blob>();
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn((blob: Blob) => {
      const url = `blob:admin/${blobs.size + 1}`;
      blobs.set(url, blob);
      return url;
    }),
    revokeObjectURL: vi.fn(),
  }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, blob: blobs.get(this.getAttribute('href') ?? '')! });
  });
  return saved;
}

describe('orders list', () => {
  it('lists orders of every source together, with their models, price and status, and filters them', async () => {
    const catalogOrder = order({
      id: 'order-2', number: 'PF-261102-WXYZ', source: 'catalog', status: 'paid', customer: { ...customer, name: 'Jan Kowalski' },
      items: [{ model: { source: 'catalog', productId: 'vase', productName: 'Spiral Vase' } as CatalogModel, quantity: 2, unitPrice: 20, lineTotal: 40 }],
      price: { mode: 'fixed', handlingFee: 5, estimated: null, reviewed: null, total: 45 },
    });
    const list = vi.spyOn(api, 'listOrders').mockResolvedValue([order(), catalogOrder, projectOrder({ status: 'quoted', price: { ...order().price, total: 42.5 } })]);
    await act(async () => root.render(
      <MemoryRouter initialEntries={['/admin/orders?source=upload']}>
        <Routes><Route path="/admin/orders" element={<><AdminOrdersPage /><Where /></>} /></Routes>
      </MemoryRouter>,
    ));
    // Opened from a former print-requests link: filtered to uploads.
    expect(list).toHaveBeenLastCalledWith({ status: undefined, source: 'upload' });
    const rows = () => [...container.querySelectorAll('tbody tr')];
    expect(rows().map((row) => row.querySelector('a')?.textContent)).toEqual(['CP-261101-ABCD', 'PF-261102-WXYZ', 'PJ-261106-K7QX']);
    expect(rows()[0].querySelector('a')?.getAttribute('href')).toBe('/admin/orders/order-1');
    expect(rows()[0].querySelectorAll('td')[3].textContent).toBe("Customer's modelswazon łódź.stl, lid.3mf");
    expect(rows()[0].querySelectorAll('td')[4].textContent).toBe('4');
    expect(rows()[0].querySelectorAll('td')[5].textContent).toBe('Not quotedquote');
    expect(rows()[0].querySelector('.status-badge')?.textContent).toBe('Received');
    expect(rows()[1].querySelectorAll('td')[3].textContent).toBe('CatalogSpiral Vase');
    expect(rows()[1].querySelectorAll('td')[5].textContent).toBe('$45.00fixed price');
    expect(rows()[2].querySelectorAll('td')[3].textContent).toBe('External projectSelf-watering planter');
    expect(rows()[2].querySelector('.status-badge')?.textContent).toBe('Quoted');
    expect(container.textContent).toContain('3 orders · $87.50 excluding cancelled · 1 to quote');

    await act(async () => type($<HTMLInputElement>('input[type="search"]')!, 'kowalski'));
    expect(rows()).toHaveLength(1);
    await act(async () => type($<HTMLInputElement>('input[type="search"]')!, 'planter'));
    expect(rows().map((row) => row.querySelector('a')?.textContent)).toEqual(['PJ-261106-K7QX']);

    const [status, source] = [...container.querySelectorAll<HTMLSelectElement>('.admin__filters select')];
    expect([...status.options].map((option) => option.textContent)).toEqual([
      'All statuses', 'Received', 'Quoted', 'Accepted', 'Paid', 'In queue', 'Printing', 'Done', 'Shipped', 'Delivered', 'Rejected', 'Cancelled',
    ]);
    expect([...source.options].map((option) => option.textContent)).toEqual(['All sources', 'Catalog', "Customer's models", 'External project', 'Print on Demand']);
    await act(async () => type(status, 'quoted'));
    expect(list).toHaveBeenLastCalledWith({ status: 'quoted', source: 'upload' });
    await act(async () => type(source, ''));
    expect(list).toHaveBeenLastCalledWith({ status: 'quoted', source: undefined });
    expect($('[data-testid="where"]')?.textContent).toBe('/admin/orders');
  });
});

describe('order page, the same for every source', () => {
  it('shows the models, then measurements, processing and the log book, with the customer and the price beside', async () => {
    await openOrder(order());
    expect($('h1')?.textContent).toBe("Order CP-261101-ABCD Received Customer's models");
    const headings = (selector: string) => [...container.querySelectorAll(`${selector} > section > h2, ${selector} > section > .card__header > h2`)].map((h) => h.textContent);
    expect(headings('.order-detail__layout > div')).toEqual(['Models', 'Measurements and price', 'Order processing', 'Log book']);
    expect(headings('.order-detail__layout > aside')).toEqual(['Price', 'Customer']);
    expect($('aside')?.textContent).toContain('Black PETG, please');
    expect($('.order-price')?.textContent).toContain('Not quotedNeeds a quote.');
    expect($('a[href^="mailto:anna@example.com"]')).not.toBeNull();
  });

  it('saves the status with a quote and the status email, previewed from the unsaved form', async () => {
    await openOrder(order());
    const update = vi.spyOn(api, 'updateOrder').mockImplementation(async (_id, { notify: _n, note: _note, price, ...changes }) => order({
      ...changes, price: { ...order().price, total: price === undefined ? null : price }, updatedAt: '2026-11-02T10:00:00.000Z',
    }));
    // The quote email states the price, so it can't be sent without one.
    const preview = vi.spyOn(api, 'previewStatusEmail').mockImplementation(async (_id, input) => ({
      to: 'anna@example.com', template: 'quoted', subject: 'Your price for order CP-261101-ABCD',
      body: `Price: ${input.price ?? ''}`, required: ['orderNumber', 'price'], missing: input.price == null ? ['price'] : [],
    }));
    const sent = {
      id: 'e1', orderId: 'order-1', createdAt: '2026-11-02T10:00:00.000Z', type: 'emailSent',
      to: 'anna@example.com', subject: 'Quoted', body: 'Price', template: 'quoted', delivery: 'sent', messageId: '<1@x>',
    } as const;
    const processing = $<HTMLElement>('.order-processing')!;
    const save = () => [...processing.querySelectorAll('button')].find((b) => /^Save/.test(b.textContent!))!;
    expect(save().disabled).toBe(true);
    const price = processing.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!;
    await act(async () => type(price, '-5'));
    expect(price.getAttribute('aria-invalid')).toBe('true');
    expect(save().disabled).toBe(true);
    await act(async () => {
      type(price, '');
      type(processing.querySelector<HTMLSelectElement>('select')!, 'quoted');
      type(processing.querySelector<HTMLTextAreaElement>('textarea')!, 'Needs supports');
    });
    // Like the server: quoted only with a price.
    expect(processing.textContent).toContain('Set the price before marking the order as quoted.');
    await until(() => !!processing.querySelector('.status-email__missing'), 'the preview');
    expect(processing.querySelector('.status-email__missing')?.textContent).toBe('Set the price: this email states it.');
    expect(save().textContent).toBe('Save and send email');
    expect(save().disabled).toBe(true);
    await act(async () => type(price, '24,50'));
    await until(() => !save().disabled, 'the preview with the price');
    expect(preview).toHaveBeenLastCalledWith('order-1', { status: 'quoted', note: '', price: 24.5 });
    expect($('.email-preview', processing)?.textContent).toContain('Price: 24.5');

    vi.mocked(api.getLog).mockResolvedValue([sent]);
    await act(async () => save().click());
    expect(update).toHaveBeenCalledWith('order-1', { status: 'quoted', adminNote: 'Needs supports', price: 24.5, notify: true });
    expect(processing.querySelector('[role="status"]')?.textContent).toBe('Changes saved. Email sent to anna@example.com.');
    expect($('h1 .status-badge')?.textContent).toBe('Quoted');
    expect($('.order-price')?.textContent).toContain('$24.50Quoted by the shop.');
    expect(price.value).toBe('24.5');
    expect(save().disabled).toBe(true);
    expect($('.logbook__entry')?.textContent).toContain('Email to anna@example.com');

    // A quoted order keeps a price; back to received, the price can be withdrawn (here without an email).
    await act(async () => type(price, ''));
    expect(processing.textContent).toContain('Set the price before marking the order as quoted.');
    expect(save().disabled).toBe(true);
    await act(async () => type(processing.querySelector<HTMLSelectElement>('select')!, 'received'));
    await act(async () => processing.querySelector<HTMLInputElement>('.status-email__notify input')!.click());
    await act(async () => button('Save changes', processing).click());
    expect(update).toHaveBeenLastCalledWith('order-1', { status: 'received', adminNote: 'Needs supports', price: null, notify: false });
  });

  it('shows a fixed price without a price field, and the statuses every order shares', async () => {
    await openOrder(podOrder());
    const processing = $<HTMLElement>('.order-processing')!;
    expect(processing.querySelector('input[inputmode="decimal"]')).toBeNull();
    expect(processing.textContent).toContain('Price $17.60Fixed when the customer ordered; it cannot change.');
    expect([...processing.querySelector<HTMLSelectElement>('select')!.options].map((option) => option.value))
      .toEqual(['received', 'quoted', 'accepted', 'paid', 'queued', 'printing', 'done', 'shipped', 'delivered', 'rejected', 'cancelled']);
    const update = vi.spyOn(api, 'updateOrder').mockResolvedValue(podOrder({ status: 'paid' }));
    await act(async () => type(processing.querySelector<HTMLSelectElement>('select')!, 'paid'));
    await act(async () => processing.querySelector<HTMLInputElement>('.status-email__notify input')!.click());
    await act(async () => button('Save changes', processing).click());
    expect(update).toHaveBeenCalledWith('pod-1', { status: 'paid', adminNote: '', notify: false });
  });

  it("puts the order in a printer's queue with its print time, previews the email with the estimate, and moves it", async () => {
    const printer = (id: string, name: string, length: number) => ({
      id, name, modelId: 'u1', model: { id: 'u1', name: 'Snapmaker U1' }, location: '', notes: '', createdAt: '', updatedAt: '',
      queue: { length, nextStart: '2026-11-10T15:00:00.000Z' },
    }) as unknown as Printer;
    const printers = vi.spyOn(api, 'listPrinters').mockResolvedValue([printer('p1', 'U1-01', 2), printer('p2', 'U1-02', 0)]);
    const job: PrintJob = {
      printerId: 'p1', printerName: 'U1-01', queuedAt: '2026-11-10T10:00:00.000Z', printMinutes: 150, startedAt: null,
      estimatedStart: '2026-11-10T15:00:00.000Z', previousStatus: 'received',
    };
    const update = vi.spyOn(api, 'updateOrder').mockImplementation(async (_id, { queue }) =>
      podOrder({ status: 'queued', printJob: { ...job, printerId: queue!.printerId, printerName: queue!.printerId === 'p1' ? 'U1-01' : 'U1-02' } }));
    const preview = vi.spyOn(api, 'previewStatusEmail').mockImplementation(async (_id, input) => ({
      to: 'anna@example.com', template: 'queued', subject: 'In the print queue', body: input.queue ? 'Printing starts around Nov 10' : 'Printing starts around ',
      required: ['orderNumber', 'printStart', 'printDuration'], missing: input.queue ? [] : ['printStart', 'printDuration'],
    }));
    await openOrder(podOrder());
    const processing = $<HTMLElement>('.order-processing')!;
    const save = () => [...processing.querySelectorAll('button')].find((b) => /^Save/.test(b.textContent!))!;
    expect(printers).not.toHaveBeenCalled();
    await act(async () => type(processing.querySelector<HTMLSelectElement>('select')!, 'queued'));
    const printerSelect = () => processing.querySelector<HTMLSelectElement>('.order-processing__queue select')!;
    await until(() => printerSelect().options.length === 3, 'the printers');
    expect([...printerSelect().options].map((option) => option.textContent)).toEqual([
      'Choose a printer…', expect.stringMatching(/^U1-01 \(Snapmaker U1\) — 2 in the queue, next start /), expect.stringMatching(/^U1-02 \(Snapmaker U1\) — queue empty, next start /),
    ]);
    expect(processing.textContent).toContain('Choose the printer whose queue the order joins.');
    await until(() => !!processing.querySelector('.status-email__missing'), 'the preview');
    expect(processing.querySelector('.status-email__missing')?.textContent).toBe('Choose the printer and the print time: this email states when the order will be printed.');
    expect(save().disabled).toBe(true);

    // Not every item is measured: the print time is entered.
    await act(async () => type(printerSelect(), 'p1'));
    const minutes = processing.querySelector<HTMLInputElement>('.order-processing__queue input[type="number"]')!;
    expect(minutes.value).toBe('');
    expect(processing.textContent).toContain('Not every item is measured: enter how long the order prints. The queue adds a break of 1 h between prints.');
    expect(save().disabled).toBe(true);
    await act(async () => type(minutes, '150'));
    expect(processing.textContent).toContain('2 h 30 min.');
    await until(() => !save().disabled, 'the preview with the queue');
    expect(preview).toHaveBeenLastCalledWith('pod-1', { status: 'queued', note: '', price: 17.6, queue: { printerId: 'p1', printMinutes: 150 } });
    expect($('.email-preview', processing)?.textContent).toContain('Printing starts around Nov 10');
    await act(async () => save().click());
    expect(update).toHaveBeenCalledWith('pod-1', { status: 'queued', adminNote: '', queue: { printerId: 'p1', printMinutes: 150 }, notify: true });

    // The order page shows where it prints.
    const card = $<HTMLElement>('.order-print-job')!;
    expect(card.querySelector<HTMLAnchorElement>('a')?.getAttribute('href')).toBe('/admin/printers/p1');
    expect(card.textContent).toContain('Print time2 h 30 min');
    expect(processing.textContent).toContain('In the queue of U1-01 since');

    // Moved to another printer: it joins the end of that queue, and the customer is told again.
    await until(() => printerSelect().options.length === 3, 'the printers again');
    await act(async () => type(printerSelect(), 'p2'));
    expect(processing.textContent).toContain("The order moves to the end of this printer's queue.");
    await until(() => !save().disabled, 'the preview of the move');
    expect(save().textContent).toBe('Save and send email');
    await act(async () => save().click());
    expect(update).toHaveBeenLastCalledWith('pod-1', { status: 'queued', adminNote: '', queue: { printerId: 'p2', printMinutes: 150 }, notify: true });
  });

  it('deletes an order after confirmation and returns to the list', async () => {
    await openOrder(order());
    const remove = vi.spyOn(api, 'deleteOrder').mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await act(async () => button('Delete order').click());
    expect(remove).not.toHaveBeenCalled();
    await act(async () => button('Delete order').click());
    expect(confirm).toHaveBeenLastCalledWith("Delete order CP-261101-ABCD? This cannot be undone. The customer's files are deleted too.");
    expect(remove).toHaveBeenCalledWith('order-1');
    expect(container.textContent).toBe('List');
  });
});

describe("the customer's own models", () => {
  it('shows each model as a miniature with size, volume and triangles, opening it in 3D on click', async () => {
    serveFiles();
    const download = vi.mocked(api.downloadOrderFile);
    // The second file claims to be a 3MF but isn't one, so it can't be previewed.
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
    await openOrder(order());
    const rows = () => [...container.querySelectorAll<HTMLElement>('.custom-file')];
    await until(() => !container.textContent!.includes('Loading preview…'), 'both files to be read');
    // Files are fetched with the admin key, one download each.
    expect(download.mock.calls).toEqual([['order-1', 'aaaaaaaaaaaaaaaaaaaaaaaa'], ['order-1', 'bbbbbbbbbbbbbbbbbbbbbbbb']]);
    const [vase, lid] = rows();
    expect(vase.querySelector('.custom-file__thumb img')?.getAttribute('src')).toBe('data:image/png;base64,AA==');
    expect(vase.querySelector('.custom-file__facts')!.textContent).toMatch(/^Size \d+(\.\d)? × \d+(\.\d)? × \d+(\.\d)? mmVolume \d+(\.\d)? cm³Triangles [\d,]+$/);
    expect(lid.querySelector('.custom-file__thumb')?.textContent).toBe('3MF');
    expect(lid.textContent).toContain("Preview unavailable: This file isn't a valid 3MF archive.");
    expect(lid.querySelector<HTMLButtonElement>('.custom-file__open')?.disabled).toBe(true);

    const open = vase.querySelector<HTMLButtonElement>('.custom-file__open')!;
    expect(open.getAttribute('aria-label')).toBe('View wazon łódź.stl in 3D');
    open.focus();
    await act(async () => open.click());
    const dialog = $<HTMLElement>('[role="dialog"]')!;
    expect(dialog.querySelector('h2')?.textContent).toBe('wazon łódź.stl');
    expect(dialog.textContent).toContain('Order CP-261101-ABCD, file 1');
    expect(dialog.querySelector('[data-preview]')?.getAttribute('data-preview')).toBe('blob:admin/model-1');
    expect(dialog.textContent).toContain('Fits the 270 mm build volume.');
    // Saving reuses the downloaded file.
    await act(async () => button('Download', dialog).click());
    expect(clicked.map((link) => [link.getAttribute('href'), link.download])).toEqual([['blob:admin/model-1', 'CP-261101-ABCD-wazon łódź.stl']]);
    expect(download).toHaveBeenCalledTimes(2);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect($('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  it('shows the nozzle, layer height and filaments of orders placed before slicing, with their volume estimate', async () => {
    serveFiles();
    const ordered = order({
      items: [{
        ...order().items[0],
        model: {
          ...order().items[0].model as UploadModel,
          nozzle: { id: 'nozzle-0-6', diameterMm: 0.6, priceMultiplier: 0.9 },
          layerHeight: { id: 'layer-0-16', heightMm: 0.16, priceMultiplier: 1.5 },
          parts: [{ key: 'model', name: 'Model', filament: pla, color: { id: 'red', name: 'Red', hex: '#c62828' } }],
        },
      }],
    });
    thumbnail.mockClear();
    await openOrder(ordered);
    await until(() => !!$('.custom-file__estimate'), 'the estimate');
    const row = $('.custom-file')!;
    expect(row.querySelector('.print-choices')?.textContent).toBe('Nozzle 0.6 mm · layers 0.16 mmPLA, Red');
    const [, grams, each] = /^Estimate: (\d+) g · \$([\d.]+) each · \$([\d.]+) for 3 copies$/.exec(row.querySelector('.custom-file__estimate')!.textContent!)!;
    // The file's volume in PLA at $80/kg, × 0.9 for the nozzle and × 1.5 for the layers.
    expect(Number(each)).toBeCloseTo(Number(grams) / 1000 * 80 * 0.9 * 1.5, 1);
    expect(thumbnail).toHaveBeenCalledWith(expect.anything(), '#c62828', { model: '#c62828' });
    // Without a slicing profile, the admin chooses the slicer settings.
    expect($('[aria-label="Measurements of wazon łódź.stl"]')?.textContent).toContain('Ordered before slicing profiles: choose the slicer settings.');
  });

  it('reports files that cannot be downloaded', async () => {
    vi.spyOn(api, 'downloadOrderFile').mockRejectedValue(new ApiError(404, 'Model file not found.'));
    await openOrder(order());
    await until(() => container.querySelectorAll('.custom-file__open:disabled').length === 2, 'both previews to fail');
    expect($('.custom-file')?.textContent).toContain('Preview unavailable: Model file not found.');
    await act(async () => byLabel<HTMLButtonElement>('Download lid.3mf').click());
    expect($('[role="alert"]')?.textContent).toBe('Model file not found.');
  });

  it("slices each file with the customer's profile only, lets the admin correct it, and quotes the measured price", async () => {
    serveFiles();
    const profile = { ...U1, support: true, scale: 0.8 };
    const sliced = order({
      items: [{
        model: {
          source: 'upload', fileId: 'aaaaaaaaaaaaaaaaaaaaaaaa', fileName: 'vase.stl', format: 'stl', sizeBytes: STL.length, profile,
          parts: [{ key: 'model', name: 'Model', filament: pla, color: { id: 'black', name: 'Black', hex: '#1c1c1e' } }],
        },
        quantity: 2, unitPrice: null, lineTotal: null,
        estimate: { printMinutes: 60, filaments: [{ key: 'model', grams: 20 }], unitPrice: 3.6 },
      }],
      price: { mode: 'quote', handlingFee: 5, estimated: 12.2, reviewed: null, total: null },
    });
    // the server prices the saved result: 75 min ($3.75) + 25 g of PLA ($2.00) a copy, handling once
    const review = vi.spyOn(api, 'reviewOrderItem').mockImplementation(async (_id, _index, input) => ({
      ...sliced,
      items: [{
        ...sliced.items[0],
        review: {
          printMinutes: input.printMinutes, hourlyRate: 3, printTimeCost: 3.75, filamentCost: 2, unitPrice: 5.75, ...(input.sliced && { sliced: input.sliced }),
          filaments: [{ key: 'model', label: 'PLA Black', grams: 25, pricePerKg: 80, cost: 2 }], reviewedAt: '2026-11-02T10:00:00.000Z',
        },
      }],
      price: { ...sliced.price, reviewed: 16.5 },
    }));
    await openOrder(sliced);
    const card = () => $<HTMLElement>('[aria-label="Measurements of vase.stl"]')!;
    expect(card().textContent).toContain("Sliced with the customer's profile and scale only");
    expect(card().textContent).toContain(`${U1.printer} · ${U1.process} · ${U1.filament} · With supports · Scale 80%`);
    expect(card().textContent).toContain("Customer's estimate1 h · PLA Black: 20 g · $3.60 a copy");
    expect(card().textContent).toContain('Not measured yet.');
    await until(() => !button('Slice', card()).disabled, 'the file');

    await act(async () => button('Slice', card()).click());
    await until(() => !!byLabel('Print time of vase.stl in minutes'), 'the slicing result');
    expect(slices.map(({ settings }) => settings)).toEqual([expect.objectContaining({
      useProjectSettings: false, ...U1, support: 'on', scale: 0.8, plate: 1, copies: 1, overrides: {},
    })]);
    const minutes = byLabel('Print time of vase.stl in minutes');
    expect(minutes.value).toBe('70');
    expect(byLabel('Grams of PLA Black for vase.stl').value).toBe('22');
    // The preview uses the filament the customer chose: 70 min ($3.50) + 22 g × $80/kg ($1.76).
    expect(card().textContent).toContain('$5.26 a copy · $10.52 for 2 copies');
    await act(async () => {
      type(minutes, '75');
      type(byLabel('Grams of PLA Black for vase.stl'), '25');
    });
    expect(card().textContent).toContain('Sliced: 1 h 10 min · PLA Black: 22 g');
    await act(async () => button('Save measurements', card()).click());
    expect(review).toHaveBeenCalledWith('order-1', 0, {
      printMinutes: 75, filaments: [{ key: 'model', grams: 25 }], sliced: { printMinutes: 70, filaments: [{ key: 'model', grams: 22 }], slicedAt: expect.any(String) },
    });
    expect(container.textContent).toContain("Price from the shop's measurements: $16.50");
    expect(card().textContent).toContain('$5.75 a copy');
    await act(async () => button('Use the measured price').click());
    expect($<HTMLInputElement>('input[placeholder="Not quoted"]')!.value).toBe('16.5');
    await act(async () => button("Use the customer's estimate").click());
    expect($<HTMLInputElement>('input[placeholder="Not quoted"]')!.value).toBe('12.2');
  });
});

describe('external projects', () => {
  it('shows the project, chosen files, wishes and customer', async () => {
    await openOrder(projectOrder());
    expect($('h1')?.textContent).toContain('PJ-261106-K7QX');
    expect($('.project-summary__title')?.textContent).toBe('Self-watering planter');
    const link = $<HTMLAnchorElement>('.project-summary a[target="_blank"]')!;
    expect(link.href).toBe('https://www.printables.com/model/12345-self-watering-planter');
    expect(link.rel).toBe('noopener noreferrer');
    expect(container.textContent).toContain('License: CC BY 4.0');
    const items = [...container.querySelectorAll('.project-item')];
    expect(items.map((item) => item.querySelector('.project-item__file')?.textContent)).toEqual(['planter.stl20 kB', 'saucer.stl2 MB']);
    expect(items[0].querySelector('.project-preferences')?.textContent).toContain('Quantity2');
    expect(items[0].querySelector('.project-preferences')?.textContent).toContain('Scale120%');
    expect([...items[0].querySelectorAll('.project-filaments li')].map((li) => li.textContent)).toEqual(['PETG · matte black', 'TPU (flexible) · any color']);
    expect($('.order-detail__note')?.textContent).toBe('Print the saucer first.');
    expect($('[role="alert"]')).toBeNull();
  });

  it('warns when the project could not be verified', async () => {
    await openOrder(projectOrder({ customerNote: '', project: { ...project, verified: false, license: null } }));
    expect($('[role="alert"]')?.textContent).toContain('could not be fetched from Printables');
    expect(container.textContent).toContain('No note.');
    expect(container.textContent).not.toContain('License:');
  });

  it('downloads the chosen models from the project site only when asked, one by one or all in a ZIP with what to print', async () => {
    const unavailable = new ApiError(502, 'Could not download saucer.stl from Printables. Try again later, or download it from the project page.', ['HTTP 500']);
    const failing: Record<string, ApiError> = { 10: unavailable };
    const downloads = servesProjectFiles(failing);
    const saved = captureDownloads();
    await openOrder(projectOrder());
    const files = () => $<HTMLElement>('.order-print-files')!;
    const row = (name: string) => [...files().querySelectorAll<HTMLElement>('.print-files__file')].find((li) => li.textContent?.includes(name))!;
    expect(files().textContent).toContain('They are downloaded from Printables when you save or slice them; the shop keeps no copies.');
    expect(row('planter.stl').textContent).toContain('2 copies · scale 120% · PETG matte black + TPU (flexible)');
    expect(row('saucer.stl').textContent).toContain('1 copy · scale 100% · PLA white');
    // Nothing is downloaded until the admin asks.
    expect(downloads).not.toHaveBeenCalled();

    await act(async () => button('Download', row('planter.stl')).click());
    await until(() => saved.length === 1, 'the download');
    expect(downloads).toHaveBeenCalledWith('po-1', '9');
    expect(saved[0].name).toBe('PJ-261106-K7QX-planter.stl');
    expect(row('planter.stl').textContent).toContain('STL');

    await act(async () => button('Download', row('saucer.stl')).click());
    await until(() => !!row('saucer.stl').querySelector('.print-files__error'), 'the failed download');
    expect(row('saucer.stl').textContent).toContain('Could not download saucer.stl from Printables. Try again later, or download it from the project page. (HTTP 500)');
    expect(row('saucer.stl').querySelector<HTMLAnchorElement>('a')?.href).toBe(project.url);
    // It works the second time.
    delete failing[10];
    await act(async () => button('Try again', row('saucer.stl')).click());
    await until(() => saved.length === 2, 'the second try');
    expect(saved[1].name).toBe('PJ-261106-K7QX-saucer.stl');
    expect(row('saucer.stl').querySelector('.print-files__error')).toBeNull();

    await act(async () => button('Download all (.zip)', files()).click());
    await until(() => saved.length === 3, 'the archive');
    // Files downloaded on this page are reused for the archive.
    expect(downloads.mock.calls).toEqual([['po-1', '9'], ['po-1', '10'], ['po-1', '10']]);
    expect(saved[2].name).toBe('PJ-261106-K7QX-models.zip');
    const zip = unzipSync(new Uint8Array(await readFileBytes(saved[2].blob)));
    expect(Object.keys(zip).sort()).toEqual(['planter.stl', 'print-list.txt', 'saucer.stl']);
    expect(zip['planter.stl'].length).toBe(STL.length);
    expect(strFromU8(zip['print-list.txt'])).toBe([
      'Order PJ-261106-K7QX', `Self-watering planter — ${project.url}`, '',
      'planter.stl: 2 copies · scale 120% · PETG matte black + TPU (flexible)', 'saucer.stl: 1 copy · scale 100% · PLA white', '',
    ].join('\r\n'));
  });

  it('measures every model by material — sliced from the fetched files or by hand — and offers it as a product once measured', async () => {
    const measured = (index: number, input: { printMinutes: number; filaments: { key: string; grams: number }[] }, current: Order): Order => {
      const review = {
        printMinutes: input.printMinutes, hourlyRate: 3, printTimeCost: 3.5, filamentCost: 1.2, unitPrice: 4.7, reviewedAt: '2026-11-07T10:00:00.000Z',
        filaments: input.filaments.map(({ key, grams }) => ({ key, label: key, grams, pricePerKg: 30, cost: 1.2 })),
      };
      const items = current.items.map((item, i): OrderItem => (i === index ? { ...item, review } : item));
      return { ...current, items, price: { ...current.price, reviewed: items.every((item) => item.review) ? 19.4 : null } };
    };
    serveFiles();
    let current = projectOrder();
    const downloads = servesProjectFiles({ 10: new ApiError(503, "Printables is not available on this server, so the shop can't fetch its files.") });
    const save = vi.spyOn(api, 'reviewOrderItem').mockImplementation(async (_id, index, input) => (current = measured(index, input, current)));
    await openOrder(current);
    const card = (name: string) => $<HTMLElement>(`[aria-label="Measurements of ${name}"]`)!;
    expect(card('planter.stl').textContent).toContain("The model from Printables, at the customer's scale, sliced with the settings you choose for the customer's wishes.");
    expect(container.textContent).toContain('Measure every model first: the product keeps their print time and filament.');
    // No downloading and choosing by hand: the file is downloaded from the site when sliced.
    expect(card('planter.stl').textContent).toContain('Downloaded from Printables when you slice.');
    expect(card('planter.stl').querySelector('input[type="file"]')).toBeNull();
    expect(downloads).not.toHaveBeenCalled();
    // The admin chooses the presets; a printer comes with its default process and filament (of the customer's material when there is one).
    const [printer, process, filament] = [...card('planter.stl').querySelectorAll<HTMLSelectElement>('.item-slicing__presets select')];
    expect([printer.value, process.value, filament.value]).toEqual([U1.printer, U1.process, U1.filament]);
    await act(async () => button('Slice', card('planter.stl')).click());
    await until(() => !!byLabel('Print time of planter.stl in minutes'), 'the slicing result');
    expect(slices).toEqual([{ name: 'planter.stl', settings: expect.objectContaining({ printer: U1.printer, filament: U1.filament, scale: 1.2, plate: 1, support: 'off' }) }]);
    expect(downloads).toHaveBeenCalledWith('po-1', '9');
    expect(card('planter.stl').textContent).toContain('Downloaded from Printables.');
    // Grams go to the preset's material.
    expect(byLabel<HTMLSelectElement>('Material 1').value).toBe('PLA');
    await act(async () => type(byLabel<HTMLSelectElement>('Material 1'), 'PETG'));
    await act(async () => button('Save measurements', card('planter.stl')).click());
    expect(save).toHaveBeenLastCalledWith('po-1', 0, expect.objectContaining({ printMinutes: 70, filaments: [{ key: 'PETG', grams: 22 }] }));

    // A file the site doesn't deliver can still be chosen by hand.
    await act(async () => button('Slice', card('saucer.stl')).click());
    await until(() => card('saucer.stl').textContent!.includes("Could not slice saucer.stl: Printables is not available on this server"), 'the failed download');
    expect(byLabel('Model file of saucer.stl')).toBeTruthy();

    // The saucer by hand: PLA rows, another material added.
    await act(async () => button('Enter by hand', card('saucer.stl')).click());
    await act(async () => {
      type(byLabel('Print time of saucer.stl in minutes'), '40');
      type(byLabel('Grams of PLA for saucer.stl'), '30');
    });
    await act(async () => button('+ Add material', card('saucer.stl')).click());
    await act(async () => type(byLabel('Grams of PETG for saucer.stl'), '5'));
    // 40 min ($2.00) + 30 g PLA ($0.60) + 5 g PETG ($0.15)
    expect(card('saucer.stl').textContent).toContain('$2.75 a copy');
    await act(async () => button('Save measurements', card('saucer.stl')).click());
    expect(save).toHaveBeenLastCalledWith('po-1', 1, { printMinutes: 40, filaments: [{ key: 'PLA', grams: 30 }, { key: 'PETG', grams: 5 }] });
    expect(container.textContent).toContain("Price from the shop's measurements: $19.40");

    const created = { id: 'pp-1', title: 'Planter kit', pricing: { total: 19.4 } } as unknown as ProjectProduct;
    const create = vi.spyOn(api, 'createProjectProduct').mockResolvedValue(created);
    const title = [...container.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent === 'Title')!.querySelector('input')!;
    expect(title.value).toBe('Self-watering planter');
    await act(async () => type(title, ' Planter kit '));
    await act(async () => button('Create product').click());
    expect(create).toHaveBeenCalledWith({ orderId: 'po-1', title: 'Planter kit', description: 'Keeps herbs alive.', published: true });
    expect(container.textContent).toContain('Created “Planter kit” for $19.40.');
  });
});

describe('Print on Demand and catalog orders', () => {
  it('slices a Print on Demand set from the product print file with the ordered variants at the ordered scale', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(STL, { headers: { 'Content-Type': 'application/octet-stream' } })));
    const product = vi.spyOn(api, 'getProjectProduct').mockResolvedValue({
      id: 'pp-1', mesh: { url: '/api/model-files/cccccccccccccccccccccccc', fileName: 'planter.3mf', selectedPlates: [1, 2] },
    } as unknown as ProjectProduct);
    await openOrder(podOrder());
    expect($('.banner--info')?.textContent).toContain('Ordered from the Print on Demand product Planter kit (2 × $6.55 set price');
    expect(container.textContent).toContain('Scale of the whole set: 120%');
    const card = () => $<HTMLElement>('[aria-label="Measurements of Planter kit"]')!;
    expect($('.order-measurements')?.textContent).toContain('The price was fixed when the customer ordered.');
    expect(product).toHaveBeenCalledWith('pp-1');
    await until(() => !button('Slice', card()).disabled, 'the product');
    expect(card().textContent).toContain('Sliced with the print variants the customer chose, at the ordered scale.');
    expect([...card().querySelectorAll('.item-slicing__runs li')].map((li) => li.textContent)).toEqual([
      `Plate 1: ${U1.printer} · ${U1.process} · ${U1.filament} · With supports · Scale 120%`,
      `Plate 2: ${U1.printer} · ${U1.process} · ${U1.filament} · Without supports · Scale 120%`,
    ]);
    await act(async () => button('Slice', card()).click());
    await until(() => !!byLabel('Print time of Planter kit in minutes'), 'the slicing result');
    expect(slices.map(({ name, settings }) => [name, settings.plate, settings.scale, settings.support, settings.overrides])).toEqual([
      ['planter.3mf', 1, 1.2, 'on', { sparse_infill_density: '20%' }], ['planter.3mf', 2, 1.2, 'off', {}],
    ]);
    // Both plates print PETG: 2 × 70 min and 44 g of PETG.
    expect(byLabel('Print time of Planter kit in minutes').value).toBe('140');
    expect(byLabel<HTMLSelectElement>('Material 1').value).toBe('PETG');
    expect(byLabel('Grams of PETG for Planter kit').value).toBe('44');
  });

  it('slices every model of a Print on Demand set without a print file, with its copies per set and scale', async () => {
    serveFiles();
    vi.spyOn(api, 'getProjectProduct').mockResolvedValue({ id: 'pp-1', mesh: null } as unknown as ProjectProduct);
    const set = podOrder();
    const pod = set.items[0].model as Extract<OrderItem['model'], { source: 'printOnDemand' }>;
    const shown = podOrder({
      price: { mode: 'quote', handlingFee: 4.5, estimated: null, reviewed: null, total: null },
      items: [{
        ...set.items[0], unitPrice: null, lineTotal: null,
        model: {
          ...pod, print: undefined, materialsChanged: true,
          models: [
            { file: { id: '9', name: 'planter.stl', sizeBytes: null, thumbnailUrl: null }, settings: { quantity: 1, scalePercent: 120, filaments: [{ material: 'PETG', color: 'blue' }] } },
            { file: { id: '10', name: 'feet.stl', sizeBytes: null, thumbnailUrl: null }, settings: { quantity: 4, scalePercent: 100, filaments: [{ material: 'TPU', color: 'black' }] } },
          ],
        },
      }],
    });
    const downloads = servesProjectFiles({}, { 9: 'planter.stl', 10: 'feet.stl' });
    await openOrder(shown);
    const card = () => $<HTMLElement>('[aria-label="Measurements of Planter kit"]')!;
    await until(() => !button('Slice', card()).disabled, 'the product');
    expect(card().textContent!.split('Downloaded from Printables when you slice.')).toHaveLength(3);
    expect(card().textContent).toContain("Every model of one set, with its copies and scale, sliced with the settings you choose for the customer's materials.");
    // Each model gets its own filament preset; one printer, process and supports for the set.
    const filamentOf = (name: string) => $<HTMLSelectElement>('select', [...card().querySelectorAll('label')].find((l) => l.textContent?.startsWith(`Filament for ${name}`))!)!;
    expect([filamentOf('planter.stl').value, filamentOf('feet.stl').value]).toEqual([U1.filament, U1.filament]);
    expect(card().querySelectorAll('.item-slicing__presets select')).toHaveLength(2);
    await act(async () => button('Slice', card()).click());
    await until(() => !!byLabel('Print time of Planter kit in minutes'), 'the slicing result');
    expect(slices.map(({ name, settings }) => [name, settings.scale])).toEqual([['planter.stl', 1.2], ['feet.stl', 1]]);
    expect(downloads.mock.calls).toEqual([['pod-1', '9'], ['pod-1', '10']]);
    // One set: 70 min + 4 × 70 min, and 22 g + 4 × 22 g of the presets' material.
    expect(byLabel('Print time of Planter kit in minutes').value).toBe('350');
    expect(byLabel('Grams of PLA for Planter kit').value).toBe('110');
    // Both models and nothing else are the files for printing.
    expect([...$<HTMLElement>('.order-print-files')!.querySelectorAll('.print-files__file strong')].map((el) => el.textContent)).toEqual(['planter.stl', 'feet.stl']);
  });

  it('slices a catalog product from its 3D model with the chosen variants at the ordered size', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(STL, { headers: { 'Content-Type': 'application/octet-stream' } })));
    const vase = createSeedProducts()[0];
    catalog.products = [{ ...vase, id: 'vase', model: { widthMm: 100, depthMm: 100, heightMm: 100, volumeCm3: 12 } }];
    await openOrder(order({
      id: 'order-9', number: 'PF-261109-CATS', source: 'catalog',
      items: [{
        model: {
          source: 'catalog', productId: 'vase', productName: 'Vase', sizeLabel: '150 × 150 × 150 mm', colorName: 'White', colorHex: '#ffffff',
          customization: { colorId: 'white', partColors: {}, engravingText: '', engravingFont: 'Arial', engravingColorId: null, textureDataUrl: null, dimensions: { widthMm: 150, depthMm: 150, heightMm: 150 } },
          printVariant: variant, priceLines: [],
        },
        quantity: 1, unitPrice: 20, lineTotal: 20,
      }],
      price: { mode: 'fixed', handlingFee: 5, estimated: null, reviewed: null, total: 25 },
    }));
    const card = () => $<HTMLElement>('[aria-label="Measurements of Vase"]')!;
    expect(card().textContent).toContain('Sliced with the print variants the customer chose, at the ordered size.');
    expect(card().textContent).toContain('Scale 150%');
    await act(async () => button('Slice', card()).click());
    await until(() => !!byLabel('Print time of Vase in minutes'), 'the slicing result');
    expect(slices.map(({ settings }) => [settings.printer, settings.scale, settings.support])).toEqual([[U1.printer, 1.5, 'on']]);
  });
});
