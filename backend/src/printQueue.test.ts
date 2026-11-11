import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { formatMoment } from './domain/emailTemplates';
import type { Customization, Order, PrinterQueue, PrinterWithModel } from './domain/types';
import { seedProducts, type Storage } from './storage';
import { deleteAllOrders, deleteAllPrinters, openTestStorage } from './storage/testStorage';

const TOKEN = 'test-admin-token';
const admin = { Authorization: `Bearer ${TOKEN}` };
const NOW = new Date('2026-11-10T10:00:00.000Z');
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

let db: Storage;
let stop: (() => Promise<void>) | undefined;
let app: ReturnType<typeof createApp>;
const sent: { subject: string; text: string }[] = [];

beforeAll(async () => {
  ({ storage: db, stop } = await openTestStorage('print-queue'));
  app = createApp({
    db, adminToken: TOKEN,
    modelSearch: { search: vi.fn(), projectFromUrl: () => null, project: vi.fn(), downloadFile: vi.fn() },
    mailer: {
      transport: 'smtp', from: 'shop@example.com',
      async send(message) {
        sent.push({ subject: message.subject, text: message.text });
        return { delivery: 'sent', messageId: `<${sent.length}@example.com>` };
      },
    },
  });
}, 120_000);
afterAll(async () => {
  await stop?.();
});
beforeEach(async () => {
  // Only the clock is fixed: the server's estimates are then exact.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await deleteAllOrders(db);
  await deleteAllPrinters(db);
  await seedProducts(db, { reset: true });
  sent.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

const customer = { name: 'Anna Nowak', email: 'anna@example.com', address: { line1: 'Długa 1', city: 'Kraków', postalCode: '30-001', country: 'Poland' } };
const vase: Customization = {
  dimensions: { widthMm: 110, depthMm: 110, heightMm: 200 }, colorId: 'white', partColors: {},
  engravingText: '', engravingFont: 'Georgia', engravingColorId: null, textureDataUrl: null,
};
const placeOrder = async (quantity = 1) =>
  (await request(app).post('/api/orders').send({ customer, items: [{ productId: 'spiral-vase', customization: vase, quantity }] }).expect(201)).body as Order;
const patch = (order: Order, body: object) => request(app).patch(`/api/orders/${order.id}`).set(admin).send(body);
const queue = async (printer: PrinterWithModel) => (await request(app).get(`/api/printers/${printer.id}/queue`).set(admin).expect(200)).body as PrinterQueue;

async function printers() {
  const model = (await request(app).post('/api/printer-models').set(admin)
    .send({ name: 'Snapmaker U1', plate: { widthMm: 270, depthMm: 270, heightMm: 270 }, maxColors: 4 }).expect(201)).body;
  const create = async (name: string) => (await request(app).post('/api/printers').set(admin).send({ name, modelId: model.id }).expect(201)).body as PrinterWithModel;
  return [await create('U1-01'), await create('U1-02')];
}

describe('print queues', () => {
  it('queues orders on a printer one after another, an hour apart, and tells the customer when they print', async () => {
    const [u1] = await printers();
    const first = await placeOrder();
    expect((await patch(first, { status: 'queued' }).expect(400)).body.error).toBe('Choose the printer whose queue the order joins.');
    expect((await patch(first, { status: 'queued', queue: { printerId: u1.id } }).expect(400)).body.error)
      .toBe('Enter how long the order prints: not every item is measured.');
    await patch(first, { status: 'queued', queue: { printerId: 'missing', printMinutes: 10 } }).expect(400);
    await patch(first, { status: 'queued', queue: { printerId: u1.id, printMinutes: 0 } }).expect(400);
    expect((await patch(first, { status: 'paid', queue: { printerId: u1.id, printMinutes: 10 } }).expect(400)).body.error)
      .toBe('A printer can only be chosen when the order goes in the queue.');
    expect(first.printJob ?? null).toBeNull();

    // The preview already states the times; without a printer they are missing.
    const preview = (body: object) => request(app).post(`/api/orders/${first.id}/email-preview`).set(admin).send(body).expect(200);
    expect((await preview({ status: 'queued' })).body.missing).toEqual(['printStart', 'printDuration']);
    const previewed = (await preview({ status: 'queued', queue: { printerId: u1.id, printMinutes: 125 } })).body;
    expect(previewed.missing).toEqual([]);
    expect(previewed.body).toContain(`around ${formatMoment(NOW.getTime())}. Printing takes about 2 h 5 min, so it should be printed by ${formatMoment(Date.parse(at(125)))}.`);
    expect(await db.orders.get(first.id)).toMatchObject({ status: 'received' });

    const queued = (await patch(first, { status: 'queued', queue: { printerId: u1.id, printMinutes: 125 }, notify: true }).expect(200)).body as Order;
    expect(queued.printJob).toEqual({
      printerId: u1.id, printerName: 'U1-01', queuedAt: NOW.toISOString(), printMinutes: 125, startedAt: null, estimatedStart: NOW.toISOString(),
      previousStatus: 'received',
    });
    expect(sent.at(-1)?.subject).toBe(`Your order ${first.number} is in the print queue`);
    expect(sent.at(-1)?.text).toContain('Printing takes about 2 h 5 min');

    // A measured order prints as long as its measurements say (one copy × copies); it goes last, after the break.
    const second = await placeOrder(2);
    await request(app).put(`/api/orders/${second.id}/items/0/review`).set(admin).send({ printMinutes: 45, filaments: [{ key: 'PLA', grams: 30 }] }).expect(200);
    const next = (await patch(second, { status: 'queued', queue: { printerId: u1.id } }).expect(200)).body as Order;
    expect(next.printJob).toMatchObject({ printMinutes: 90, estimatedStart: at(185) });

    const { entries, gapMinutes, printer } = await queue(u1);
    expect(gapMinutes).toBe(60);
    expect(printer.queue).toEqual({ length: 2, nextStart: at(185 + 90 + 60) });
    expect(entries.map((entry) => [entry.position, entry.order.number, entry.order.status, entry.estimatedStart, entry.estimatedEnd])).toEqual([
      [1, first.number, 'queued', at(0), at(125)],
      [2, second.number, 'queued', at(185), at(275)],
    ]);
    expect(entries[1].order).toMatchObject({ customerName: 'Anna Nowak', models: '2 × Spiral Vase', source: 'catalog' });
    const listed = (await request(app).get('/api/printers').set(admin).expect(200)).body as PrinterWithModel[];
    expect(listed.map((p) => [p.name, p.queue.length])).toEqual([['U1-01', 2], ['U1-02', 0]]);
    await request(app).get(`/api/printers/${u1.id}/queue`).expect(401);
    await request(app).get('/api/printers/missing/queue').set(admin).expect(404);
  });

  it('prints one order at a time, finishes, removes and moves orders, and drops cancelled ones', async () => {
    const [u1, u2] = await printers();
    const [a, b, c] = [await placeOrder(), await placeOrder(), await placeOrder()];
    await patch(a, { status: 'paid' }).expect(200);
    for (const order of [a, b, c]) await patch(order, { status: 'queued', queue: { printerId: u1.id, printMinutes: 60 } }).expect(200);

    // The second order is printed first: it moves to the front, the others wait for it.
    vi.setSystemTime(new Date(at(10)));
    const printing = (await patch(b, { status: 'printing', notify: true }).expect(200)).body as Order;
    expect(printing.printJob).toMatchObject({ startedAt: at(10), printerName: 'U1-01' });
    expect(sent.at(-1)?.subject).toBe(`Your order ${b.number} is being printed`);
    expect((await patch(a, { status: 'printing' }).expect(409)).body.error)
      .toBe(`U1-01 is already printing order ${b.number}: mark it done or take it out of the queue first.`);
    expect((await queue(u1)).entries.map((entry) => [entry.order.number, entry.estimatedStart])).toEqual([
      [b.number, at(10)], [a.number, at(130)], [c.number, at(250)],
    ]);

    // Done: out of the queue; the next one starts now.
    const done = (await patch(b, { status: 'done', notify: true }).expect(200)).body as Order;
    expect(done.printJob).toBeNull();
    expect(sent.at(-1)?.subject).toBe(`Your order ${b.number} has been printed`);
    expect((await queue(u1)).entries.map((entry) => [entry.position, entry.order.number, entry.estimatedStart])).toEqual([[1, a.number, at(10)], [2, c.number, at(130)]]);

    // Taken out of the queue: back to the status before queueing, logged.
    await request(app).delete(`/api/orders/${a.id}/print-job`).expect(401);
    const removed = (await request(app).delete(`/api/orders/${a.id}/print-job`).set(admin).expect(200)).body as Order;
    expect(removed).toMatchObject({ status: 'paid', printJob: null });
    expect((await db.logBook.list(a.id))[0]).toMatchObject({ type: 'status', from: 'queued', to: 'paid' });
    expect((await request(app).delete(`/api/orders/${a.id}/print-job`).set(admin).expect(409)).body.error).toBe('The order is not in a print queue.');

    // Moved to another printer: the end of its queue, with the customer told the new times.
    const moved = (await patch(c, { status: 'queued', queue: { printerId: u2.id }, notify: true }).expect(200)).body as Order;
    expect(moved.printJob).toMatchObject({ printerId: u2.id, printerName: 'U1-02', printMinutes: 60, estimatedStart: at(10), previousStatus: 'received' });
    expect(sent.at(-1)?.subject).toBe(`Your order ${c.number} is in the print queue`);
    // The same printer again keeps its place.
    expect((await patch(c, { status: 'queued', queue: { printerId: u2.id }, adminNote: 'x' }).expect(200)).body.printJob.queuedAt).toBe(moved.printJob!.queuedAt);

    // A printer with orders in its queue can't be deleted.
    const refused = await request(app).delete(`/api/printers/${u2.id}`).set(admin).expect(409);
    expect(refused.body).toEqual({
      error: "Orders are still in this printer's queue (1): take them out or move them to another printer first.", details: [c.number],
    });

    // Cancelling (or rejecting) an order takes it out of its queue.
    const cancelled = (await patch(c, { status: 'cancelled', notify: true, note: 'Changed my mind' }).expect(200)).body as Order;
    expect(cancelled.printJob).toBeNull();
    expect((await queue(u2)).entries).toEqual([]);
    await request(app).delete(`/api/printers/${u2.id}`).set(admin).expect(204);
    expect((await queue(u1)).entries).toEqual([]);
  });
});
