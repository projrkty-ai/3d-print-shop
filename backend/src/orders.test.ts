import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { createSeedProducts } from './domain/data/seedProducts';
import type { Customization, Order, OrderSource, ProjectProduct } from './domain/types';
import type { ModelSearch } from './modelSearch';
import { seedPrintSettings, seedProducts, type Storage } from './storage';
import { deleteAllOrders, openTestStorage } from './storage/testStorage';

const TOKEN = 'test-admin-token';
const admin = { Authorization: `Bearer ${TOKEN}` };
const STL = readFileSync(new URL('../public/models/twisted-star-vase.stl', import.meta.url));
const rates = { hourlyRate: 3, handlingFee: 4.5, filamentPricePerKg: { PLA: 20, PETG: 30, ABS: 25, ASA: 35, TPU: 50, resin: 60 } };

let db: Storage;
let stop: (() => Promise<void>) | undefined;
let app: ReturnType<typeof createApp>;
const sent: { to: string; subject: string; text: string }[] = [];
const project = vi.fn<ModelSearch['project']>();

beforeAll(async () => {
  ({ storage: db, stop } = await openTestStorage('orders'));
  app = createApp({
    db, adminToken: TOKEN,
    modelSearch: { search: vi.fn(), projectFromUrl: () => null, project, downloadFile: vi.fn() },
    mailer: {
      transport: 'smtp', from: 'shop@example.com',
      async send(message) {
        sent.push({ to: message.to.address, subject: message.subject, text: message.text });
        return { delivery: 'sent', messageId: `<${sent.length}@example.com>` };
      },
    },
  });
}, 120_000);
afterAll(async () => {
  await stop?.();
});
beforeEach(async () => {
  await deleteAllOrders(db);
  await seedProducts(db, { reset: true });
  await seedPrintSettings(db, { reset: true });
  await db.settings.putPricing({ ...rates, updatedAt: null });
  sent.length = 0;
  project.mockRejectedValue(new Error('offline'));
});

const customer = {
  name: 'Anna Nowak', email: 'anna@example.com',
  address: { line1: 'Długa 1', city: 'Kraków', postalCode: '30-001', country: 'Poland' },
};
const vase: Customization = {
  dimensions: { widthMm: 110, depthMm: 110, heightMm: 200 }, colorId: 'white', partColors: {},
  engravingText: '', engravingFont: 'Georgia', engravingColorId: null, textureDataUrl: null,
};
const printable: ProjectProduct = {
  id: 'planter-set', title: 'Planter set', description: '', published: true,
  project: { source: 'printables', id: '12345', title: 'Planter', description: '', thumbnailUrl: null, url: 'https://www.printables.com/model/12345', author: null, license: null },
  items: [{ file: { id: '9', name: 'planter.stl', sizeBytes: null, thumbnailUrl: null }, settings: { quantity: 1, scalePercent: 100, filaments: [{ material: 'PLA', color: 'green' }] } }],
  measurements: { printMinutes: 60, filaments: [{ material: 'PLA', grams: 100 }] },
  sourceOrder: { id: 'x', number: 'PJ-1' },
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
};

/** Places one order of every source, as the storefront does. */
async function placeEach(): Promise<Record<OrderSource, Order>> {
  const place = async (body: object) => (await request(app).post('/api/orders').send({ customer, ...body }).expect(201)).body as Order;
  const upload = (await request(app).post('/api/uploads').set('Content-Type', 'application/octet-stream').set('X-File-Name', 'vase.stl').send(STL).expect(201)).body;
  await db.projectProducts.insert(printable);
  return {
    // Without `source`, as older storefronts check out.
    catalog: await place({ items: [{ productId: 'spiral-vase', customization: vase, quantity: 2 }] }),
    upload: await place({
      source: 'upload',
      items: [{ fileId: upload.fileId, uploadKey: upload.uploadKey, quantity: 1, nozzleId: 'nozzle-0-4', layerHeightId: 'layer-0-2', parts: [{ key: 'model', name: 'Model', filamentId: 'pla', colorId: 'black' }] }],
    }),
    project: await place({
      source: 'project',
      project: { source: 'printables', id: '12345', title: 'Planter', url: 'https://www.printables.com/model/12345', thumbnailUrl: null, author: null },
      items: [{ file: { id: '9', name: 'planter.stl' }, settings: { quantity: 3, scalePercent: 100, filaments: [{ material: 'PETG', color: 'red' }] } }],
      sameSettingsForAll: true,
    }),
    printOnDemand: await place({ source: 'printOnDemand', productId: printable.id, sets: 2 }),
  };
}

describe('orders of every source', () => {
  it('are placed alike: received, numbered by source, with a log book, and a fixed price or a quote to come', async () => {
    const orders = await placeEach();
    for (const [source, order] of Object.entries(orders)) {
      expect(order, source).toMatchObject({ source, status: 'received', customer, customerNote: '', adminNote: '', currency: 'USD' });
      expect(await db.logBook.list(order.id), source).toEqual([expect.objectContaining({ type: 'status', from: null, to: 'received' })]);
    }
    expect(Object.values(orders).map((order) => order.number.slice(0, 2))).toEqual(['PF', 'CP', 'PJ', 'PJ']);
    // Catalog products and Print on Demand as offered have a price; uploads and projects are quoted.
    expect(Object.values(orders).map((order) => [order.price.mode, order.price.total])).toEqual([
      ['fixed', orders.catalog.price.total], ['quote', null], ['quote', null], ['fixed', 4.5 + 2 * (3 + 2)],
    ]);
    expect(orders.catalog.price.total).toBeGreaterThan(0);
    expect(orders.catalog.items[0]).toMatchObject({ model: { source: 'catalog', productId: 'spiral-vase' }, quantity: 2 });
  });

  it('are listed together, newest first, filtered by status and source, for admins only', async () => {
    const orders = await placeEach();
    await request(app).get('/api/orders').expect(401);
    await request(app).get(`/api/orders/${orders.upload.id}`).expect(401);
    const all = (await request(app).get('/api/orders').set(admin).expect(200)).body as Order[];
    expect(all.map((order) => order.source)).toEqual(['printOnDemand', 'project', 'upload', 'catalog']);
    expect((await request(app).get('/api/orders?source=upload').set(admin).expect(200)).body.map((o: Order) => o.id)).toEqual([orders.upload.id]);
    expect((await request(app).get('/api/orders?limit=1').set(admin).expect(200)).body).toHaveLength(1);
    await request(app).patch(`/api/orders/${orders.project.id}`).set(admin).send({ status: 'rejected', adminNote: 'No file' }).expect(200);
    expect((await request(app).get('/api/orders?status=rejected').set(admin).expect(200)).body.map((o: Order) => o.id)).toEqual([orders.project.id]);
    expect((await request(app).get('/api/orders?status=received&source=project').set(admin).expect(200)).body).toEqual([]);
    expect((await request(app).get('/api/orders?status=bogus').set(admin).expect(400)).body.error).toContain('Unknown status');
    await request(app).get('/api/orders?source=bogus').set(admin).expect(400);
    expect((await request(app).get(`/api/orders/${orders.catalog.id}`).set(admin).expect(200)).body).toEqual(orders.catalog);
    await request(app).get('/api/orders/missing').set(admin).expect(404);
  });

  it('go through the same statuses, each change logged and optionally emailed with its template', async () => {
    const orders = await placeEach();
    for (const order of Object.values(orders)) {
      const path = `/api/orders/${order.id}`;
      if (order.price.mode === 'quote') {
        // Only orders with a price can be quoted.
        expect((await request(app).patch(path).set(admin).send({ status: 'quoted' }).expect(400)).body.error)
          .toBe('Set the price before marking the order as quoted.');
        await request(app).patch(path).set(admin).send({ status: 'quoted', price: 19.999, notify: true }).expect(200);
      }
      for (const status of ['paid', 'printing', 'shipped', 'delivered'] as const) {
        await request(app).patch(path).set(admin).send({ status, notify: status === 'shipped', note: status === 'shipped' ? 'Tracking 123' : undefined }).expect(200);
      }
      const saved = (await request(app).get(path).set(admin).expect(200)).body as Order;
      expect(saved.status, order.source).toBe('delivered');
      const log = await db.logBook.list(order.id);
      expect(log.filter((entry) => entry.type === 'status').map((entry) => entry.type === 'status' && entry.to).reverse(), order.source)
        .toEqual(['received', ...(order.price.mode === 'quote' ? ['quoted'] : []), 'paid', 'printing', 'shipped', 'delivered']);
    }
    // The same template for every source: the quote states the price, the shipping email the note.
    expect(sent.filter((mail) => mail.subject.startsWith('Your price for order')).map((mail) => mail.text.includes('Price: $20.00'))).toEqual([true, true]);
    const shipped = sent.filter((mail) => mail.subject.includes('has shipped'));
    expect(shipped.map((mail) => mail.subject)).toEqual(Object.values(orders).map((order) => `Your order ${order.number} has shipped`));
    expect(shipped.every((mail) => mail.text.includes('Tracking 123'))).toBe(true);
  });

  it('keep a fixed price, and let the shop set, change and withdraw a quote', async () => {
    const orders = await placeEach();
    for (const order of [orders.catalog, orders.printOnDemand]) {
      expect((await request(app).patch(`/api/orders/${order.id}`).set(admin).send({ price: 1 }).expect(409)).body.error)
        .toBe('This order was placed at a fixed price, which cannot change. Only orders that need a quote can be priced.');
      // Sending the unchanged price with other changes is fine.
      await request(app).patch(`/api/orders/${order.id}`).set(admin).send({ price: order.price.total, adminNote: 'ok' }).expect(200);
    }
    const path = `/api/orders/${orders.upload.id}`;
    expect((await request(app).patch(path).set(admin).send({ price: 24.999, adminNote: 'Needs supports' }).expect(200)).body)
      .toMatchObject({ status: 'received', adminNote: 'Needs supports', price: { mode: 'quote', total: 25 } });
    expect((await request(app).patch(path).set(admin).send({ price: null }).expect(200)).body.price.total).toBeNull();
    for (const body of [{}, { price: -1 }, { price: '12' }, { status: 'approved' }, { items: [] }, { status: 'received', notify: 'yes' }]) {
      await request(app).patch(path).set(admin).send(body).expect(400);
    }
    await request(app).patch('/api/orders/missing').set(admin).send({ status: 'rejected' }).expect(404);
    await request(app).patch(path).send({ status: 'rejected' }).expect(401);
  });

  it('are measured alike, item by item; a fixed price stays, a quote order gets the measured price', async () => {
    const orders = await placeEach();
    // Catalog items are measured by material, like projects.
    const catalog = (await request(app).put(`/api/orders/${orders.catalog.id}/items/0/review`).set(admin)
      .send({ printMinutes: 120, filaments: [{ key: 'PLA', grams: 200 }] }).expect(200)).body as Order;
    expect(catalog.items[0].review).toMatchObject({ unitPrice: 6 + 4, filaments: [{ key: 'PLA', label: 'PLA', pricePerKg: 20 }] });
    expect(catalog.price).toMatchObject({ mode: 'fixed', reviewed: orders.catalog.price.handlingFee + 2 * 10, total: orders.catalog.price.total });
    // An uploaded model with parts is measured by its parts.
    await request(app).put(`/api/orders/${orders.upload.id}/items/0/review`).set(admin).send({ printMinutes: 60, filaments: [{ key: 'PLA', grams: 10 }] }).expect(400);
    const upload = (await request(app).put(`/api/orders/${orders.upload.id}/items/0/review`).set(admin)
      .send({ printMinutes: 60, filaments: [{ key: 'model', grams: 100 }] }).expect(200)).body as Order;
    expect(upload.price).toMatchObject({ mode: 'quote', reviewed: 4.5 + 3 + 8, total: null });
    await request(app).put(`/api/orders/${orders.upload.id}/items/1/review`).set(admin).send({ printMinutes: 60, filaments: [{ key: 'model', grams: 1 }] }).expect(404);
  });

  it('are deleted with their log book, and uploaded files with the order', async () => {
    const orders = await placeEach();
    const fileId = orders.upload.items[0].model.source === 'upload' ? orders.upload.items[0].model.fileId : '';
    for (const order of Object.values(orders)) {
      await request(app).delete(`/api/orders/${order.id}`).expect(401);
      await request(app).delete(`/api/orders/${order.id}`).set(admin).expect(204);
      await request(app).delete(`/api/orders/${order.id}`).set(admin).expect(404);
      expect(await db.logBook.list(order.id)).toEqual([]);
    }
    expect(await db.customerFiles.find(fileId)).toBeNull();
    expect(await db.orders.list({ limit: 10 })).toEqual([]);
  });

  it('keep customer data and shop notes apart, and reject unknown sources', async () => {
    const order = (await request(app).post('/api/orders').send({
      customer, customerNote: '  Gift  ', items: [{ productId: 'spiral-vase', customization: vase, quantity: 1 }],
    }).expect(201)).body as Order;
    expect(order.customerNote).toBe('Gift');
    await request(app).post('/api/orders').send({ customer, source: 'fax', items: [] }).expect(400);
    await request(app).post('/api/orders').send({ customer, source: 'catalog', items: [] }).expect(400);
    expect(createSeedProducts().some((product) => product.id === 'spiral-vase')).toBe(true);
  });
});
