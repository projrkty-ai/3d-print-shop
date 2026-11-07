import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import type { ProjectOrderInput } from './domain/types';
import { SourceUnavailableError, type ModelSearch, type ProjectDetails } from './modelSearch';
import type { Storage } from './storage';
import { deleteAllOrders, openTestStorage } from './storage/testStorage';

const TOKEN = 'test-admin-token';
const admin = { Authorization: `Bearer ${TOKEN}` };

let db: Storage;
let stop: (() => Promise<void>) | undefined;
let app: ReturnType<typeof createApp>;
const project = vi.fn<ModelSearch['project']>();

const details: ProjectDetails = {
  project: {
    source: 'printables', id: '12345', title: 'Self-watering planter', description: 'Verified description', license: 'CC BY 4.0',
    thumbnailUrl: 'https://media.printables.com/cover.jpg', url: 'https://www.printables.com/model/12345-self-watering-planter', author: 'Prusa',
  },
  files: [
    { id: '9', name: 'planter.stl', sizeBytes: 4096, thumbnailUrl: 'https://media.printables.com/9.png' },
    { id: '10', name: 'saucer.stl', sizeBytes: 2048, thumbnailUrl: null },
  ],
  filesAvailable: true,
};

beforeAll(async () => {
  ({ storage: db, stop } = await openTestStorage('project-orders'));
  app = createApp({ db, adminToken: TOKEN, modelSearch: { search: vi.fn(), projectFromUrl: () => null, project } });
}, 120_000);
afterAll(async () => {
  await stop?.();
});
beforeEach(async () => {
  await deleteAllOrders(db);
  project.mockReset();
  project.mockResolvedValue(details);
});

const input = (): ProjectOrderInput => ({
  customer: {
    name: 'Anna Nowak', email: 'anna@example.com', phone: '+48 600 000 000',
    address: { line1: 'Długa 1', city: 'Kraków', postalCode: '30-001', country: 'Poland' },
  },
  project: {
    source: 'printables', id: '12345', title: 'Customer copy of the title', thumbnailUrl: null,
    url: 'https://www.printables.com/model/12345-self-watering-planter', author: 'Prusa',
  },
  items: [
    { file: { id: '10', name: 'saucer.stl' }, settings: { quantity: 1, scalePercent: 100, filaments: [{ material: 'PLA', color: 'white' }] } },
    {
      file: { id: '9', name: 'customer-named.stl' },
      settings: { quantity: 2, scalePercent: 120, filaments: [{ material: 'PETG', color: 'matte black' }, { material: 'TPU', color: 'red' }] },
    },
  ],
  sameSettingsForAll: false,
  notes: 'Please print the saucer first.',
});
const sameSettings = { quantity: 2, scalePercent: 100, filaments: [{ material: 'PLA' as const, color: '' }] };

describe('project orders', () => {
  it('lets a customer order a project, storing the verified project and chosen files', async () => {
    const response = await request(app).post('/api/project-orders').send(input()).expect(201);
    expect(response.headers.location).toBe(`/api/project-orders/${response.body.id}`);
    expect(response.body).toMatchObject({
      number: expect.stringMatching(/^PJ-\d{6}-[A-Z2-9]{4}$/),
      status: 'new',
      projectVerified: true,
      project: details.project,
      items: [
        { file: details.files[1], settings: input().items[0].settings },
        { file: details.files[0], settings: input().items[1].settings },
      ],
      sameSettingsForAll: false,
      notes: 'Please print the saucer first.',
      customer: { name: 'Anna Nowak', address: { city: 'Kraków' } },
      adminNote: '',
    });
    expect(project).toHaveBeenCalledWith({ source: 'printables', id: '12345' });
    expect(await db.projectOrders.get(response.body.id)).toEqual(response.body);
  });

  it("keeps the customer's copy, marked unverified, when the site cannot be reached", async () => {
    project.mockRejectedValue(new Error('HTTP 503'));
    const response = await request(app).post('/api/project-orders').send(input()).expect(201);
    expect(response.body).toMatchObject({
      projectVerified: false,
      project: { ...input().project, description: '', license: null },
      items: [
        { file: { id: '10', name: 'saucer.stl', sizeBytes: null, thumbnailUrl: null }, settings: input().items[0].settings },
        { file: { id: '9', name: 'customer-named.stl', sizeBytes: null, thumbnailUrl: null }, settings: input().items[1].settings },
      ],
    });
    project.mockRejectedValue(new SourceUnavailableError('printables'));
    await request(app).post('/api/project-orders').send(input()).expect(201);
  });

  it('accepts one selection for all models and a whole-project item when the site lists no files', async () => {
    const same = await request(app).post('/api/project-orders').send({
      ...input(), sameSettingsForAll: true,
      items: input().items.map((item) => ({ ...item, settings: sameSettings })),
    }).expect(201);
    expect(same.body.sameSettingsForAll).toBe(true);
    expect(same.body.items.map((item: { settings: unknown }) => item.settings)).toEqual([sameSettings, sameSettings]);

    const whole = await request(app).post('/api/project-orders').send({ ...input(), items: [{ file: null, settings: sameSettings }] }).expect(201);
    expect(whole.body.items).toEqual([{ file: null, settings: sameSettings }]);
  });

  it('rejects invalid project orders', async () => {
    const cases: [Partial<ProjectOrderInput> | Record<string, unknown>, string][] = [
      [{ customer: { ...input().customer, email: 'nope' } }, 'customer.email: Enter a valid email address.'],
      [{ project: { ...input().project, url: 'https://evil.example/model/12345' } }, 'The project link must point to a model page on its own website.'],
      [{ project: { ...input().project, url: 'http://www.printables.com/model/12345' } }, 'Invalid request.'],
      [{ project: { ...input().project, source: 'cults3d' } }, 'Invalid request.'],
      [{ project: { ...input().project, id: '../12345' } }, 'Invalid request.'],
      [{ items: [] }, 'items: Choose at least one model to print.'],
      [{ items: [{ file: null, settings: sameSettings }, input().items[0]] }, 'items: The whole project can only be ordered on its own.'],
      [{ items: [input().items[0], input().items[0]] }, 'items: Each model can be listed only once.'],
      [{ sameSettingsForAll: true }, 'items: With one selection for all models, every model needs the same settings.'],
      [{ items: [{ ...input().items[0], settings: { ...sameSettings, filaments: [] } }] }, 'items.0.settings.filaments: Choose 1 to 8 materials or colors for each model.'],
      [{ items: [{ ...input().items[0], settings: { ...sameSettings, filaments: Array(9).fill({ material: 'PLA', color: '' }) } }] }, 'items.0.settings.filaments: Choose 1 to 8 materials or colors for each model.'],
      [{ items: [{ ...input().items[0], settings: { ...sameSettings, quantity: 0 } }] }, 'Invalid request.'],
      [{ items: [{ ...input().items[0], settings: { ...sameSettings, filaments: [{ material: 'wood', color: '' }] } }] }, 'Invalid request.'],
      [{ items: [{ ...input().items[0], settings: { ...sameSettings, scalePercent: 5 } }] }, 'Invalid request.'],
      [{ items: Array.from({ length: 201 }, (_, i) => ({ file: { id: String(i), name: 'f.stl' }, settings: sameSettings })) }, 'Invalid request.'],
    ];
    for (const [patch, error] of cases) {
      const response = await request(app).post('/api/project-orders').send({ ...input(), ...patch }).expect(400);
      expect([response.body.error, ...(response.body.details ?? [])], JSON.stringify(patch)).toContain(error);
    }
    expect(await db.projectOrders.list({ limit: 10 })).toEqual([]);
  });

  it('lets admins list, filter, review, update and delete project orders, and nobody else', async () => {
    const first = (await request(app).post('/api/project-orders').send(input()).expect(201)).body;
    const second = (await request(app).post('/api/project-orders').send({ ...input(), notes: 'Second' }).expect(201)).body;

    for (const path of ['/api/project-orders', `/api/project-orders/${first.id}`]) {
      await request(app).get(path).expect(401);
      await request(app).get(path).set('Authorization', 'Bearer wrong').expect(401);
    }
    await request(app).patch(`/api/project-orders/${first.id}`).send({ status: 'quoted' }).expect(401);
    await request(app).delete(`/api/project-orders/${first.id}`).expect(401);

    const list = await request(app).get('/api/project-orders').set(admin).expect(200);
    expect(list.body.map((order: { id: string }) => order.id)).toEqual([second.id, first.id]);
    expect((await request(app).get('/api/project-orders?status=unknown').set(admin).expect(400)).body.error).toContain('Unknown status');

    const updated = await request(app).patch(`/api/project-orders/${first.id}`).set(admin)
      .send({ status: 'quoted', adminNote: 'Quoted $42 by email' }).expect(200);
    expect(updated.body).toMatchObject({ status: 'quoted', adminNote: 'Quoted $42 by email' });
    expect(updated.body.updatedAt > first.updatedAt).toBe(true);
    expect((await request(app).get('/api/project-orders?status=quoted').set(admin).expect(200)).body.map((o: { id: string }) => o.id)).toEqual([first.id]);
    await request(app).patch(`/api/project-orders/${first.id}`).set(admin).send({ status: 'paid' }).expect(400);
    await request(app).patch(`/api/project-orders/${first.id}`).set(admin).send({}).expect(400);
    expect((await request(app).get(`/api/project-orders/${first.id}`).set(admin).expect(200)).body).toEqual(updated.body);

    await request(app).delete(`/api/project-orders/${first.id}`).set(admin).expect(204);
    expect((await request(app).get(`/api/project-orders/${first.id}`).set(admin).expect(404)).body.error).toBe('Project order not found.');
    await request(app).delete(`/api/project-orders/${first.id}`).set(admin).expect(404);
  });
});

describe('project order pricing and ready-to-print products', () => {
  const rates = { hourlyRate: 3, handlingFee: 4.5, filamentPricePerKg: { PLA: 20, PETG: 30, ABS: 25, ASA: 35, TPU: 50, resin: 60 } };
  const review = { printMinutes: 150, filaments: [{ material: 'PETG', grams: 120 }, { material: 'TPU', grams: 40 }] };
  const customer = () => input().customer;

  async function reviewedOrder() {
    await request(app).put('/api/settings/pricing').set(admin).send(rates).expect(200);
    const order = (await request(app).post('/api/project-orders').send(input()).expect(201)).body;
    return (await request(app).put(`/api/project-orders/${order.id}/review`).set(admin).send(review).expect(200)).body;
  }

  it('keeps shop-wide pricing rates that only admins can read and change', async () => {
    await db.settings.putPricing({ hourlyRate: 2, handlingFee: 5, filamentPricePerKg: rates.filamentPricePerKg, updatedAt: null });
    await request(app).get('/api/settings/pricing').expect(401);
    await request(app).put('/api/settings/pricing').send(rates).expect(401);
    const saved = await request(app).put('/api/settings/pricing').set(admin).send({ ...rates, hourlyRate: 3.456 }).expect(200);
    expect(saved.body).toEqual({ ...rates, hourlyRate: 3.46, updatedAt: expect.any(String) });
    expect((await request(app).get('/api/settings/pricing').set(admin).expect(200)).body).toEqual(saved.body);
    for (const bad of [{ ...rates, hourlyRate: -1 }, { ...rates, filamentPricePerKg: { PLA: 20 } }, { ...rates, extra: 1 }]) {
      await request(app).put('/api/settings/pricing').set(admin).send(bad).expect(400);
    }
  });

  it('prices and stores an admin review with the rates at that time', async () => {
    const reviewed = await reviewedOrder();
    const expected = {
      printMinutes: 150, hourlyRate: 3, printTimeCost: 7.5,
      filaments: [{ material: 'PETG', grams: 120, pricePerKg: 30, cost: 3.6 }, { material: 'TPU', grams: 40, pricePerKg: 50, cost: 2 }],
      filamentCost: 5.6, handlingFee: 4.5, total: 17.6, currency: 'USD', reviewedAt: expect.any(String),
    };
    expect(reviewed.review).toEqual(expected);
    expect((await db.projectOrders.get(reviewed.id))?.review).toEqual(expected);

    // Later rate changes leave the saved review alone until it is saved again.
    await request(app).put('/api/settings/pricing').set(admin).send({ ...rates, hourlyRate: 10 }).expect(200);
    expect((await request(app).get(`/api/project-orders/${reviewed.id}`).set(admin).expect(200)).body.review.total).toBe(17.6);
    const again = await request(app).put(`/api/project-orders/${reviewed.id}/review`).set(admin).send(review).expect(200);
    expect(again.body.review.total).toBe(35.1);

    await request(app).put(`/api/project-orders/${reviewed.id}/review`).send(review).expect(401);
    await request(app).put('/api/project-orders/missing/review').set(admin).send(review).expect(404);
    for (const bad of [{ ...review, filaments: [] }, { ...review, printMinutes: -1 }, { ...review, printMinutes: 1.5 },
      { ...review, filaments: [{ material: 'any', grams: 5 }] }, { ...review, filaments: [{ material: 'PLA', grams: 0 }] }]) {
      await request(app).put(`/api/project-orders/${reviewed.id}/review`).set(admin).send(bad).expect(400);
    }
    expect((await request(app).put(`/api/project-orders/${reviewed.id}/review`).set(admin).send({ ...review, filaments: [] }).expect(400)).body.details)
      .toContain('filaments: Enter the filament used.');
  });

  it('creates ready-to-print products whose price always follows the current rates', async () => {
    const unreviewed = (await request(app).post('/api/project-orders').send(input()).expect(201)).body;
    const body = { orderId: unreviewed.id, title: 'Planter set', description: 'Printed as shown.', published: true };
    expect((await request(app).post('/api/project-products').set(admin).send(body).expect(400)).body.error)
      .toBe('Save a price review for this project order first.');
    await request(app).post('/api/project-products').set(admin).send({ ...body, orderId: 'missing' }).expect(404);

    const reviewed = await reviewedOrder();
    await request(app).post('/api/project-products').send({ ...body, orderId: reviewed.id }).expect(401);
    const created = (await request(app).post('/api/project-products').set(admin).send({ ...body, orderId: reviewed.id }).expect(201)).body;
    expect(created).toMatchObject({
      title: 'Planter set', description: 'Printed as shown.', published: true, project: reviewed.project, items: reviewed.items,
      measurements: review,
      sourceOrder: { id: reviewed.id, number: reviewed.number },
    });
    expect(created.pricing.total).toBe(17.6);
    // Only the measurements are stored; the price is calculated on every request.
    expect(await db.projectProducts.get(created.id)).not.toHaveProperty('pricing');
    const hidden = (await request(app).post('/api/project-products').set(admin).send({ ...body, orderId: reviewed.id, title: 'Draft', published: false }).expect(201)).body;

    const shop = (await request(app).get('/api/project-products').expect(200)).body;
    expect(shop.map((p: { id: string }) => p.id)).toEqual([created.id]);
    expect(shop[0].price).toEqual({ total: 17.6, handlingFee: 4.5, setPrice: 13.1, currency: 'USD' });
    for (const hiddenField of ['pricing', 'measurements', 'sourceOrder']) expect(shop[0]).not.toHaveProperty(hiddenField);
    await request(app).get(`/api/project-products/${hidden.id}`).expect(404);

    await request(app).put('/api/settings/pricing').set(admin).send({ ...rates, hourlyRate: 10, handlingFee: 6 }).expect(200);
    expect((await request(app).get(`/api/project-products/${created.id}`).expect(200)).body.price).toEqual({ total: 36.6, handlingFee: 6, setPrice: 30.6, currency: 'USD' });
    expect((await request(app).get(`/api/project-products/${created.id}`).set(admin).expect(200)).body.pricing).toMatchObject({ hourlyRate: 10, printTimeCost: 25, total: 36.6 });
    expect((await request(app).get('/api/project-products').set(admin).expect(200)).body.map((p: { id: string }) => p.id)).toEqual([hidden.id, created.id]);

    const remeasured = await request(app).patch(`/api/project-products/${created.id}`).set(admin)
      .send({ measurements: { printMinutes: 60, filaments: [{ material: 'PLA', grams: 100 }] } }).expect(200);
    expect(remeasured.body.pricing).toMatchObject({ printTimeCost: 10, filamentCost: 2, total: 18 });
    expect((await request(app).get(`/api/project-products/${created.id}`).expect(200)).body.price.total).toBe(18);
    await request(app).patch(`/api/project-products/${created.id}`).set(admin).send({ measurements: { printMinutes: 60, filaments: [] } }).expect(400);

    await request(app).patch(`/api/project-products/${hidden.id}`).send({ published: true }).expect(401);
    const shown = await request(app).patch(`/api/project-products/${hidden.id}`).set(admin).send({ published: true, title: 'Planter set, large' }).expect(200);
    expect(shown.body).toMatchObject({ published: true, title: 'Planter set, large', measurements: review });
    await request(app).patch(`/api/project-products/${hidden.id}`).set(admin).send({ pricing: { total: 1 } }).expect(400);
    await request(app).patch(`/api/project-products/${hidden.id}`).set(admin).send({}).expect(400);
    expect((await request(app).get('/api/project-products').expect(200)).body).toHaveLength(2);
    await request(app).delete(`/api/project-products/${hidden.id}`).expect(401);
    await request(app).delete(`/api/project-products/${hidden.id}`).set(admin).expect(204);
    expect((await request(app).get(`/api/project-products/${hidden.id}`).set(admin).expect(404)).body.error).toBe('Ready-to-print product not found.');
  });

  async function publishedProduct() {
    const reviewed = await reviewedOrder();
    return (await request(app).post('/api/project-products').set(admin)
      .send({ orderId: reviewed.id, title: 'Planter set', description: '', published: true }).expect(201)).body;
  }
  /** The product's models with every filament as offered, optionally recolored or with other materials. */
  const choices = (product: { items: { file: { id: string } | null; settings: { filaments: { material: string; color: string }[] } }[] },
    change: (filament: { material: string; color: string }) => { material: string; color: string } = (f) => f) =>
    product.items.map((item) => ({ fileId: item.file?.id ?? null, filaments: item.settings.filaments.map(change) }));

  it('prices a product order when it is placed, with new colors, and never reprices it', async () => {
    const product = await publishedProduct();
    // The price follows the rates that apply when the customer orders.
    await request(app).put('/api/settings/pricing').set(admin).send({ ...rates, hourlyRate: 4 }).expect(200);
    const order = (await request(app).post(`/api/project-products/${product.id}/orders`)
      .send({ customer: customer(), sets: 3, notes: 'Gift wrap', items: choices(product, (f) => ({ ...f, color: 'Glow in the dark' })) }).expect(201)).body;
    expect(order).toMatchObject({
      number: expect.stringMatching(/^PJ-/), status: 'new', project: product.project, projectVerified: true, notes: 'Gift wrap',
      requiresQuote: false,
      product: { id: product.id, title: 'Planter set', sets: 3, materialsChanged: false },
      review: {
        printMinutes: 450, hourlyRate: 4, printTimeCost: 30, filamentCost: 16.8, handlingFee: 4.5, total: 51.3,
        filaments: [{ material: 'PETG', grams: 360, pricePerKg: 30, cost: 10.8 }, { material: 'TPU', grams: 120, pricePerKg: 50, cost: 6 }],
      },
    });
    expect(order.items.map((item: { settings: { quantity: number; filaments: { material: string; color: string }[] } }) => item.settings)).toEqual(
      product.items.map((item: { settings: { quantity: number; filaments: { material: string }[] } }) => ({
        ...item.settings, quantity: item.settings.quantity * 3, filaments: item.settings.filaments.map((f) => ({ ...f, color: 'Glow in the dark' })),
      })),
    );
    expect(order.review.total).toBe(4.5 + 3 * 15.6);

    // Neither new rates nor the admin can change a fixed price.
    await request(app).put('/api/settings/pricing').set(admin).send({ ...rates, hourlyRate: 20 }).expect(200);
    expect((await request(app).get(`/api/project-orders/${order.id}`).set(admin).expect(200)).body.review.total).toBe(51.3);
    expect((await request(app).put(`/api/project-orders/${order.id}/review`).set(admin).send(review).expect(409)).body.error)
      .toBe('This order was placed at a fixed price, which cannot change. Only orders that need a quote can be priced.');
    expect((await db.projectOrders.get(order.id))?.review?.total).toBe(51.3);

    const plain = (await request(app).post(`/api/project-products/${product.id}/orders`).send({ customer: customer(), sets: 1, notes: '' }).expect(201)).body;
    expect(plain).toMatchObject({ requiresQuote: false, items: product.items });
  });

  it('turns a product order with a changed material into a request for a quote', async () => {
    const product = await publishedProduct();
    const order = (await request(app).post(`/api/project-products/${product.id}/orders`)
      .send({ customer: customer(), sets: 2, notes: '', items: choices(product, (f) => ({ material: f.material === 'PETG' ? 'ABS' : f.material, color: f.color })) })
      .expect(201)).body;
    expect(order).toMatchObject({ requiresQuote: true, product: { id: product.id, sets: 2, materialsChanged: true } });
    expect(order).not.toHaveProperty('review');
    expect(order.items.flatMap((item: { settings: { filaments: { material: string }[] } }) => item.settings.filaments.map((f) => f.material))).not.toContain('PETG');

    const quoted = await request(app).put(`/api/project-orders/${order.id}/review`).set(admin)
      .send({ printMinutes: 300, filaments: [{ material: 'ABS', grams: 240 }] }).expect(200);
    expect(quoted.body.review.total).toBe(4.5 + 15 + 6);
    // A quote may still change.
    await request(app).put(`/api/project-orders/${order.id}/review`).set(admin).send({ printMinutes: 240, filaments: [{ material: 'ABS', grams: 240 }] }).expect(200);
  });

  it('rejects orders whose choices do not match the product, or for products not on sale', async () => {
    const product = await publishedProduct();
    const base = { customer: customer(), sets: 1, notes: '' };
    const offered = choices(product);
    const cases = [
      offered.slice(1),
      [{ ...offered[0], fileId: 'other' }, ...offered.slice(1)],
      [{ ...offered[0], filaments: [...offered[0].filaments, { material: 'PLA', color: '' }] }, ...offered.slice(1)],
      [{ ...offered[0], filaments: [{ material: 'wood', color: '' }] }, ...offered.slice(1)],
    ];
    for (const items of cases) {
      await request(app).post(`/api/project-products/${product.id}/orders`).send({ ...base, items }).expect(400);
    }
    for (const bad of [{ ...base, sets: 0 }, { ...base, sets: 21 }, { ...base, customer: { ...customer(), email: 'x' } }]) {
      await request(app).post(`/api/project-products/${product.id}/orders`).send(bad).expect(400);
    }
    await request(app).patch(`/api/project-products/${product.id}`).set(admin).send({ published: false }).expect(200);
    await request(app).post(`/api/project-products/${product.id}/orders`).send(base).expect(404);
  });
});
