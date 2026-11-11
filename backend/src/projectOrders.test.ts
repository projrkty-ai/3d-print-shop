import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import type { Order, OrderInput, PrintOnDemandModel, ProjectModel } from './domain/types';
import {
  FileNotListedError, FileTooLargeError, SourceUnavailableError, UpstreamError, type ModelSearch, type ProjectDetails,
} from './modelSearch';
import type { Storage } from './storage';
import { deleteAllOrders, openTestStorage } from './storage/testStorage';

const TOKEN = 'test-admin-token';
const admin = { Authorization: `Bearer ${TOKEN}` };

let db: Storage;
let stop: (() => Promise<void>) | undefined;
let app: ReturnType<typeof createApp>;
const project = vi.fn<ModelSearch['project']>();
const downloadFile = vi.fn<ModelSearch['downloadFile']>();
/** An ASCII STL body (after `solid <name>`). */
const STL_TEXT = '\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid';

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
  app = createApp({ db, adminToken: TOKEN, modelSearch: { search: vi.fn(), projectFromUrl: () => null, project, downloadFile } });
}, 120_000);
afterAll(async () => {
  await stop?.();
});
beforeEach(async () => {
  await deleteAllOrders(db);
  project.mockReset();
  project.mockResolvedValue(details);
  downloadFile.mockReset();
  downloadFile.mockImplementation(async (_ref, fileId) => {
    const file = details.files.find((candidate) => candidate.id === fileId);
    if (!file) throw new FileNotListedError(fileId);
    return { file, data: Buffer.from(`solid ${file.name}${STL_TEXT}`), fileName: null };
  });
});

type ProjectInput = Extract<OrderInput, { source: 'project' }>;

const input = (): ProjectInput => ({
  source: 'project',
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
  customerNote: 'Please print the saucer first.',
});
const place = (body: object) => request(app).post('/api/orders').send(body);
const projectModels = (order: Order) => order.items.map((item) => item.model as ProjectModel);
const sameSettings = { quantity: 2, scalePercent: 100, filaments: [{ material: 'PLA' as const, color: '' }] };

describe('project orders', () => {
  it('lets a customer order a project, storing the verified project and chosen files', async () => {
    const response = await place(input()).expect(201);
    expect(response.headers.location).toBe(`/api/orders/${response.body.id}`);
    expect(response.body).toMatchObject({
      number: expect.stringMatching(/^PJ-\d{6}-[A-Z2-9]{4}$/),
      status: 'received',
      source: 'project',
      project: { ...details.project, verified: true, sameSettingsForAll: false },
      items: [
        { model: { source: 'project', file: details.files[1], scalePercent: 100, filaments: input().items[0].settings.filaments }, quantity: 1, unitPrice: null },
        { model: { source: 'project', file: details.files[0], scalePercent: 120, filaments: input().items[1].settings.filaments }, quantity: 2, unitPrice: null },
      ],
      customerNote: 'Please print the saucer first.',
      customer: { name: 'Anna Nowak', address: { city: 'Kraków' } },
      adminNote: '',
      price: { mode: 'quote', handlingFee: 5, estimated: null, reviewed: null, total: null },
    });
    expect(project).toHaveBeenCalledWith({ source: 'printables', id: '12345' });
    expect(await db.orders.get(response.body.id)).toEqual(response.body);
    // Like every order, its log book starts with the status it was placed with.
    expect(await db.logBook.list(response.body.id)).toEqual([expect.objectContaining({ type: 'status', from: null, to: 'received' })]);
  });

  it("keeps the customer's copy, marked unverified, when the site cannot be reached", async () => {
    project.mockRejectedValue(new Error('HTTP 503'));
    const response = await place(input()).expect(201);
    expect(response.body.project).toEqual({ ...input().project, description: '', license: null, verified: false, sameSettingsForAll: false });
    expect(projectModels(response.body).map((model) => model.file)).toEqual([
      { id: '10', name: 'saucer.stl', sizeBytes: null, thumbnailUrl: null },
      { id: '9', name: 'customer-named.stl', sizeBytes: null, thumbnailUrl: null },
    ]);
    project.mockRejectedValue(new SourceUnavailableError('printables'));
    await place(input()).expect(201);
  });

  it('accepts one selection for all models and a whole-project item when the site lists no files', async () => {
    const same = await place({ ...input(), sameSettingsForAll: true, items: input().items.map((item) => ({ ...item, settings: sameSettings })) }).expect(201);
    expect(same.body.project.sameSettingsForAll).toBe(true);
    expect(same.body.items.map((item: Order['items'][number]) => item.quantity)).toEqual([2, 2]);

    const whole = await place({ ...input(), items: [{ file: null, settings: sameSettings }] }).expect(201);
    expect(whole.body.items).toEqual([{ model: { source: 'project', file: null, scalePercent: 100, filaments: sameSettings.filaments }, quantity: 2, unitPrice: null, lineTotal: null }]);
  });

  it('accepts project orders from storefronts of the previous version', async () => {
    const { source: _source, customerNote, ...legacy } = input();
    const response = await request(app).post('/api/project-orders').send({ ...legacy, notes: customerNote }).expect(201);
    expect(response.headers.location).toBe(`/api/orders/${response.body.id}`);
    expect(response.body).toMatchObject({ source: 'project', status: 'received', customerNote: 'Please print the saucer first.' });
  });

  it('rejects invalid project orders', async () => {
    const cases: [Partial<ProjectInput> | Record<string, unknown>, string][] = [
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
      [{ source: 'thingiverse' }, 'Invalid request.'],
    ];
    for (const [patch, error] of cases) {
      const response = await place({ ...input(), ...patch }).expect(400);
      expect([response.body.error, ...(response.body.details ?? [])], JSON.stringify(patch)).toContain(error);
    }
    expect(await db.orders.list({ limit: 10 })).toEqual([]);
  });
});

describe('project order pricing and ready-to-print products', () => {
  const rates = { hourlyRate: 3, handlingFee: 4.5, filamentPricePerKg: { PLA: 20, PETG: 30, ABS: 25, ASA: 35, TPU: 50, resin: 60 } };
  /** What a set of the product takes: the two models' measurements times their copies (1 saucer, 2 planters). */
  const review = { printMinutes: 150, filaments: [{ material: 'PETG', grams: 120 }, { material: 'TPU', grams: 40 }] };
  /** One copy of each model: the saucer 50 min, 40 g PETG; a planter 50 min, 40 g PETG and 20 g TPU. */
  const itemReviews = [
    { printMinutes: 50, filaments: [{ key: 'PETG', grams: 40 }] },
    { printMinutes: 50, filaments: [{ key: 'PETG', grams: 40 }, { key: 'TPU', grams: 20 }] },
  ];
  const customer = () => input().customer;
  const measure = (order: Order, index: number, body: object) => request(app).put(`/api/orders/${order.id}/items/${index}/review`).set(admin).send(body);

  async function reviewedOrder(): Promise<Order> {
    await request(app).put('/api/settings/pricing').set(admin).send(rates).expect(200);
    const order = (await place(input()).expect(201)).body as Order;
    await measure(order, 0, itemReviews[0]).expect(200);
    return (await measure(order, 1, itemReviews[1]).expect(200)).body;
  }
  const orderPrint = (body: object) => request(app).post('/api/orders').send({ source: 'printOnDemand', customer: customer(), ...body });
  const podModel = (order: Order) => order.items[0].model as PrintOnDemandModel;

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

  it('prices the measurements of every model with the rates at that time, and the order from them', async () => {
    const order = (await place(input()).expect(201)).body as Order;
    await request(app).put('/api/settings/pricing').set(admin).send(rates).expect(200);
    const once = (await measure(order, 0, itemReviews[0]).expect(200)).body as Order;
    expect(once.items[0].review).toEqual({
      printMinutes: 50, hourlyRate: 3, printTimeCost: 2.5,
      filaments: [{ key: 'PETG', label: 'PETG', grams: 40, pricePerKg: 30, cost: 1.2 }],
      filamentCost: 1.2, unitPrice: 3.7, reviewedAt: expect.any(String),
    });
    // A quote order takes the current handling fee; the order's price follows once every model is measured.
    expect(once.price).toEqual({ mode: 'quote', handlingFee: 4.5, estimated: null, reviewed: null, total: null });
    const reviewed = (await measure(order, 1, itemReviews[1]).expect(200)).body as Order;
    expect(reviewed.items[1].review?.unitPrice).toBe(4.7);
    expect(reviewed.price.reviewed).toBe(4.5 + 3.7 + 2 * 4.7);

    // Later rate changes leave the saved measurements alone until they are saved again.
    await request(app).put('/api/settings/pricing').set(admin).send({ ...rates, hourlyRate: 10 }).expect(200);
    expect((await request(app).get(`/api/orders/${order.id}`).set(admin).expect(200)).body.price.reviewed).toBe(17.6);
    expect((await measure(order, 0, itemReviews[0]).expect(200)).body.price.reviewed).toBe(17.6 + 5.83);

    await request(app).put(`/api/orders/${order.id}/items/0/review`).send(itemReviews[0]).expect(401);
    await request(app).put('/api/orders/missing/items/0/review').set(admin).send(itemReviews[0]).expect(404);
    for (const bad of [{ ...itemReviews[0], filaments: [] }, { ...itemReviews[0], printMinutes: -1 },
      { ...itemReviews[0], filaments: [{ key: 'any', grams: 5 }] }, { ...itemReviews[0], filaments: [{ material: 'PLA', grams: 5 }] }]) {
      await measure(order, 0, bad).expect(400);
    }
    expect((await measure(order, 0, { ...itemReviews[0], filaments: [] }).expect(400)).body.details).toContain('filaments: Enter the filament used.');
    expect((await measure(order, 0, { ...itemReviews[0], filaments: [{ key: 'wood', grams: 5 }] }).expect(400)).body.details)
      .toEqual(['Unknown filament "wood" for this model.']);
  });

  it('creates ready-to-print products whose price always follows the current rates', async () => {
    const unreviewed = (await place(input()).expect(201)).body as Order;
    await measure(unreviewed, 0, itemReviews[0]).expect(200);
    const body = { orderId: unreviewed.id, title: 'Planter set', description: 'Printed as shown.', published: true };
    expect((await request(app).post('/api/project-products').set(admin).send(body).expect(400)).body.error)
      .toBe('Measure every model of this project order first: the product keeps their print time and filament.');
    await request(app).post('/api/project-products').set(admin).send({ ...body, orderId: 'missing' }).expect(404);

    const reviewed = await reviewedOrder();
    await request(app).post('/api/project-products').send({ ...body, orderId: reviewed.id }).expect(401);
    const created = (await request(app).post('/api/project-products').set(admin).send({ ...body, orderId: reviewed.id }).expect(201)).body;
    const { verified: _verified, sameSettingsForAll: _same, ...orderedProject } = reviewed.project!;
    expect(created).toMatchObject({
      title: 'Planter set', description: 'Printed as shown.', published: true, project: orderedProject,
      items: input().items.map((item, i) => ({ file: projectModels(reviewed)[i].file, settings: item.settings })),
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
    expect((await request(app).get(`/api/project-products/${hidden.id}`).set(admin).expect(404)).body.error).toBe('Print on Demand product not found.');
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
    const order = (await orderPrint({ productId: product.id, sets: 3, customerNote: 'Gift wrap', items: choices(product, (f) => ({ ...f, color: 'Glow in the dark' })) })
      .expect(201)).body as Order;
    expect(order).toMatchObject({
      number: expect.stringMatching(/^PJ-/), status: 'received', source: 'printOnDemand', customerNote: 'Gift wrap',
      project: { ...product.project, verified: true },
      price: { mode: 'fixed', handlingFee: 4.5, estimated: null, reviewed: 51.3, total: 51.3 },
      items: [{
        model: { source: 'printOnDemand', productId: product.id, title: 'Planter set', materialsChanged: false },
        quantity: 3, unitPrice: 15.6, lineTotal: 46.8,
        // The product's measurements of one set are the item's.
        review: {
          printMinutes: 150, hourlyRate: 4, printTimeCost: 10, filamentCost: 5.6, unitPrice: 15.6,
          filaments: [{ key: 'PETG', label: 'PETG', grams: 120, pricePerKg: 30, cost: 3.6 }, { key: 'TPU', label: 'TPU', grams: 40, pricePerKg: 50, cost: 2 }],
        },
      }],
    });
    expect(podModel(order).models.map((model) => model.settings)).toEqual(
      product.items.map((item: { settings: { quantity: number; filaments: { material: string }[] } }) => ({
        ...item.settings, filaments: item.settings.filaments.map((f) => ({ ...f, color: 'Glow in the dark' })),
      })),
    );

    // Neither new rates, nor the admin's measurements or price can change a fixed price.
    await request(app).put('/api/settings/pricing').set(admin).send({ ...rates, hourlyRate: 20 }).expect(200);
    expect((await measure(order, 0, { printMinutes: 500, filaments: [{ key: 'PETG', grams: 500 }] }).expect(200)).body.price)
      .toMatchObject({ mode: 'fixed', handlingFee: 4.5, total: 51.3 });
    expect((await request(app).patch(`/api/orders/${order.id}`).set(admin).send({ price: 10 }).expect(409)).body.error)
      .toBe('This order was placed at a fixed price, which cannot change. Only orders that need a quote can be priced.');
    expect((await db.orders.get(order.id))?.price.total).toBe(51.3);

    const plain = (await orderPrint({ productId: product.id, sets: 1 }).expect(201)).body as Order;
    expect(podModel(plain).models).toEqual(product.items);
    // The former endpoint still takes orders.
    const legacy = await request(app).post(`/api/project-products/${product.id}/orders`).send({ customer: customer(), sets: 1, notes: 'old' }).expect(201);
    // At the rates that apply now: 150 min × $20/h + $5.60 filament, handling once.
    expect(legacy.body).toMatchObject({ source: 'printOnDemand', customerNote: 'old', price: { total: 4.5 + 50 + 5.6 } });
    // with the fields such a storefront reads from its confirmation
    expect(legacy.body).toMatchObject({ requiresQuote: false, review: { total: 4.5 + 50 + 5.6, handlingFee: 4.5 } });
  });

  it('turns a product order with a changed material into a request for a quote', async () => {
    const product = await publishedProduct();
    const order = (await orderPrint({ productId: product.id, sets: 2, items: choices(product, (f) => ({ material: f.material === 'PETG' ? 'ABS' : f.material, color: f.color })) })
      .expect(201)).body as Order;
    expect(order).toMatchObject({
      price: { mode: 'quote', reviewed: null, total: null },
      items: [{ model: { productId: product.id, materialsChanged: true }, quantity: 2, unitPrice: null, lineTotal: null }],
    });
    expect(order.items[0]).not.toHaveProperty('review');
    expect(podModel(order).models.flatMap((item) => item.settings.filaments.map((f) => f.material))).not.toContain('PETG');

    // Measured like any order that needs a quote, then quoted.
    const measured = (await measure(order, 0, { printMinutes: 150, filaments: [{ key: 'ABS', grams: 120 }] }).expect(200)).body as Order;
    expect(measured.price.reviewed).toBe(4.5 + 2 * (7.5 + 3));
    const quoted = (await request(app).patch(`/api/orders/${order.id}`).set(admin).send({ price: 25.5, status: 'quoted' }).expect(200)).body as Order;
    expect(quoted.price.total).toBe(25.5);
    // A quote may still change.
    expect((await request(app).patch(`/api/orders/${order.id}`).set(admin).send({ price: 24 }).expect(200)).body.price.total).toBe(24);
  });

  it('rejects orders whose choices do not match the product, or for products not on sale', async () => {
    const product = await publishedProduct();
    const base = { productId: product.id, sets: 1 };
    const offered = choices(product);
    const cases = [
      offered.slice(1),
      [{ ...offered[0], fileId: 'other' }, ...offered.slice(1)],
      [{ ...offered[0], filaments: [...offered[0].filaments, { material: 'PLA', color: '' }] }, ...offered.slice(1)],
      [{ ...offered[0], filaments: [{ material: 'wood', color: '' }] }, ...offered.slice(1)],
    ];
    for (const items of cases) {
      await orderPrint({ ...base, items }).expect(400);
    }
    for (const bad of [{ ...base, sets: 0 }, { ...base, sets: 21 }, { ...base, customer: { ...customer(), email: 'x' } }]) {
      await orderPrint(bad).expect(400);
    }
    await orderPrint({ ...base, productId: 'missing' }).expect(404);
    await request(app).patch(`/api/project-products/${product.id}`).set(admin).send({ published: false }).expect(200);
    await orderPrint(base).expect(404);
  });

  describe('sliced print variants', () => {
    const presets = { printer: 'Snapmaker U1 (0.4 nozzle)', process: '0.20 Standard @Snapmaker U1 (0.4 nozzle)', filament: 'Generic PLA @U1 0.4 nozzle' };
    /** Sliced at 50%, 100% and 120%: time ∝ scale², filament ∝ scale³. */
    const variant = (id: string, printMinutes: number, grams: number) => ({
      id, label: `Quality ${id}`, presets, nozzleMm: 0.4, layerHeightMm: 0.2, material: 'PLA', enabled: true,
      measurements: { printMinutes, filaments: [{ material: 'PLA', grams }] },
      scaled: [0.5, 1.2].map((scale) => ({ scale, measurements: { printMinutes: printMinutes * scale ** 2, filaments: [{ material: 'PLA', grams: grams * scale ** 3 }] } })),
    });
    const plate = (plateId: number, variants: ReturnType<typeof variant>[]) => ({
      plateId, matrix: { printers: [presets.printer], processes: [presets.process], filaments: [presets.filament] },
      support: false, overrides: {}, variants, defaultVariantId: variants[0].id,
    });
    const printSetup = () => ({
      mesh: {
        url: '/models/star-vase-project.3mf', format: '3mf', fileName: 'star-vase-project.3mf', sizeBytes: 59735, triangleCount: 17472, parts: [],
        plates: [{ id: 1, name: 'Vase', objectCount: 1 }, { id: 2, name: 'Minis', objectCount: 2 }], plate: 1, selectedPlates: [1, 2],
      },
      model: { widthMm: 117.6, depthMm: 95.9, heightMm: 180, volumeCm3: 171.2 },
      scaling: { enabled: true, minScale: 0.5, maxScale: 1.2 },
      slicing: [plate(1, [variant('fine', 120, 100), variant('fast', 60, 40)]), plate(2, [variant('std', 30, 20)])],
    });

    async function slicedProduct() {
      const product = await publishedProduct();
      return (await request(app).patch(`/api/project-products/${product.id}`).set(admin).send(printSetup()).expect(200)).body;
    }

    it('prices sets from the chosen variants at the chosen scale, and keeps the shop setup private', async () => {
      const product = await slicedProduct();
      // default: fine + std at 100% = 150 min ($7.50) + 120 g PLA ($2.40) per set, handling $4.50
      expect(product.pricing).toMatchObject({ printMinutes: 150, printTimeCost: 7.5, filamentCost: 2.4, total: 14.4 });
      const shop = (await request(app).get(`/api/project-products/${product.id}`).expect(200)).body;
      expect(shop.price).toEqual({ total: 14.4, handlingFee: 4.5, setPrice: 9.9, currency: 'USD' });
      expect(shop.printOptions).toEqual({
        plates: [
          { plateId: 1, name: 'Vase', defaultVariantId: 'fine', variants: [
            { id: 'fine', label: 'Quality fine', nozzleMm: 0.4, layerHeightMm: 0.2, material: 'PLA' },
            { id: 'fast', label: 'Quality fast', nozzleMm: 0.4, layerHeightMm: 0.2, material: 'PLA' },
          ] },
          { plateId: 2, name: 'Minis', defaultVariantId: 'std', variants: [{ id: 'std', label: 'Quality std', nozzleMm: 0.4, layerHeightMm: 0.2, material: 'PLA' }] },
        ],
        scale: { min: 0.5, max: 1.2 },
        size: { widthMm: 117.6, depthMm: 95.9, heightMm: 180 },
      });
      for (const field of ['slicing', 'mesh', 'model', 'scaling', 'measurements']) expect(shop).not.toHaveProperty(field);
      expect(JSON.stringify(shop)).not.toContain('Snapmaker');

      // fast + std at 120%: 129.6 min ($6.48) + 103.68 g ($2.07) per set
      const print = { scale: 1.2, variants: { 1: 'fast', 2: 'std' } };
      const quote = (await request(app).post(`/api/project-products/${product.id}/quote`).send({ sets: 2, print }).expect(200)).body;
      expect(quote).toEqual({
        sets: 2, setPrice: 8.55, handlingFee: 4.5, total: 21.6, currency: 'USD',
        print: { scale: 1.2, variants: { 1: 'fast', 2: 'std' } },
        variantPrices: { 1: { fine: 12.1, fast: 5.7 }, 2: { std: 2.85 } },
      });
      // withdrawn or unknown variants fall back to the default
      expect((await request(app).post(`/api/project-products/${product.id}/quote`).send({ sets: 1, print: { scale: 1, variants: { 1: 'gone' } } }).expect(200)).body)
        .toMatchObject({ setPrice: 9.9, print: { variants: { 1: 'fine', 2: 'std' } } });
      expect((await request(app).post(`/api/project-products/${product.id}/quote`).send({ sets: 1, print: { scale: 1.3, variants: {} } }).expect(400)).body.details)
        .toEqual(['Choose a size from 50% to 120% of the original.']);

      const order = (await orderPrint({ productId: product.id, sets: 2, print, items: choices(product, () => ({ material: 'ABS', color: 'blue' })) }).expect(201)).body as Order;
      // the variants decide the materials: no quote needed, colors are the customer's
      expect(order.price).toMatchObject({ mode: 'fixed', total: 21.6 });
      expect(order.items[0]).toMatchObject({ quantity: 2, unitPrice: 8.55, review: { printMinutes: 129.6 } });
      expect(podModel(order).print).toEqual({
        scale: 1.2,
        plates: [
          { plateId: 1, name: 'Vase', variant: { id: 'fast', label: 'Quality fast', nozzleMm: 0.4, layerHeightMm: 0.2, material: 'PLA', presets, support: false } },
          { plateId: 2, name: 'Minis', variant: { id: 'std', label: 'Quality std', nozzleMm: 0.4, layerHeightMm: 0.2, material: 'PLA', presets, support: false } },
        ],
      });
      expect(podModel(order).models.map((item) => [item.settings.scalePercent, item.settings.filaments[0]]))
        .toEqual([[120, { material: 'PLA', color: 'blue' }], [144, { material: 'PLA', color: 'blue' }]]);
      await orderPrint({ productId: product.id, sets: 1, print: { scale: 0.2, variants: {} } }).expect(400);
    });

    it('checks the print file, scaling and variants the admin saves, and prices unsliced products as before', async () => {
      const product = await publishedProduct();
      const setup = printSetup();
      const missing = { ...setup, scaling: { enabled: true, minScale: 0.4, maxScale: 1.2 } };
      expect((await request(app).patch(`/api/project-products/${product.id}`).set(admin).send(missing).expect(400)).body.details)
        .toContain('Vase, Quality fine: not sliced at 40%: slice the variants again after changing the scaling.');
      const { mesh: _mesh, ...withoutFile } = setup;
      expect((await request(app).patch(`/api/project-products/${product.id}`).set(admin).send({ ...withoutFile, mesh: null }).expect(400)).body.details)
        .toEqual(expect.arrayContaining(['Scaling needs a print file.', 'Print variants need a 3D model file.']));
      await request(app).patch(`/api/project-products/${product.id}`).set(admin).send({ ...setup, mesh: { ...setup.mesh, url: 'javascript:alert(1)' } }).expect(400);
      // only one plate offered: the measurements price the product
      const partial = (await request(app).patch(`/api/project-products/${product.id}`).set(admin)
        .send({ ...setup, slicing: [setup.slicing[0]] }).expect(400)).body;
      expect(partial.details).toEqual([expect.stringContaining('missing on Minis')]);
      const fixed = (await request(app).patch(`/api/project-products/${product.id}`).set(admin)
        .send({ ...setup, scaling: { enabled: false, minScale: 1, maxScale: 1 } }).expect(200)).body;
      expect(fixed.pricing.total).toBe(14.4);
      const shop = (await request(app).get(`/api/project-products/${product.id}`).expect(200)).body;
      expect(shop.printOptions.scale).toEqual({ min: 1, max: 1 });
      expect((await request(app).post(`/api/project-products/${product.id}/quote`).send({ sets: 1, print: { scale: 1.2, variants: {} } }).expect(400)).body.details)
        .toEqual(['This product is printed at its original size only.']);
      // products without variants: the measurements, any scale choice ignored
      const plain = await publishedProduct();
      expect((await request(app).post(`/api/project-products/${plain.id}/quote`).send({ sets: 2 }).expect(200)).body)
        .toEqual({ sets: 2, setPrice: 13.1, handlingFee: 4.5, total: 30.7, currency: 'USD' });
    });
  });
});

describe('downloading project files', () => {
  const download = (order: Order, fileId: string) =>
    request(app).get(`/api/orders/${order.id}/project-files/${fileId}`).set(admin).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });

  it("downloads an order's model files from the project's site whenever asked, keeping no copy", async () => {
    const order = (await place(input()).expect(201)).body as Order;
    await request(app).get(`/api/orders/${order.id}/project-files/9`).expect(401);

    const file = await download(order, '9').expect(200)
      .expect('Content-Type', 'application/octet-stream')
      .expect('Content-Disposition', 'attachment; filename="planter.stl"; filename*=UTF-8\'\'planter.stl')
      .expect('X-Model-Format', 'stl')
      .expect('Cache-Control', 'private, no-store');
    expect(downloadFile).toHaveBeenCalledWith({ source: 'printables', id: '12345' }, '9');
    expect(file.body.toString()).toMatch(/^solid planter\.stl/);
    // Nothing is stored: the order is unchanged and the next download asks the site again.
    expect(await db.orders.get(order.id)).toEqual(order);
    await download(order, '10').expect(200).expect('Content-Disposition', /saucer\.stl/);
    await download(order, '9').expect(200);
    expect(downloadFile).toHaveBeenCalledTimes(3);
  });

  it("explains why a file can't be downloaded", async () => {
    const order = (await place(input()).expect(201)).body as Order;
    expect((await download(order, '11').expect(404)).body.toString()).toContain('The order has no such model file.');
    await request(app).get('/api/orders/missing/project-files/9').set(admin).expect(404);
    const error = async (status: number) => JSON.parse((await download(order, '9').expect(status)).body.toString());

    downloadFile.mockRejectedValueOnce(new SourceUnavailableError('printables'));
    expect((await error(503)).error).toBe("Printables is not available on this server, so the shop can't fetch its files. Download them from the project page.");
    downloadFile.mockRejectedValueOnce(new FileNotListedError('9'));
    expect((await error(409)).error).toBe('Printables no longer lists planter.stl in this project. Download it from the project page, if it is still there.');
    downloadFile.mockRejectedValueOnce(new FileTooLargeError(1));
    expect((await error(502)).error).toBe('planter.stl is larger than 200 MB, more than the shop fetches. Download it from the project page.');
    downloadFile.mockRejectedValueOnce(new UpstreamError('HTTP 500 from api.printables.com'));
    expect(await error(502)).toEqual({
      error: 'Could not download planter.stl from Printables. Try again later, or download it from the project page.',
      details: ['HTTP 500 from api.printables.com'],
    });

    // Other formats can be downloaded, marked as not sliceable; names get an extension only for STL/3MF.
    downloadFile.mockResolvedValueOnce({ file: details.files[0], data: Buffer.from('ISO-10303-21;'), fileName: 'planter.step' });
    await download(order, '9').expect(200).expect('X-Model-Format', 'other').expect('Content-Disposition', /filename="planter\.step"/);
    downloadFile.mockResolvedValueOnce({ file: details.files[0], data: Buffer.from(`solid model${STL_TEXT}`), fileName: 'model' });
    await download(order, '9').expect(200).expect('X-Model-Format', 'stl').expect('Content-Disposition', /filename="planter\.stl"/);
  });

  it('downloads the models of an ordered Print on Demand set', async () => {
    const reviewed = (await place(input()).expect(201)).body as Order;
    for (const index of [0, 1]) {
      await request(app).put(`/api/orders/${reviewed.id}/items/${index}/review`).set(admin).send({ printMinutes: 5, filaments: [{ key: 'PLA', grams: 5 }] }).expect(200);
    }
    const product = (await request(app).post('/api/project-products').set(admin)
      .send({ orderId: reviewed.id, title: 'Planter set', description: '', published: true }).expect(201)).body;
    const order = (await request(app).post('/api/orders').send({ source: 'printOnDemand', customer: input().customer, productId: product.id, sets: 2 })
      .expect(201)).body as Order;
    await download(order, '10').expect(200).expect('Content-Disposition', /saucer\.stl/);
    expect((await download(order, '99').expect(404)).body.toString()).toContain('The order has no such model file.');
  });
});
