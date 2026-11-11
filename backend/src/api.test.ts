import { crc32, deflateRawSync } from 'node:zlib';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSeedProducts } from './domain/data/seedProducts';
import type { CatalogModel, Customization, Order, OrderInput, PrinterModelWithPrinters, PrinterWithModel, Product } from './domain/types';

type CatalogLines = Extract<OrderInput, { items: { productId: string }[] }>['items'];
/** The configured product of a catalog order's item. */
const catalogModel = (order: Order, index = 0) => order.items[index].model as CatalogModel;
import { createApp } from './app';
import { seedProducts, type Storage } from './storage';
import { deleteAllOrders, deleteAllPrinters, openTestStorage } from './storage/testStorage';
import { DEFAULT_PRICING } from './domain/utils/projectPricing';

const TOKEN = 'test-admin-token';
const admin = { Authorization: `Bearer ${TOKEN}` };

let db: Storage;
let stop: (() => Promise<void>) | undefined;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  ({ storage: db, stop } = await openTestStorage('test'));
  app = createApp({ db, adminToken: TOKEN });
}, 120_000);

afterAll(async () => {
  await stop?.();
});

beforeEach(async () => {
  await deleteAllOrders(db);
  await seedProducts(db, { reset: true });
  await db.settings.putPricing(DEFAULT_PRICING);
});

/** Editable fields of a seed product, as the admin UI sends them. */
function productBody(id = 'spiral-vase'): Omit<Product, 'id' | 'createdAt' | 'updatedAt'> {
  const { id: _id, createdAt: _c, updatedAt: _u, ...body } = createSeedProducts().find((p) => p.id === id)!;
  return body;
}

const spiralVase = (overrides: Partial<Customization> = {}): Customization => ({
  dimensions: { widthMm: 110, depthMm: 110, heightMm: 200 },
  colorId: 'white',
  partColors: {},
  engravingText: '',
  engravingFont: 'Georgia',
  engravingColorId: null,
  textureDataUrl: null,
  ...overrides,
});

const checkout = (items: CatalogLines): OrderInput => ({
  customer: {
    name: 'Anna Nowak',
    email: 'anna@example.com',
    address: { line1: 'Długa 1', city: 'Kraków', postalCode: '30-001', country: 'Poland' },
  },
  items,
});

describe('admin session', () => {
  it('allows both configured frontends, including authenticated upload preflights, and rejects other origins', async () => {
    const isolated = createApp({ db, adminToken: TOKEN, allowedOrigins: ['https://shop.example', 'https://admin.example'] });
    for (const origin of ['https://shop.example', 'https://admin.example']) {
      await request(isolated).get('/api/health').set('Origin', origin)
        .expect('Access-Control-Allow-Origin', origin).expect(200);
    }
    const preflight = await request(isolated).options('/api/model-files')
      .set('Origin', 'https://admin.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type,x-file-name').expect(204);
    expect(preflight.headers['access-control-allow-headers'].toLowerCase()).toContain('x-file-name');
    await request(isolated).get('/api/health').set('Origin', 'https://unconfigured.example').expect(403);
  });

  it('serves its own demo models but never serves a frontend application', async () => {
    const model = await request(app).get('/models/twisted-star-vase.stl').expect(200);
    expect(model.headers['content-type']).not.toContain('text/html');
    for (const path of ['/', '/admin', '/product/spiral-vase']) {
      await request(app).get(path).expect('Content-Type', /json/).expect(404);
    }
  });

  it('accepts the admin token and rejects anything else', async () => {
    await request(app).get('/api/admin/session').set(admin).expect(204);
    await request(app).get('/api/admin/session').set({ Authorization: 'Bearer wrong' }).expect(401);
    await request(app).get('/api/admin/session').expect(401);
  });
});

describe('products', () => {
  it('saves rich descriptions and carousel-only media without changing legacy plain descriptions', async () => {
    const body = productBody();
    const gallery = [
      { type: 'image', url: '/api/media-files/example', alt: 'Carousel only' },
      { type: 'video', url: 'https://youtu.be/dQw4w9WgXcQ', alt: 'Video' },
    ];
    const description = '<h2>Details</h2><p><strong>Solid</strong> print</p><img src="https://images.example/photo.png" alt="Photo"><video src="https://youtu.be/dQw4w9WgXcQ" title="Demo"></video>';
    await request(app).put('/api/products/spiral-vase').set(admin).send({
      ...body, description, descriptionFormat: 'html', gallery,
    }).expect(200);
    const saved = (await request(app).get('/api/products/spiral-vase').expect(200)).body as Product;
    expect(saved.descriptionFormat).toBe('html');
    expect(saved.description).toContain('<strong>Solid</strong>');
    expect(saved.description).toContain('controls');
    expect(saved.gallery).toEqual(gallery);
    const plain = 'Literally <strong>not HTML</strong>';
    const legacy = await request(app).put('/api/products/spiral-vase').set(admin).send({ ...body, description: plain }).expect(200);
    expect(legacy.body.description).toBe(plain);
    expect(legacy.body.descriptionFormat).toBeUndefined();
  });

  it('sanitizes rich HTML and rejects unsafe gallery URLs and oversized descriptions', async () => {
    const body = productBody();
    const result = await request(app).put('/api/products/spiral-vase').set(admin).send({
      ...body, descriptionFormat: 'html',
      description: '<p onclick="alert(1)">Safe<script>alert(1)</script></p><img src="javascript:alert(1)" onerror="alert(1)"><iframe src="https://evil.example"></iframe><video src="https://example.com/demo.mp4" autoplay onplay="alert(1)"></video>',
    }).expect(200);
    expect(result.body.description).toContain('<p>Safe</p>');
    expect(result.body.description).not.toMatch(/script|onclick|onerror|iframe|autoplay|onplay/);
    for (const url of ['javascript:alert(1)', 'data:image/png;base64,AA==', '//evil.example/a.png', 'https://%']) {
      await request(app).put('/api/products/spiral-vase').set(admin).send({
        ...body, gallery: [{ type: 'image', url, alt: '' }],
      }).expect(400);
    }
    await request(app).put('/api/products/spiral-vase').set(admin).send({ ...body, description: 'x'.repeat(100_001) }).expect(400);
  });

  it('lists only published products to customers, everything to admins', async () => {
    const publicIds = (await request(app).get('/api/products').expect(200)).body.map((p: Product) => p.id);
    const adminIds = (await request(app).get('/api/products').set(admin).expect(200)).body.map((p: Product) => p.id);
    expect(publicIds).not.toContain('moon-lamp');
    expect(adminIds).toContain('moon-lamp');
    expect(adminIds).toHaveLength(createSeedProducts().length);
  });

  it('hides unpublished products from customers', async () => {
    await request(app).get('/api/products/moon-lamp').expect(404);
    const { body } = await request(app).get('/api/products/moon-lamp').set(admin).expect(200);
    expect(body).toMatchObject({ id: 'moon-lamp', published: false });
    expect(body).not.toHaveProperty('_id');
  });

  it('requires the admin token to create, update or delete', async () => {
    await request(app).post('/api/products').send(productBody()).expect(401);
    await request(app).put('/api/products/spiral-vase').send(productBody()).expect(401);
    await request(app).delete('/api/products/spiral-vase').expect(401);
  });

  it('creates products with a unique id derived from the name', async () => {
    const body = { ...productBody(), name: 'Spiral Vase', id: 'ignored' };
    const first = await request(app).post('/api/products').set(admin).send(body).expect(201);
    expect(first.body.id).toBe('spiral-vase-2'); // the seed already has "spiral-vase"
    expect(first.headers.location).toBe('/api/products/spiral-vase-2');
    const second = await request(app).post('/api/products').set(admin).send(body).expect(201);
    expect(second.body.id).toBe('spiral-vase-3');
  });

  it('reports business-rule problems from the shared validation', async () => {
    const { body } = await request(app)
      .post('/api/products')
      .set(admin)
      .send({ ...productBody(), basePrice: 10, fixedFee: 20 })
      .expect(400);
    expect(body).toEqual({
      error: 'The product has problems.',
      details: ["Fixed fee can't be more than the price at original size."],
    });
  });

  it('rejects malformed bodies and unsafe model URLs', async () => {
    const { name: _name, ...missingName } = productBody();
    const malformed = await request(app).post('/api/products').set(admin).send(missingName).expect(400);
    expect(malformed.body.error).toBe('Invalid request.');
    expect(malformed.body.details[0]).toMatch(/^name:/);

    const mesh = { ...productBody('twisted-star-vase').mesh!, url: 'javascript:alert(1)' };
    await request(app).post('/api/products').set(admin).send({ ...productBody(), mesh }).expect(400);
  });

  it('updates a product, keeping its id and creation time', async () => {
    const before = (await request(app).get('/api/products/spiral-vase').expect(200)).body as Product;
    const { body } = await request(app)
      .put('/api/products/spiral-vase')
      .set(admin)
      .send({ ...productBody(), basePrice: 40 })
      .expect(200);
    expect(body).toMatchObject({ id: 'spiral-vase', basePrice: 40, createdAt: before.createdAt });
    expect(body.updatedAt).not.toBe(before.updatedAt);
    await request(app).put('/api/products/nope').set(admin).send(productBody()).expect(404);
  });

  it('accepts products saved before plate support, filling in no plates', async () => {
    const body = productBody('twisted-star-vase');
    const { plates: _plates, plate: _plate, ...oldMesh } = body.mesh!;
    const { body: saved } = await request(app)
      .put('/api/products/twisted-star-vase')
      .set(admin)
      .send({ ...body, mesh: oldMesh })
      .expect(200);
    expect(saved.mesh).toMatchObject({ plates: [], plate: null });
  });

  it('stores the chosen plate of a multi-plate project', async () => {
    const plates = [
      { id: 1, name: 'Vase', objectCount: 1 },
      { id: 2, name: 'Minis', objectCount: 2 },
    ];
    const body = productBody('twisted-star-vase');
    const ok = await request(app).put('/api/products/twisted-star-vase').set(admin).send({ ...body, mesh: { ...body.mesh!, plates, plate: 2 } });
    expect(ok.status).toBe(200);
    expect(ok.body.mesh.plate).toBe(2);
    const bad = await request(app).put('/api/products/twisted-star-vase').set(admin).send({ ...body, mesh: { ...body.mesh!, plates, plate: 9 } });
    expect(bad.body.details).toEqual(['Choose which plate of the project this product is.']);
  });

  it('upgrades stored products that predate plate support', async () => {
    const stored = (await db.products.get('twisted-star-vase'))!;
    const { plates: _plates, plate: _plate, ...legacyMesh } = stored.mesh!;
    await db.products.replace({ ...stored, mesh: legacyMesh as NonNullable<Product['mesh']> });
    await db.prepare();
    const { body } = await request(app).get('/api/products/twisted-star-vase').expect(200);
    expect(body.mesh).toMatchObject({ plates: [], plate: null });
    expect((await request(app).get('/api/products/spiral-vase').expect(200)).body.mesh).toBeNull();
  });

  it('persists a multi-plate set and prices and snapshots the entire set on checkout', async () => {
    const body = productBody('twisted-star-vase');
    const plates = [
      { id: 1, name: 'First cube', objectCount: 1, model: { widthMm: 10, depthMm: 10, heightMm: 10, volumeCm3: 1 } },
      { id: 2, name: 'Second cube', objectCount: 1, model: { widthMm: 10, depthMm: 10, heightMm: 10, volumeCm3: 1 } },
    ];
    await request(app).put('/api/products/twisted-star-vase').set(admin).send({
      ...body,
      basePrice: 20, fixedFee: 4,
      model: { widthMm: 10, depthMm: 10, heightMm: 10, volumeCm3: 2 },
      mesh: { ...body.mesh!, plates, plate: 1, selectedPlates: [1, 2] },
    }).expect(200);
    const saved = (await request(app).get('/api/products/twisted-star-vase').expect(200)).body as Product;
    expect(saved.mesh?.selectedPlates).toEqual([1, 2]);
    expect(saved.mesh?.plates).toEqual(plates);
    const { body: order } = await request(app).post('/api/orders').send(checkout([{
      productId: saved.id,
      customization: spiralVase({ dimensions: { widthMm: 5, depthMm: 5, heightMm: 5 }, engravingFont: 'Arial' }),
      quantity: 2,
    }])).expect(201);
    expect(order.price.total).toBe(5.02); // Two complete sets: 2 × rounded(0.25 cm³ × $0.04875/cm³), plus one handling fee.
    expect(order.items[0].model.plates).toEqual(plates.map(({ model: _model, ...plate }) => expect.objectContaining(plate)));
    expect(order.items[0].model.priceLines[0]).toMatchObject({
      amount: 0.01,
      label: expect.stringContaining('2 plates'),
      note: expect.stringContaining('0.25 cm³'),
    });
    for (const selectedPlates of [[], [1, 1], [1, 99]]) {
      await request(app).put('/api/products/twisted-star-vase').set(admin).send({
        ...body, mesh: { ...body.mesh!, plates, plate: 1, selectedPlates },
      }).expect(400);
    }
  });

  it('deletes a product', async () => {
    await request(app).delete('/api/products/pen-holder').set(admin).expect(204);
    await request(app).get('/api/products/pen-holder').expect(404);
    await request(app).delete('/api/products/pen-holder').set(admin).expect(404);
  });
});

describe('orders', () => {
  it('prints fixed-size products at their original size whatever size is sent', async () => {
    const box = productBody('keepsake-box');
    const customization = spiralVase({ dimensions: { widthMm: 40, depthMm: 40, heightMm: 40 } });
    const { body: order } = await request(app).post('/api/orders').send(checkout([{ productId: 'keepsake-box', customization, quantity: 1 }])).expect(201);
    expect(order.items[0].model.customization.dimensions).toEqual({ widthMm: box.model.widthMm, depthMm: box.model.depthMm, heightMm: box.model.heightMm });
    expect(order.items[0].model.sizeLabel).toContain('80 × 80 × 80 mm');
  });

  it('uses current rates for catalog reads and checkout, charges handling once and preserves placed prices', async () => {
    const rates = { ...DEFAULT_PRICING, hourlyRate: 10, handlingFee: 7, filamentPricePerKg: { ...DEFAULT_PRICING.filamentPricePerKg, PLA: 50, PETG: 60 } };
    await request(app).put('/api/settings/pricing').set(admin).send({
      hourlyRate: rates.hourlyRate, handlingFee: rates.handlingFee, filamentPricePerKg: rates.filamentPricePerKg,
    }).expect(200);
    const product = (await request(app).get('/api/products/spiral-vase').expect(200)).body as Product;
    expect(product.catalogPricing?.ratesPerCm3.PLA).toBeCloseTo(0.2145);
    expect(product.catalogPricing?.handlingFee).toBe(7);
    expect((await db.products.get(product.id))?.catalogPricing).toBeUndefined();
    const list = (await request(app).get('/api/products').expect(200)).body as Product[];
    expect(list.find((item) => item.id === product.id)?.catalogPricing).toEqual(product.catalogPricing);
    expect((await request(app).get('/api/settings/catalog-pricing').expect(200)).body).toEqual(product.catalogPricing);
    const input = checkout([
      { productId: product.id, customization: spiralVase(), quantity: 2 },
      { productId: 'pen-holder', customization: spiralVase({ dimensions: { widthMm: 80, depthMm: 80, heightMm: 100 } }), quantity: 1 },
    ]);
    const { body: placed } = await request(app).post('/api/orders').send(input).expect(201);
    expect(placed.items.map((item: { unitPrice: number }) => item.unitPrice)).toEqual([20.38, 13.1]);
    expect(placed.price).toMatchObject({ handlingFee: 7, total: 60.86 });

    await request(app).put('/api/settings/pricing').set(admin).send({
      hourlyRate: 20, handlingFee: 9, filamentPricePerKg: rates.filamentPricePerKg,
    }).expect(200);
    const changed = (await request(app).get('/api/products/spiral-vase').expect(200)).body as Product;
    expect(changed.catalogPricing?.ratesPerCm3.PLA).toBeCloseTo(0.4095);
    const next = (await request(app).post('/api/orders').send(input).expect(201)).body;
    expect(next.price.total).toBeGreaterThan(placed.price.total);
    expect(next.price.handlingFee).toBe(9);
    expect((await request(app).get(`/api/orders/${placed.id}`).set(admin).expect(200)).body).toEqual(placed);

    const updated = (await request(app).put('/api/products/spiral-vase').set(admin).send({
      ...productBody(), catalogPricing: { ratesPerCm3: {}, handlingFee: 0 }, basePrice: 1000, fixedFee: 999,
    }).expect(200)).body as Product;
    // Admins also receive the hourly and per-kilogram rates; customers only the derived ones.
    expect(changed.catalogPricing).not.toHaveProperty('hourlyRate');
    expect(updated.catalogPricing).toEqual({ ...changed.catalogPricing, hourlyRate: 20, filamentPricePerKg: rates.filamentPricePerKg });
    expect((await db.products.get(product.id))?.catalogPricing).toBeUndefined();
    expect((await request(app).post('/api/orders').send(input).expect(201)).body.price.total).toBe(next.price.total);
  });

  it('persists per-plate placement and snapshots trusted settings, not customer-supplied placement', async () => {
    const body = productBody('twisted-star-vase');
    const first = { text: { centerX: 20, centerY: 70, horizontalAlign: 'left', verticalAlign: 'top' } };
    const second = { texture: { centerX: 75, centerY: 40, width: 30, height: 25 } };
    const plates = [
      { id: 1, name: 'Base', objectCount: 1, decorationLayout: first },
      { id: 2, name: 'Lid', objectCount: 1, decorationLayout: second },
    ];
    const updated = { ...body, mesh: { ...body.mesh!, plates, plate: 1, selectedPlates: [1, 2] } };
    await request(app).put('/api/products/twisted-star-vase').set(admin).send(updated).expect(200);
    const saved = (await request(app).get('/api/products/twisted-star-vase').expect(200)).body as Product;
    expect(saved.mesh?.plates.map((plate) => plate.decorationLayout)).toEqual([first, second]);
    const customization = spiralVase({ dimensions: saved.model, engravingFont: 'Arial' });
    const { body: order } = await request(app).post('/api/orders').send(checkout([{
      productId: saved.id, quantity: 1,
      customization: {
        ...customization,
        ...{ decorationLayout: { text: { ...first.text, centerX: 99 } } },
        plates: {
          '1': { ...customization, ...{ decorationLayout: second } },
          '2': { ...customization, ...{ decorationLayout: first } },
        },
      },
    }])).expect(201);
    expect(order.items[0].model.plates.map((plate: { appearance: { decorationLayout: unknown } }) => plate.appearance.decorationLayout)).toEqual([first, second]);
    expect(order.items[0].model.customization).not.toHaveProperty('decorationLayout');
    expect(order.items[0].model.customization.plates['1']).not.toHaveProperty('decorationLayout');
    await request(app).put('/api/products/twisted-star-vase').set(admin).send({
      ...updated, mesh: { ...updated.mesh, plates: plates.map((plate) => ({ ...plate, decorationLayout: {} })) },
    }).expect(200);
    const retained = (await request(app).get(`/api/orders/${order.id}`).set(admin).expect(200)).body as Order;
    expect(catalogModel(retained).plates?.map((plate) => plate.appearance?.decorationLayout)).toEqual([first, second]);
  });

  it('saves product-level placement and rejects invalid text, texture and plate layout settings', async () => {
    const body = productBody();
    const text = { centerX: 0, centerY: 100, horizontalAlign: 'right', verticalAlign: 'bottom' };
    const texture = { centerX: 100, centerY: 0, width: 1, height: 100 };
    await request(app).put('/api/products/spiral-vase').set(admin).send({ ...body, decorationLayout: { text, texture } }).expect(200);
    const saved = (await request(app).get('/api/products/spiral-vase').expect(200)).body as Product;
    expect(saved.decorationLayout).toEqual({ text, texture });
    const { body: order } = await request(app).post('/api/orders').send(checkout([{
      productId: saved.id, customization: spiralVase(), quantity: 1,
    }])).expect(201);
    expect(order.items[0].model.decorationLayout).toEqual({ text, texture });
    const invalid = [
      { text: { ...text, centerX: -1 } }, { text: { ...text, centerY: 101 } },
      { text: { ...text, horizontalAlign: 'justify' } }, { text: { ...text, verticalAlign: 'center' } },
      { texture: { ...texture, width: 0 } }, { texture: { ...texture, height: 101 } },
      { texture: { ...texture, centerX: '20' } }, { texture: { ...texture, centerY: null } },
    ];
    for (const decorationLayout of invalid) {
      await request(app).put('/api/products/spiral-vase').set(admin).send({ ...body, decorationLayout }).expect(400);
    }
    const withMesh = productBody('twisted-star-vase');
    await request(app).put('/api/products/twisted-star-vase').set(admin).send({
      ...withMesh,
      mesh: { ...withMesh.mesh!, plate: 1, plates: [{ id: 1, name: 'Invalid', objectCount: 1, decorationLayout: invalid[0] }] },
    }).expect(400);
  });

  it('keeps independent plate appearances and charges text, texture and premium filament once per set', async () => {
    const body = productBody('twisted-star-vase');
    const parts = [{ key: 'body', name: 'Body', fileColor: '#123456' }];
    const plates = [
      { id: 1, name: 'Base plate', objectCount: 1, parts },
      { id: 2, name: 'Lid plate', objectCount: 1, parts },
    ];
    await request(app).put('/api/products/twisted-star-vase').set(admin).send({
      ...body,
      mesh: { ...body.mesh!, parts, plates, plate: 1, selectedPlates: [1, 2] },
      texture: { enabled: true, price: 7 },
    }).expect(200);
    const root = spiralVase({
      dimensions: { widthMm: 95.9, depthMm: 95.9, heightMm: 180 },
      engravingText: '', textureDataUrl: null,
    });
    const first = {
      colorId: 'white', partColors: { body: 'gold' }, engravingText: 'First  \n\n',
      engravingFont: 'Arial', engravingColorId: 'gold', textureDataUrl: 'data:image/png;base64,AA==',
    };
    const second = {
      colorId: 'white', partColors: { body: 'red' }, engravingText: 'Second',
      engravingFont: 'Impact', engravingColorId: null, textureDataUrl: 'data:image/png;base64,AQ==',
    };
    const { body: order } = await request(app).post('/api/orders').send(checkout([{
      productId: 'twisted-star-vase',
      customization: { ...root, plates: { '1': first, '2': second } },
      quantity: 1,
    }])).expect(201);
    expect(order.price.total).toBe(5.83 + 3 + 5 + 3 + 7 + 5);
    expect(order.items[0].model.customization.plates).toEqual({
      '1': { ...first, engravingText: 'First' }, '2': second,
    });
    expect(order.items[0].model.plates).toMatchObject([
      { id: 1, appearance: { parts: [{ name: 'Body', colorName: 'Silk Gold' }], engravingColor: { name: 'Silk Gold' } } },
      { id: 2, appearance: { parts: [{ name: 'Body', colorName: 'Signal Red' }] } },
    ]);
    expect(order.items[0].model.priceLines.map((line: { label: string }) => line.label)).toEqual([
      expect.stringContaining('2 plates'), 'Color: Silk Gold', 'Engraving', 'Colored engraving', 'Picture texture',
    ]);
    const invalid = await request(app).post('/api/orders').send(checkout([{
      productId: 'twisted-star-vase',
      customization: { ...root, plates: { '1': first, '2': { ...second, engravingText: '<bad>' } } },
      quantity: 1,
    }])).expect(400);
    expect(invalid.body.details).toEqual([expect.stringMatching(/Lid plate: Use letters/)]);
    await request(app).post('/api/orders').send(checkout([{
      productId: 'twisted-star-vase',
      customization: { ...root, plates: { '1': { ...first, textureDataUrl: 'https://example.com/unsafe.png' } } },
      quantity: 1,
    }])).expect(400);
  });

  it('offers shop textures, snapshots the chosen one and rejects textures that are no longer offered', async () => {
    const body = productBody();
    const marble = { id: 'marble', name: 'Marble', url: '/api/media-files/0123456789abcdef01234567' };
    await request(app).put('/api/products/spiral-vase').set(admin).send({
      ...body, texture: { enabled: true, price: 7, options: [marble], allowCustom: false },
    }).expect(200);
    const saved = (await request(app).get('/api/products/spiral-vase').expect(200)).body as Product;
    expect(saved.texture).toEqual({ enabled: true, price: 7, options: [marble], allowCustom: false });

    const { body: order } = await request(app).post('/api/orders').send(checkout([{
      productId: 'spiral-vase', customization: spiralVase({ textureId: 'marble' }), quantity: 1,
    }])).expect(201);
    expect(order.price.total).toBe(4.63 + 7 + 5);
    expect(order.items[0].model.customization).toMatchObject({ textureId: 'marble', textureDataUrl: null });
    expect(order.items[0].model.texture).toEqual({ source: 'library', ...marble });
    expect(order.items[0].model.priceLines.at(-1)).toEqual({ label: 'Picture texture', amount: 7, note: 'Marble' });

    // The order keeps its snapshot when the shop later renames or removes the texture.
    await request(app).put('/api/products/spiral-vase').set(admin).send({
      ...body, texture: { enabled: true, price: 7, options: [{ ...marble, id: 'marble-2', name: 'Renamed' }] },
    }).expect(200);
    const stored = (await request(app).get(`/api/orders/${order.id}`).set(admin).expect(200)).body as Order;
    expect(catalogModel(stored).texture).toEqual({ source: 'library', ...marble });

    await request(app).put('/api/products/spiral-vase').set(admin).send({
      ...body, texture: { enabled: true, price: 7, options: [marble], allowCustom: false },
    }).expect(200);
    const stale = await request(app).post('/api/orders').send(checkout([
      { productId: 'spiral-vase', customization: spiralVase({ textureId: 'removed' }), quantity: 1 },
      { productId: 'spiral-vase', customization: spiralVase({ textureDataUrl: 'data:image/png;base64,AA==' }), quantity: 1 },
    ])).expect(400);
    expect(stale.body.details).toEqual([
      expect.stringMatching(/^Item 1 \(Spiral Vase\): the chosen texture is no longer available/),
      expect.stringMatching(/^Item 2 \(Spiral Vase\): your own texture pictures are no longer accepted/),
    ]);
  });

  it('rejects texture libraries with external images or no texture source at all', async () => {
    const body = productBody();
    const option = { id: 'marble', name: 'Marble', url: '/api/media-files/0123456789abcdef01234567' };
    for (const url of ['https://images.example/marble.png', '//images.example/marble.png', 'javascript:alert(1)', '']) {
      await request(app).put('/api/products/spiral-vase').set(admin).send({
        ...body, texture: { enabled: true, price: 7, options: [{ ...option, url }] },
      }).expect(400);
    }
    const noSource = await request(app).put('/api/products/spiral-vase').set(admin).send({
      ...body, texture: { enabled: true, price: 7, options: [], allowCustom: false },
    }).expect(400);
    expect(noSource.body.details).toEqual(['Offer at least one shop texture or let customers upload their own picture.']);
    const duplicate = await request(app).put('/api/products/spiral-vase').set(admin).send({
      ...body, texture: { enabled: true, price: 7, options: [option, { ...option, name: 'Copy' }] },
    }).expect(400);
    expect(duplicate.body.details).toEqual(['Each shop texture needs a unique id.']);
  });

  it('stores 3D lettering placement and snapshots it with the customer text and clamped size', async () => {
    const body = productBody();
    const extrudedText = {
      x: 0, y: -55, z: 100, rotationDeg: 15, tiltDeg: 0, sizeMm: 12, depthMm: 1.5, lineSpacing: 1.2,
      horizontalAlign: 'center', verticalAlign: 'middle', defaultText: 'Hello',
    };
    await request(app).put('/api/products/spiral-vase').set(admin).send({
      ...body, decorationLayout: { extrudedText },
    }).expect(200);

    const { body: order } = await request(app).post('/api/orders').send(checkout([
      { productId: 'spiral-vase', customization: spiralVase({ extrudedText: 'Dla Ani  \n\n', extrudedSizeMm: 99 }), quantity: 1 },
      { productId: 'spiral-vase', customization: spiralVase(), quantity: 1 },
    ])).expect(201);
    // The shop placement travels with the order; the text is normalized and the size clamped.
    expect(order.items[0].model.decorationLayout?.extrudedText).toEqual(extrudedText);
    expect(order.items[0].model.customization).toMatchObject({ extrudedText: 'Dla Ani', extrudedSizeMm: 24 });
    expect(order.items[1].model.customization).not.toHaveProperty('extrudedText');

    const invalid = await request(app).post('/api/orders').send(checkout([
      { productId: 'spiral-vase', customization: spiralVase({ extrudedText: '日本' }), quantity: 1 },
    ])).expect(400);
    expect(invalid.body.details).toEqual([expect.stringMatching(/Item 1 .*Latin letters/)]);

    const badLayout = await request(app).put('/api/products/spiral-vase').set(admin).send({
      ...body, decorationLayout: { extrudedText: { ...extrudedText, tiltDeg: 180, defaultText: '№' } },
    }).expect(400);
    expect(badLayout.body.details).toEqual([
      '3D lettering: tilt must be between 0 and 90 degrees.',
      expect.stringContaining('3D lettering suggested text:'),
    ]);
  });

  it('prices orders on the server, ignoring any prices sent by the client', async () => {
    const order = checkout([
      {
        productId: 'spiral-vase',
        customization: spiralVase({ colorId: 'gold', engravingText: 'Anna  \n\n' }),
        quantity: 2,
        // Tampering attempt: unknown fields are stripped, prices are recomputed.
        ...({ unitPrice: 0.01 } as object),
      },
    ]);
    const { body } = await request(app).post('/api/orders').send(order).expect(201);
    // $4.63 estimated print + $3 Silk Gold + $5 engraving, × 2, plus $5 handling once.
    expect(body).toMatchObject({ status: 'received', source: 'catalog', price: { mode: 'fixed', total: 30.26, handlingFee: 5 }, currency: 'USD', adminNote: '' });
    expect(body.number).toMatch(/^PF-\d{6}-[A-HJ-NP-Z2-9]{4}$/);
    expect(body.items[0]).toMatchObject({
      model: { source: 'catalog', productName: 'Spiral Vase', sizeLabel: '110 × 110 × 200 mm', colorName: 'Silk Gold' },
      unitPrice: 12.63,
      lineTotal: 25.26,
    });
    expect(body.items[0].model.customization.engravingText).toBe('Anna');
    expect(body.items[0].model.priceLines.map((l: { label: string }) => l.label)).toEqual([
      'Print 110 × 110 × 200 mm',
      'Color: Silk Gold',
      'Engraving',
    ]);
  });

  it('snapshots per-part colors of multi-color models', async () => {
    const customization = spiralVase({ dimensions: { widthMm: 95.9, depthMm: 95.9, heightMm: 180 }, partColors: { 'material:Body:#1f8a8a': 'gold' } });
    const { body } = await request(app)
      .post('/api/orders')
      .send(checkout([{ productId: 'tricolor-star-vase', customization, quantity: 1 }]))
      .expect(201);
    expect(body.items[0].model.parts).toEqual([
      { key: 'material:Base:#2b2b2e', name: 'Base', colorName: 'Original', colorHex: '#2b2b2e' },
      { key: 'material:Body:#1f8a8a', name: 'Body', colorName: 'Silk Gold', colorHex: '#c9a227' },
      { key: 'material:Rim:#c9a227', name: 'Rim', colorName: 'Original', colorHex: '#c9a227' },
    ]);
  });

  it('lists every problem with the items at once', async () => {
    const { body } = await request(app)
      .post('/api/orders')
      .send(
        checkout([
          { productId: 'spiral-vase', customization: spiralVase({ dimensions: { widthMm: 150, depthMm: 150, heightMm: 300 } }), quantity: 1 },
          { productId: 'moon-lamp', customization: spiralVase(), quantity: 1 },
          { productId: 'spiral-vase', customization: spiralVase({ engravingText: '<b>hi</b>' }), quantity: 1 },
        ]),
      )
      .expect(400);
    expect(body.error).toBe('Some items in your order need attention.');
    expect(body.details).toEqual([
      expect.stringMatching(/^Item 1 \(Spiral Vase\): Height can be at most 270 mm/),
      'Item 2 (Moon Lamp Shade): this product is no longer available.',
      expect.stringMatching(/^Item 3 \(Spiral Vase\): Use letters/),
    ]);
    expect(await db.orders.list({ limit: 10 })).toEqual([]);
  });

  it('validates the customer details', async () => {
    const order = checkout([{ productId: 'spiral-vase', customization: spiralVase(), quantity: 1 }]);
    order.customer.email = 'not-an-email';
    order.customer.address.city = ' ';
    const { body } = await request(app).post('/api/orders').send(order).expect(400);
    expect(body.details).toEqual(['customer.email: Enter a valid email address.', 'customer.address.city: City is required.']);
  });

  it('keeps orders private to admins', async () => {
    const { body: order } = await request(app)
      .post('/api/orders')
      .send(checkout([{ productId: 'spiral-vase', customization: spiralVase(), quantity: 1 }]))
      .expect(201);
    await request(app).get('/api/orders').expect(401);
    await request(app).get(`/api/orders/${order.id}`).expect(401);
    await request(app).patch(`/api/orders/${order.id}`).send({ status: 'paid' }).expect(401);
    await request(app).delete(`/api/orders/${order.id}`).expect(401);
  });

  it('lists newest first, filters by status, and updates status and notes', async () => {
    const place = async () =>
      (
        await request(app)
          .post('/api/orders')
          .send(checkout([{ productId: 'spiral-vase', customization: spiralVase(), quantity: 1 }]))
          .expect(201)
      ).body as Order;
    const first = await place();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await place();

    const list = (await request(app).get('/api/orders').set(admin).expect(200)).body as Order[];
    expect(list.map((o) => o.id)).toEqual([second.id, first.id]);

    const updated = await request(app)
      .patch(`/api/orders/${first.id}`)
      .set(admin)
      .send({ status: 'shipped', adminNote: 'Tracking 123' })
      .expect(200);
    expect(updated.body).toMatchObject({ status: 'shipped', adminNote: 'Tracking 123', price: first.price });

    const shipped = (await request(app).get('/api/orders?status=shipped').set(admin).expect(200)).body as Order[];
    expect(shipped.map((o) => o.id)).toEqual([first.id]);
    await request(app).get('/api/orders?status=lost').set(admin).expect(400);
    await request(app).patch(`/api/orders/${first.id}`).set(admin).send({ status: 'lost' }).expect(400);
    await request(app).patch(`/api/orders/${first.id}`).set(admin).send({ total: 0 }).expect(400);

    await request(app).delete(`/api/orders/${second.id}`).set(admin).expect(204);
    await request(app).get(`/api/orders/${second.id}`).set(admin).expect(404);
  });
});

describe('sliced print variants', () => {
  const presets = { printer: 'Snapmaker U1 (0.4 nozzle)', process: '0.20 Standard @Snapmaker U1 (0.4 nozzle)', filament: 'Generic PLA @U1 0.4 nozzle' };
  const variant = (id: string, printMinutes: number, grams: number, enabled = true) => ({
    id, label: `Quality ${id}`, presets, nozzleMm: 0.4, layerHeightMm: 0.2, material: 'PLA' as const,
    measurements: { printMinutes, filaments: [{ material: 'PLA' as const, grams }] },
    sliced: { printMinutes: printMinutes + 1, filaments: [{ material: 'PLA' as const, grams }], slicedAt: '2026-11-08T10:00:00.000Z' },
    // the Star Vase Set scales from 60% to 140%
    scaled: [
      { scale: 0.6, measurements: { printMinutes: printMinutes / 4, filaments: [{ material: 'PLA' as const, grams: grams / 5 }] } },
      { scale: 1.4, measurements: { printMinutes: printMinutes * 2.5, filaments: [{ material: 'PLA' as const, grams: grams * 2.8 }] } },
    ],
    enabled,
  });
  const slicing = (plateId: number, variants: ReturnType<typeof variant>[]) => ({
    plateId, matrix: { printers: [presets.printer], processes: [presets.process], filaments: [presets.filament] },
    support: plateId === 1, overrides: { sparse_infill_density: '20%' }, variants, defaultVariantId: variants[0].id,
  });
  const setBody = () => ({
    ...productBody('star-vase-set'),
    slicing: [
      slicing(1, [variant('fine', 120, 100), variant('draft', 60, 40), variant('hidden', 5, 5, false)]),
      slicing(2, [variant('standard', 30, 20)]),
    ],
  });

  it('keeps the measurements for admins and publishes only labels and prices', async () => {
    const saved = (await request(app).put('/api/products/star-vase-set').set(admin).send(setBody()).expect(200)).body as Product;
    expect(saved.slicing?.[0].variants[0].measurements).toEqual({ printMinutes: 120, filaments: [{ material: 'PLA', grams: 100 }] });
    // default rates: $2/h, PLA $25/kg
    expect(saved.catalogPricing?.variantPrices).toEqual({ '1:fine': 6.5, '1:draft': 3, '2:standard': 1.5 });
    const published = (await request(app).get('/api/products/star-vase-set').expect(200)).body as Product;
    expect(published.slicing).toEqual([
      { plateId: 1, defaultVariantId: 'fine', variants: [
        { id: 'fine', label: 'Quality fine', nozzleMm: 0.4, layerHeightMm: 0.2, material: 'PLA', enabled: true },
        { id: 'draft', label: 'Quality draft', nozzleMm: 0.4, layerHeightMm: 0.2, material: 'PLA', enabled: true },
      ] },
      { plateId: 2, defaultVariantId: 'standard', variants: [
        { id: 'standard', label: 'Quality standard', nozzleMm: 0.4, layerHeightMm: 0.2, material: 'PLA', enabled: true },
      ] },
    ]);
    expect(published.catalogPricing).toMatchObject({ variantPrices: saved.catalogPricing?.variantPrices });
    // 30 min + 20 g and 300 min + 280 g
    expect(published.catalogPricing?.variantScalePrices?.['1:fine']).toEqual([{ scale: 0.6, price: 1.5 }, { scale: 1.4, price: 17 }]);
    expect(published.catalogPricing?.variantScalePrices).not.toHaveProperty('1:hidden');
    expect(published.catalogPricing).not.toHaveProperty('hourlyRate');
    const list = (await request(app).get('/api/products').expect(200)).body as Product[];
    expect(JSON.stringify(list)).not.toContain('Generic PLA @U1');
  });

  it('prices checkout from the chosen variants and snapshots how the shop prints each plate', async () => {
    await request(app).put('/api/products/star-vase-set').set(admin).send(setBody()).expect(200);
    const base = spiralVase({ dimensions: { widthMm: 117.6, depthMm: 95.9, heightMm: 180 } });
    const customization: Customization = {
      ...base,
      plates: { 1: { ...base, variantId: 'draft' }, 2: { ...base, variantId: 'hidden' } },
    };
    const { body: order } = await request(app).post('/api/orders').send(checkout([{ productId: 'star-vase-set', customization, quantity: 2 }])).expect(201);
    const [item] = order.items;
    // draft $3.00 + standard $1.50 (the disabled variant falls back to the default) at original size
    expect(item.model.priceLines[0]).toMatchObject({ amount: 4.5 });
    expect(item.model.customization.plates['2'].variantId).toBe('standard');
    expect(item.model.plates[0].appearance.printVariant).toEqual({
      id: 'draft', label: 'Quality draft', nozzleMm: 0.4, layerHeightMm: 0.2, material: 'PLA',
      presets, support: true, overrides: { sparse_infill_density: '20%' },
    });
    expect(item.model.plates[1].appearance.printVariant).toMatchObject({ id: 'standard', support: false });
    expect(order.price.total).toBe(item.lineTotal + order.price.handlingFee);

    // later rate changes reprice the catalog, not the placed order
    await request(app).put('/api/settings/pricing').set(admin).send({
      hourlyRate: 10, handlingFee: DEFAULT_PRICING.handlingFee, filamentPricePerKg: DEFAULT_PRICING.filamentPricePerKg,
    }).expect(200);
    const repriced = (await request(app).get('/api/products/star-vase-set').expect(200)).body as Product;
    expect(repriced.catalogPricing?.variantPrices?.['1:draft']).toBe(11);
    expect((await request(app).get(`/api/orders/${order.id}`).set(admin).expect(200)).body.price.total).toBe(order.price.total);
  });

  it('prices scaled sets from the variants sliced at that scale and keeps sizes within the shop range', async () => {
    await request(app).put('/api/products/star-vase-set').set(admin).send(setBody()).expect(200);
    const large = spiralVase({ dimensions: { widthMm: 164.6, depthMm: 134.3, heightMm: 252 } });
    const customization: Customization = { ...large, plates: { 1: { ...large, variantId: 'draft' }, 2: large } };
    const { body: order } = await request(app).post('/api/orders').send(checkout([{ productId: 'star-vase-set', customization, quantity: 1 }])).expect(201);
    // draft 150 min + 112 g = $7.80, standard 75 min + 56 g = $3.90 at 140%
    expect(order.items[0].model.priceLines[0]).toMatchObject({ amount: 11.7 });
    expect(order.items[0].model.priceLines[0].note).toContain('at 140% of the original size');

    const tooLarge = spiralVase({ dimensions: { widthMm: 176.4, depthMm: 143.9, heightMm: 270 } });
    const { body: error } = await request(app).post('/api/orders')
      .send(checkout([{ productId: 'star-vase-set', customization: { ...tooLarge, plates: { 1: tooLarge, 2: tooLarge } }, quantity: 1 }])).expect(400);
    expect(error.details).toEqual([expect.stringContaining('Choose a size from 60% to 140% of the original.')]);
  });

  it('requires variants sliced at the ends of the scale range', async () => {
    const body = setBody();
    body.scaling = { enabled: true, minScale: 0.5, maxScale: 1.4 };
    const { body: error } = await request(app).put('/api/products/star-vase-set').set(admin).send(body).expect(400);
    expect(error.details).toContainEqual('Vase, Quality fine: not sliced at 50%: slice the variants again after changing the scaling.');
    // fixed-size products need no other scales
    body.scaling = { enabled: false, minScale: 0.5, maxScale: 1.4 };
    body.slicing.forEach((entry) => entry.variants.forEach((v) => { delete (v as { scaled?: unknown }).scaled; }));
    await request(app).put('/api/products/star-vase-set').set(admin).send(body).expect(200);
    body.scaling = { enabled: true, minScale: 1.2, maxScale: 1.9 };
    const { body: rangeError } = await request(app).put('/api/products/star-vase-set').set(admin).send(body).expect(400);
    expect(rangeError.details).toEqual(expect.arrayContaining([
      'The smallest scale must be at most 100% and the largest at least 100%, and they must differ.',
      'At the largest scale the model must fit 270 mm: use at most 150%.',
    ]));
  });

  it('rejects variants that do not cover every included plate', async () => {
    const body = { ...setBody(), slicing: [setBody().slicing[0]] };
    const { body: error } = await request(app).put('/api/products/star-vase-set').set(admin).send(body).expect(400);
    expect(error.details).toEqual([expect.stringContaining('Mini vases')]);
    const zeroTime = setBody();
    zeroTime.slicing[1].variants[0].measurements.printMinutes = 0;
    expect((await request(app).put('/api/products/star-vase-set').set(admin).send(zeroTime).expect(400)).body.details)
      .toEqual([expect.stringContaining('print time must be greater than 0')]);
  });
});

describe('description images', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6AAAAAElFTkSuQmCC', 'base64');
  it('requires admin upload and publicly serves the original image with its detected MIME type', async () => {
    await request(app).post('/api/media-files').set('Content-Type', 'application/octet-stream').send(png).expect(401);
    const { body } = await request(app).post('/api/media-files').set(admin)
      .set('Content-Type', 'application/octet-stream').send(png).expect(201);
    expect(body.url).toMatch(/^\/api\/media-files\/[a-f0-9]{24}$/);
    const downloaded = await request(app).get(body.url).expect('Content-Type', 'image/png')
      .expect('X-Content-Type-Options', 'nosniff').expect(200);
    expect(downloaded.body).toEqual(png);
    await request(app).get('/api/media-files/not-an-id').expect(404);
    await request(app).get('/api/media-files/000000000000000000000000').expect(404);
  });
  it('rejects nonimages, SVG, truncated files, video uploads and oversized images', async () => {
    for (const data of [
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      Buffer.from('not an image'),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex'),
    ]) {
      await request(app).post('/api/media-files').set(admin)
        .set('Content-Type', 'application/octet-stream').send(data).expect(400);
    }
    await request(app).post('/api/media-files').set(admin)
      .set('Content-Type', 'application/octet-stream').send(Buffer.alloc(10 * 1024 * 1024 + 1)).expect(413);
  });
});

describe('model files', () => {
  const stl = Buffer.alloc(84 + 50); // header + one empty triangle

  const upload = async () =>
    (
      await request(app)
        .post('/api/model-files')
        .set(admin)
        .set('Content-Type', 'application/octet-stream')
        .set('X-File-Name', 'my vase.stl')
        .send(stl)
        .expect(201)
    ).body as { url: string };

  it('stores uploads (admin only) and serves them back', async () => {
    await request(app).post('/api/model-files').set('Content-Type', 'application/octet-stream').send(stl).expect(401);
    const { url } = await upload();
    expect(url).toMatch(/^\/api\/model-files\/[0-9a-f]{24}$/);
    const download = await request(app).get(url).buffer(true).expect(200);
    expect(Buffer.compare(download.body, stl)).toBe(0);
    expect(download.headers['cache-control']).toContain('immutable');
  });

  it('rejects files that are not models', async () => {
    await request(app)
      .post('/api/model-files')
      .set(admin)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('tiny'))
      .expect(400);
  });

  it('deletes a model file once the last product using it is gone', async () => {
    const { url } = await upload();
    const mesh = { url, format: 'stl' as const, fileName: 'my vase.stl', sizeBytes: stl.length, triangleCount: 1, parts: [] };
    const a = (await request(app).post('/api/products').set(admin).send({ ...productBody(), mesh }).expect(201)).body;
    const b = (await request(app).post('/api/products').set(admin).send({ ...productBody(), mesh }).expect(201)).body;

    await request(app).delete(`/api/products/${a.id}`).set(admin).expect(204);
    await request(app).get(url).expect(200); // still used by b
    await request(app).put(`/api/products/${b.id}`).set(admin).send({ ...productBody(), mesh: null }).expect(200);
    await request(app).get(url).expect(404);
  });
});

describe('printers warehouse', () => {
  const u1Model = { name: 'Snapmaker U1', manufacturer: 'Snapmaker', plate: { widthMm: 270, depthMm: 270, heightMm: 270 }, maxColors: 4 };
  const createModel = async (body: object = u1Model) =>
    (await request(app).post('/api/printer-models').set(admin).send(body).expect(201)).body as PrinterModelWithPrinters;
  const createPrinter = async (body: object) => (await request(app).post('/api/printers').set(admin).send(body).expect(201)).body as PrinterWithModel;
  const uploadProfiles = (id: string, data: Buffer, name = 'U1 profiles.zip') =>
    request(app).post(`/api/printer-models/${id}/profiles`).set(admin).set('Content-Type', 'application/octet-stream').set('X-File-Name', encodeURIComponent(name)).send(data);
  const presets = zipFile({
    'printer/Snapmaker U1 (0.4 nozzle).json': JSON.stringify({ type: 'machine', name: 'Snapmaker U1 (0.4 nozzle)', inherits: 'fdm_U1' }),
    'printer/fdm_U1.json': JSON.stringify({ type: 'machine', name: 'fdm_U1', instantiation: 'false' }),
    'process/0.20 Standard.json': JSON.stringify({ type: 'process', name: '0.20 Standard @Snapmaker U1 (0.4 nozzle)' }),
    'filament/Generic PLA.json': JSON.stringify({ type: 'filament', name: 'Generic PLA @U1 0.4 nozzle' }),
    'filament/': '',
    'readme.txt': 'Exported from OrcaSlicer',
    'broken.json': '{ not json',
  });

  beforeEach(() => deleteAllPrinters(db));

  it('is admin only', async () => {
    const model = await createModel();
    const printer = await createPrinter({ name: 'U1-01', modelId: model.id });
    for (const path of ['/api/printers', `/api/printers/${printer.id}`, '/api/printer-models', '/api/printer-models/templates', `/api/printer-models/${model.id}`, `/api/printer-models/${model.id}/profiles`]) {
      await request(app).get(path).expect(401);
    }
    await request(app).post('/api/printers').send({ name: 'x', modelId: model.id }).expect(401);
    await request(app).post('/api/printer-models').send(u1Model).expect(401);
    await request(app).put(`/api/printer-models/${model.id}`).send(u1Model).expect(401);
    await request(app).delete(`/api/printers/${printer.id}`).expect(401);
    await request(app).delete(`/api/printer-models/${model.id}`).expect(401);
    await request(app).post(`/api/printer-models/${model.id}/profiles`).set('Content-Type', 'application/octet-stream').send(presets).expect(401);
    expect(await db.printers.get(printer.id)).not.toBeNull();
    expect(await db.printerModels.get(model.id)).not.toBeNull();
  });

  it('adds, edits and deletes printer models with trimmed texts and unique names', async () => {
    const model = await createModel({ ...u1Model, name: ' Snapmaker U1 ', manufacturer: ' Snapmaker ', plate: { widthMm: 270.004, depthMm: 270, heightMm: 270 } });
    expect(model).toEqual({ id: expect.any(String), ...u1Model, profiles: null, printers: [], createdAt: expect.any(String), updatedAt: model.createdAt });
    await createModel({ ...u1Model, name: 'Bambu Lab A1 mini', manufacturer: undefined });
    expect((await request(app).get('/api/printer-models').set(admin).expect(200)).body.map((m: PrinterModelWithPrinters) => [m.name, m.manufacturer]))
      .toEqual([['Bambu Lab A1 mini', ''], ['Snapmaker U1', 'Snapmaker']]);
    const taken = await request(app).post('/api/printer-models').set(admin).send({ ...u1Model, name: 'snapmaker u1' }).expect(409);
    expect(taken.body.details).toEqual(['A printer model named "snapmaker u1" already exists. Model names must be unique.']);

    const { body: edited } = await request(app).put(`/api/printer-models/${model.id}`).set(admin).send({ ...u1Model, maxColors: 8 }).expect(200);
    expect(edited).toEqual({ ...model, maxColors: 8, updatedAt: expect.any(String) });
    expect((await request(app).get(`/api/printer-models/${model.id}`).set(admin).expect(200)).body).toEqual(edited);
    await request(app).put(`/api/printer-models/${model.id}`).set(admin).send({ ...u1Model, name: 'Bambu Lab A1 MINI' }).expect(409);
    await request(app).put('/api/printer-models/missing').set(admin).send(u1Model).expect(404);

    await request(app).delete(`/api/printer-models/${model.id}`).set(admin).expect(204);
    await request(app).delete(`/api/printer-models/${model.id}`).set(admin).expect(404);
    await request(app).get(`/api/printer-models/${model.id}`).set(admin).expect(404);
  });

  it('reports every problem of an invalid model at once', async () => {
    const { body } = await request(app).post('/api/printer-models').set(admin).send({
      name: ' ', manufacturer: 'x'.repeat(81), plate: { widthMm: 0, depthMm: 270, heightMm: 270 }, maxColors: 2.5,
    }).expect(400);
    expect(body.error).toBe('The printer model has problems.');
    expect(body.details).toEqual([
      'Enter the model name (up to 120 characters).',
      'The manufacturer can have at most 80 characters.',
      'Print plate width, depth and height must be between 1 and 5000 mm.',
      'Max colors must be a whole number from 1 to 64.',
    ]);
    await request(app).post('/api/printer-models').set(admin).send({ ...u1Model, maxColors: 0 }).expect(400);
    await request(app).post('/api/printer-models').set(admin).send({ ...u1Model, plate: { widthMm: 270, depthMm: 270 } }).expect(400);
    await request(app).post('/api/printer-models').set(admin).send({ ...u1Model, profiles: null }).expect(400);
  });

  it('offers known printers to start a model from', async () => {
    const { body: templates } = await request(app).get('/api/printer-models/templates').set(admin).expect(200);
    expect(templates).toContainEqual(u1Model);
    expect(templates.map((template: { name: string }) => template.name))
      .toEqual([...templates.map((template: { name: string }) => template.name)].sort((a, b) => a.localeCompare(b)));
    // Templates are not models of the warehouse.
    expect((await request(app).get('/api/printer-models').set(admin).expect(200)).body).toEqual([]);
  });

  it('adds, lists, edits and deletes printers of a model, which share its plate, colors and profiles', async () => {
    const u1 = await createModel();
    const a1 = await createModel({ ...u1Model, name: 'Bambu Lab A1 mini', plate: { widthMm: 180, depthMm: 180, heightMm: 180 } });
    const printer = await createPrinter({ name: '  U1-01 ', modelId: u1.id, location: ' Rack B ' });
    const { printers: _printers, ...u1Plain } = u1;
    expect(printer).toEqual({
      id: expect.any(String), name: 'U1-01', modelId: u1.id, location: 'Rack B', notes: '', model: u1Plain,
      createdAt: expect.any(String), updatedAt: printer.createdAt,
      // An empty queue: an order queued now would start now.
      queue: { length: 0, nextStart: expect.any(String) },
    });
    const second = await createPrinter({ name: 'U1-02', modelId: u1.id, notes: 'Spare' });
    expect((await request(app).get('/api/printer-models').set(admin)).body.find((m: PrinterModelWithPrinters) => m.id === u1.id).printers)
      .toEqual([{ id: printer.id, name: 'U1-01' }, { id: second.id, name: 'U1-02' }]);

    // A change to the model (and its profiles) shows on every printer of it.
    await request(app).put(`/api/printer-models/${u1.id}`).set(admin).send({ ...u1Model, plate: { widthMm: 271, depthMm: 271, heightMm: 260 }, maxColors: 8 }).expect(200);
    await uploadProfiles(u1.id, presets).expect(201);
    const { body: listed } = await request(app).get('/api/printers').set(admin).expect(200);
    expect(listed.map((p: PrinterWithModel) => [p.name, p.model?.plate.heightMm, p.model?.maxColors, p.model?.profiles?.fileName])).toEqual([
      ['U1-01', 260, 8, 'U1 profiles.zip'], ['U1-02', 260, 8, 'U1 profiles.zip'],
    ]);

    const taken = await request(app).post('/api/printers').set(admin).send({ name: 'u1-01', modelId: a1.id }).expect(409);
    expect(taken.body.details).toEqual(['A printer named "u1-01" already exists. Names must be unique.']);
    const { body: moved } = await request(app).put(`/api/printers/${second.id}`).set(admin).send({ name: 'A1-01', modelId: a1.id, location: 'Desk' }).expect(200);
    expect(moved).toEqual({
      ...second, name: 'A1-01', modelId: a1.id, location: 'Desk', notes: '', model: expect.objectContaining({ id: a1.id, maxColors: 4 }), updatedAt: expect.any(String),
      queue: { length: 0, nextStart: expect.any(String) },
    });
    expect((await request(app).get(`/api/printers/${second.id}`).set(admin).expect(200)).body).toEqual({ ...moved, queue: { length: 0, nextStart: expect.any(String) } });

    // Plate size, colors and profiles can't be set on a printer.
    await request(app).put(`/api/printers/${second.id}`).set(admin).send({ name: 'A1-01', modelId: a1.id, maxColors: 2 }).expect(400);
    await request(app).post('/api/printers').set(admin).send({ name: 'X', modelId: a1.id, plate: u1Model.plate }).expect(400);
    await request(app).post(`/api/printers/${second.id}/profiles`).set(admin).set('Content-Type', 'application/octet-stream').send(presets).expect(404);

    await request(app).put('/api/printers/missing').set(admin).send({ name: 'X', modelId: a1.id }).expect(404);
    await request(app).delete(`/api/printers/${printer.id}`).set(admin).expect(204);
    await request(app).delete(`/api/printers/${printer.id}`).set(admin).expect(404);
    await request(app).get(`/api/printers/${printer.id}`).set(admin).expect(404);
  });

  it('requires an existing model for a printer and reports every problem at once', async () => {
    const { body } = await request(app).post('/api/printers').set(admin).send({ name: ' ', modelId: '', location: 'x'.repeat(201) }).expect(400);
    expect(body.error).toBe('The printer has problems.');
    expect(body.details).toEqual([
      'Enter a name for the printer (up to 80 characters).',
      'Choose the printer model.',
      'The location can have at most 200 characters.',
    ]);
    expect((await request(app).post('/api/printers').set(admin).send({ name: 'U1-01', modelId: 'missing' }).expect(400)).body.details)
      .toEqual(['The chosen printer model does not exist any more. Choose another one.']);
    await request(app).post('/api/printers').set(admin).send({ name: 'U1-01' }).expect(400);
  });

  it('refuses to delete a model that printers use', async () => {
    const model = await createModel();
    const a = await createPrinter({ name: 'U1-01', modelId: model.id });
    await createPrinter({ name: 'U1-02', modelId: model.id });
    const { body } = await request(app).delete(`/api/printer-models/${model.id}`).set(admin).expect(409);
    expect(body.error).toBe('"Snapmaker U1" is the model of U1-01, U1-02. Delete these printers or give them another model first.');
    await request(app).delete(`/api/printers/${a.id}`).set(admin).expect(204);
    await request(app).delete(`/api/printer-models/${model.id}`).set(admin).expect(409);
    expect(await db.printerModels.get(model.id)).not.toBeNull();
  });

  it('uploads, replaces, downloads and removes a model\'s profile archive, listing its presets', async () => {
    const model = await createModel();
    const { body: withProfiles } = await uploadProfiles(model.id, presets, 'Snapmaker U1 profiles.orca_printer').expect(201);
    expect(withProfiles.profiles).toEqual({
      fileId: expect.stringMatching(/^[0-9a-f]{24}$/), fileName: 'Snapmaker U1 profiles.orca_printer', sizeBytes: presets.length, uploadedAt: expect.any(String),
      entries: [
        { name: 'printer/Snapmaker U1 (0.4 nozzle).json', sizeBytes: expect.any(Number) },
        { name: 'printer/fdm_U1.json', sizeBytes: expect.any(Number) },
        { name: 'process/0.20 Standard.json', sizeBytes: expect.any(Number) },
        { name: 'filament/Generic PLA.json', sizeBytes: expect.any(Number) },
        { name: 'readme.txt', sizeBytes: 24 },
        { name: 'broken.json', sizeBytes: 10 },
      ],
      presets: {
        machine: ['Snapmaker U1 (0.4 nozzle)', 'fdm_U1'],
        process: ['0.20 Standard @Snapmaker U1 (0.4 nozzle)'],
        filament: ['Generic PLA @U1 0.4 nozzle'],
      },
    });
    expect((await request(app).get(`/api/printer-models/${model.id}`).set(admin).expect(200)).body).toEqual(withProfiles);

    const download = await request(app).get(`/api/printer-models/${model.id}/profiles`).set(admin).buffer(true).parse(binaryParser).expect(200);
    expect(download.headers['content-type']).toBe('application/zip');
    expect(download.headers['content-disposition']).toBe("attachment; filename*=UTF-8''Snapmaker%20U1%20profiles.orca_printer");
    expect(download.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.compare(download.body, presets)).toBe(0);

    // Editing keeps the archive; a new upload replaces it and deletes the old file.
    const { body: edited } = await request(app).put(`/api/printer-models/${model.id}`).set(admin).send({ ...u1Model, maxColors: 2 }).expect(200);
    expect(edited.profiles).toEqual(withProfiles.profiles);
    const replacement = zipFile({ 'only.json': JSON.stringify({ type: 'filament', name: 'PETG' }) });
    const { body: replaced } = await uploadProfiles(model.id, replacement).expect(201);
    expect(replaced.profiles.fileName).toBe('U1 profiles.zip');
    expect(replaced.profiles.presets).toEqual({ machine: [], process: [], filament: ['PETG'] });
    expect(await db.printerFiles.find(withProfiles.profiles.fileId)).toBeNull();
    expect(await db.printerFiles.ids()).toEqual([replaced.profiles.fileId]);

    const { body: removed } = await request(app).delete(`/api/printer-models/${model.id}/profiles`).set(admin).expect(200);
    expect(removed.profiles).toBeNull();
    await request(app).delete(`/api/printer-models/${model.id}/profiles`).set(admin).expect(404);
    await request(app).get(`/api/printer-models/${model.id}/profiles`).set(admin).expect(404);
    expect(await db.printerFiles.ids()).toEqual([]);

    // Deleting the model deletes its archive.
    await uploadProfiles(model.id, replacement).expect(201);
    await request(app).delete(`/api/printer-models/${model.id}`).set(admin).expect(204);
    expect(await db.printerFiles.ids()).toEqual([]);
    await uploadProfiles('missing', replacement).expect(404);
  });

  it('rejects archives that are not ZIP files, empty archives and oversized uploads', async () => {
    const model = await createModel();
    for (const data of [Buffer.from('not a zip archive at all, just text'), Buffer.from('PK'), Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(40)])]) {
      expect((await uploadProfiles(model.id, data).expect(400)).body.error).toContain('ZIP');
    }
    expect((await uploadProfiles(model.id, zipFile({ 'folder/': '' })).expect(400)).body.error).toBe('The ZIP archive contains no files.');
    await request(app).post(`/api/printer-models/${model.id}/profiles`).set(admin).send({ zip: true }).expect(400);
    await uploadProfiles(model.id, Buffer.alloc(20 * 1024 * 1024 + 1)).expect(413);
    expect((await request(app).get(`/api/printer-models/${model.id}`).set(admin)).body.profiles).toBeNull();
    expect(await db.printerFiles.ids()).toEqual([]);
  });
});

/** Reads a binary response body into a Buffer (superagent has no parser for application/zip). */
function binaryParser(response: { on(event: string, listener: (chunk: Buffer) => void): unknown }, done: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => done(null, Buffer.concat(chunks)));
}

/** A ZIP archive with the given files (deflated, like real exports; names ending in "/" are folders). */
function zipFile(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.from(text, 'utf8');
    const deflated = data.length > 0 ? deflateRawSync(data) : Buffer.alloc(0);
    const method = data.length > 0 ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.concat([local, nameBytes, deflated]);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x800, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt32LE(crc32(data), 16);
    header.writeUInt32LE(deflated.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([header, nameBytes]));
    locals.push(entry);
    offset += entry.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
