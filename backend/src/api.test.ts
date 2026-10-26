import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSeedProducts } from './domain/data/seedProducts';
import type { Customization, Order, OrderInput, Product } from './domain/types';
import { createApp } from './app';
import { ensureIndexes, migrateDocuments, openDatabase, seedProducts, type Collections } from './db';

const TOKEN = 'test-admin-token';
const admin = { Authorization: `Bearer ${TOKEN}` };

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Collections;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongo.getUri());
  db = openDatabase(client.db('test'));
  await ensureIndexes(db);
  app = createApp({ db, adminToken: TOKEN });
}, 120_000);

afterAll(async () => {
  await client?.close();
  await mongo?.stop();
});

beforeEach(async () => {
  await db.orders.deleteMany({});
  await seedProducts(db, { reset: true });
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

const checkout = (items: OrderInput['items']): OrderInput => ({
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
    await db.products.updateOne({ id: 'twisted-star-vase' }, { $unset: { 'mesh.plates': '', 'mesh.plate': '' } });
    await migrateDocuments(db);
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
    expect(order.total).toBe(12); // Two complete sets: 2 × (4 + 16 × 0.5³).
    expect(order.items[0].plates).toEqual(plates.map(({ model: _model, ...plate }) => expect.objectContaining(plate)));
    expect(order.items[0].priceLines[0]).toMatchObject({
      amount: 6,
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
    expect(order.items[0].plates.map((plate: { appearance: { decorationLayout: unknown } }) => plate.appearance.decorationLayout)).toEqual([first, second]);
    expect(order.items[0].customization).not.toHaveProperty('decorationLayout');
    expect(order.items[0].customization.plates['1']).not.toHaveProperty('decorationLayout');
    await request(app).put('/api/products/twisted-star-vase').set(admin).send({
      ...updated, mesh: { ...updated.mesh, plates: plates.map((plate) => ({ ...plate, decorationLayout: {} })) },
    }).expect(200);
    const retained = (await request(app).get(`/api/orders/${order.id}`).set(admin).expect(200)).body as Order;
    expect(retained.items[0].plates?.map((plate) => plate.appearance?.decorationLayout)).toEqual([first, second]);
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
    expect(order.items[0].decorationLayout).toEqual({ text, texture });
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
    expect(order.total).toBe(29 + 3 + 5 + 3 + 7);
    expect(order.items[0].customization.plates).toEqual({
      '1': { ...first, engravingText: 'First' }, '2': second,
    });
    expect(order.items[0].plates).toMatchObject([
      { id: 1, appearance: { parts: [{ name: 'Body', colorName: 'Silk Gold' }], engravingColor: { name: 'Silk Gold' } } },
      { id: 2, appearance: { parts: [{ name: 'Body', colorName: 'Signal Red' }] } },
    ]);
    expect(order.items[0].priceLines.map((line: { label: string }) => line.label)).toEqual([
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
    // $32 at original size + $3 Silk Gold + $5 engraving = $40, × 2
    expect(body).toMatchObject({ status: 'pending', total: 80, currency: 'USD', adminNote: '' });
    expect(body.number).toMatch(/^PF-\d{6}-[A-HJ-NP-Z2-9]{4}$/);
    expect(body.items[0]).toMatchObject({
      productName: 'Spiral Vase',
      sizeLabel: '110 × 110 × 200 mm',
      colorName: 'Silk Gold',
      unitPrice: 40,
      lineTotal: 80,
    });
    expect(body.items[0].customization.engravingText).toBe('Anna');
    expect(body.items[0].priceLines.map((l: { label: string }) => l.label)).toEqual([
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
    expect(body.items[0].parts).toEqual([
      { name: 'Base', colorName: 'Original', colorHex: '#2b2b2e' },
      { name: 'Body', colorName: 'Silk Gold', colorHex: '#c9a227' },
      { name: 'Rim', colorName: 'Original', colorHex: '#c9a227' },
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
    expect(await db.orders.countDocuments()).toBe(0);
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
    expect(updated.body).toMatchObject({ status: 'shipped', adminNote: 'Tracking 123', total: first.total });

    const shipped = (await request(app).get('/api/orders?status=shipped').set(admin).expect(200)).body as Order[];
    expect(shipped.map((o) => o.id)).toEqual([first.id]);
    await request(app).get('/api/orders?status=lost').set(admin).expect(400);
    await request(app).patch(`/api/orders/${first.id}`).set(admin).send({ status: 'lost' }).expect(400);
    await request(app).patch(`/api/orders/${first.id}`).set(admin).send({ total: 0 }).expect(400);

    await request(app).delete(`/api/orders/${second.id}`).set(admin).expect(204);
    await request(app).get(`/api/orders/${second.id}`).set(admin).expect(404);
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
