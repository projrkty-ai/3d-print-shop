// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../api/client';
import type { Order, Printer, PrinterQueue, QueueEntry } from '../../types';
import { AdminPrinterQueuePage } from './AdminPrinterQueuePage';

const auth = vi.hoisted(() => ({ signOut: () => undefined }));
vi.mock('../../store/AdminAuthContext', () => ({ useAdminAuth: () => auth }));

const printer = {
  id: 'p1', name: 'U1-01', modelId: 'u1', location: 'Room 2, rack B', notes: '', createdAt: '', updatedAt: '',
  model: { id: 'u1', name: 'Snapmaker U1', plate: { widthMm: 270, depthMm: 270, heightMm: 270 } },
  queue: { length: 2, nextStart: '2026-11-10T17:30:00.000Z' },
} as unknown as Printer;
const entry = (position: number, number: string, startedAt: string | null, start: string, end: string): QueueEntry => ({
  position,
  order: { id: `o-${number}`, number, status: startedAt ? 'printing' : 'queued', source: 'catalog', createdAt: '', customerName: 'Anna Nowak', models: '2 × Spiral Vase' },
  printJob: {
    printerId: 'p1', printerName: 'U1-01', queuedAt: '2026-11-10T09:00:00.000Z', printMinutes: 90, startedAt, estimatedStart: start, previousStatus: 'paid',
  },
  estimatedStart: start,
  estimatedEnd: end,
});
const queue = (entries: QueueEntry[]): PrinterQueue => ({ printer, entries, gapMinutes: 60 });

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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

const $$ = <T extends Element = HTMLElement>(selector: string) => [...container.querySelectorAll<T>(selector)];
const button = (text: string, within: ParentNode = container) => [...within.querySelectorAll('button')].find((b) => b.textContent === text)!;
const rows = () => $$('tbody tr');
const render = () => act(async () => root.render(
  <MemoryRouter initialEntries={['/admin/printers/p1']}>
    <Routes><Route path="/admin/printers/:printerId" element={<AdminPrinterQueuePage />} /></Routes>
  </MemoryRouter>,
));

describe("a printer's queue", () => {
  it('lists the orders with estimated times, and starts, finishes and removes them', async () => {
    const printing = entry(1, 'PF-1', '2026-11-10T09:30:00.000Z', '2026-11-10T09:30:00.000Z', '2026-11-10T11:00:00.000Z');
    const waiting = entry(2, 'PF-2', null, '2026-11-10T12:00:00.000Z', '2026-11-10T13:30:00.000Z');
    const load = vi.spyOn(api, 'getPrinterQueue').mockResolvedValue(queue([printing, waiting]));
    const update = vi.spyOn(api, 'updateOrder').mockResolvedValue({} as Order);
    const remove = vi.spyOn(api, 'removeFromQueue').mockResolvedValue({} as Order);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await render();
    expect(load).toHaveBeenCalledWith('p1');
    expect(container.querySelector('h1')?.textContent).toBe('Queue of U1-01');
    expect(container.textContent).toContain('Snapmaker U1, 270 × 270 × 270 mm · Room 2, rack B');
    expect(container.textContent).toContain('Estimates add a break of 1 h between prints.');
    const [first, second] = rows();
    expect(first.className).toBe('printer-queue__printing');
    expect([...second.querySelectorAll('td')].slice(0, 6).map((cell) => cell.textContent)).toEqual([
      '2', 'PF-2Catalog', 'Anna Nowak', '2 × Spiral Vase', 'In queue', '1 h 30 min',
    ]);
    expect(second.querySelector('a')?.getAttribute('href')).toBe('/admin/orders/o-PF-2');
    // One print at a time: the waiting order can't start while another prints.
    expect(button('Start printing', first)).toBeUndefined();
    expect(button('Start printing', second).disabled).toBe(true);

    await act(async () => button('Done', first).click());
    expect(update).toHaveBeenCalledWith('o-PF-1', { status: 'done', notify: true });
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Order PF-1: Done.');

    load.mockResolvedValue(queue([{ ...waiting, position: 1 }]));
    await act(async () => container.querySelector<HTMLInputElement>('.printer-queue__notify input')!.click());
    await act(async () => button('Done', rows()[0]).click());
    load.mockResolvedValue(queue([{ ...waiting, position: 1 }]));
    await act(async () => button('Start printing', rows()[0]).click());
    expect(update).toHaveBeenLastCalledWith('o-PF-2', { status: 'printing', notify: false });

    await act(async () => button('Remove from queue', rows()[0]).click());
    expect(window.confirm).toHaveBeenCalledWith('Take order PF-2 out of the queue? It goes back to Paid.');
    expect(remove).toHaveBeenCalledWith('o-PF-2', { notify: false });
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Order PF-2 left the queue (Paid).');
  });

  it('reports refused changes and shows an empty queue', async () => {
    vi.spyOn(api, 'getPrinterQueue').mockResolvedValue(queue([entry(1, 'PF-3', null, '2026-11-10T10:00:00.000Z', '2026-11-10T11:30:00.000Z')]));
    vi.spyOn(api, 'updateOrder').mockRejectedValue(new ApiError(409, 'U1-01 is already printing order PF-9: mark it done or take it out of the queue first.'));
    await render();
    await act(async () => button('Start printing', rows()[0]).click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('PF-3: U1-01 is already printing order PF-9: mark it done or take it out of the queue first.');

    vi.mocked(api.getPrinterQueue).mockResolvedValue(queue([]));
    await act(async () => button('Refresh').click());
    expect(rows()[0].textContent).toBe('No orders in this queue. Orders join it when you set their status to “In queue” on the order page.');
  });
});
