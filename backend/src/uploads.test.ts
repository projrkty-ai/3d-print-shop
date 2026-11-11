import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createOrder } from './orders';
import {
  detectModelFormat, pruneCustomerFiles, UNCLAIMED_UPLOAD_TTL_MS, UPLOAD_CONFIRM_WINDOW_MS, type CustomerUpload,
} from './orders/upload';
import { modelSearchFromEnv } from './modelSearch';
import { createSeedPrintSettings, layerFitsNozzle, layerHeightRange, SEED_PROFILES, validatePrintSettings } from './domain/printSettings';
import type { Customer, Order, PrintSettings, UploadItemInput, UploadModel } from './domain/types';
import { seedPrintSettings, type Storage } from './storage';
import { deleteAllOrders, openTestStorage } from './storage/testStorage';

const TOKEN = 'test-admin-token';
const admin = { Authorization: `Bearer ${TOKEN}` };

const model = (name: string) => readFileSync(new URL(`../public/models/${name}`, import.meta.url));
const STL = model('twisted-star-vase.stl');
const THREE_MF = model('twisted-star-vase.3mf');
const ASCII_STL = Buffer.from('solid cube\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 1 0 0\n   vertex 0 1 0\n  endloop\n endfacet\nendsolid cube\n');

let db: Storage;
let stop: (() => Promise<void>) | undefined;
let app: ReturnType<typeof createApp>;
const search = modelSearchFromEnv({ MODEL_SEARCH_SOURCES: '' });

beforeAll(async () => {
  ({ storage: db, stop } = await openTestStorage('uploads'));
  app = createApp({ db, adminToken: TOKEN });
}, 120_000);

afterAll(async () => {
  await stop?.();
});

beforeEach(async () => {
  await deleteAllOrders(db);
  await seedPrintSettings(db, { reset: true });
});

const customer: Customer = {
  name: 'Anna Nowak',
  email: 'anna@example.com',
  address: { line1: 'Długa 1', city: 'Kraków', postalCode: '30-001', country: 'Poland' },
};

async function upload(data: Buffer, name?: string): Promise<CustomerUpload> {
  const req = request(app).post('/api/uploads').set('Content-Type', 'application/octet-stream');
  if (name !== undefined) req.set('X-File-Name', encodeURIComponent(name));
  return (await req.send(data).expect(201)).body as CustomerUpload;
}

/** A single-color model: 0.4 mm nozzle, 0.2 mm layers, black PLA. */
const line = ({ fileId, uploadKey }: CustomerUpload, quantity = 1): UploadItemInput => ({
  fileId, uploadKey, quantity, nozzleId: 'nozzle-0-4', layerHeightId: 'layer-0-2',
  parts: [{ key: 'model', name: 'Model', filamentId: 'pla', colorId: 'black' }],
});

function submit(items: UploadItemInput[], extra: { customerNote?: string } = {}) {
  return request(app).post('/api/orders').send({ source: 'upload', customer, items, ...extra });
}

/** The uploaded model of an order's item. */
const modelOf = (order: Order, index = 0) => order.items[index].model as UploadModel;

describe('model format detection', () => {
  it('recognizes binary and ASCII STL and 3MF packages by their contents', () => {
    expect(detectModelFormat(STL)).toBe('stl');
    expect(detectModelFormat(ASCII_STL)).toBe('stl');
    expect(detectModelFormat(THREE_MF)).toBe('3mf');
  });

  it('rejects other files, including truncated binary STL and ZIP archives without a 3D model', () => {
    expect(detectModelFormat(Buffer.from('hello world'))).toBeNull();
    expect(detectModelFormat(Buffer.alloc(84))).toBeNull(); // no triangles
    expect(detectModelFormat(STL.subarray(0, STL.length - 10))).toBeNull();
    expect(detectModelFormat(Buffer.from('solid but nothing else'))).toBeNull();
    expect(detectModelFormat(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('readme.txt')]))).toBeNull();
    expect(detectModelFormat(Buffer.from('%PDF-1.7 '.repeat(20)))).toBeNull();
  });
});

describe('print options', () => {
  it('are seeded with example nozzles, layer heights and filaments, publicly readable', async () => {
    const settings = (await request(app).get('/api/print-settings').expect(200)).body as PrintSettings;
    const { updatedAt: _u, ...seed } = createSeedPrintSettings();
    expect(settings).toMatchObject(seed);
    expect(settings.nozzles.map((n) => n.diameterMm)).toEqual([0.2, 0.4, 0.6, 0.8]);
    expect(settings.layerHeights.map((l) => l.heightMm)).toEqual([0.08, 0.12, 0.16, 0.2, 0.24, 0.28, 0.32, 0.4, 0.48, 0.56]);
    expect([settings.defaultNozzleId, settings.defaultLayerHeightId]).toEqual(['nozzle-0-4', 'layer-0-2']);
    expect(settings.filaments.map((f) => [f.name, f.pricePerKg, f.colors.length])).toEqual([
      ['PLA', 80, 8], ['PETG', 100, 5], ['Silk PLA', 120, 3], ['TPU 95A', 160, 3],
    ]);
    // Every example nozzle has layer heights it can print.
    for (const nozzle of settings.nozzles) {
      expect(settings.layerHeights.some((l) => layerFitsNozzle(l.heightMm, nozzle.diameterMm)), String(nozzle.diameterMm)).toBe(true);
    }
    // Seeding never overwrites the shop's own options unless asked to.
    await db.printSettings.put({ ...settings, defaultLayerHeightId: 'layer-0-12' });
    expect(await seedPrintSettings(db)).toBe(false);
    expect((await db.printSettings.get())?.defaultLayerHeightId).toBe('layer-0-12');
  });

  it('allow layer heights from a quarter to 0.8 × the nozzle diameter', () => {
    expect(layerHeightRange(0.4)).toEqual({ min: 0.1, max: 0.32000000000000006 });
    expect([0.09, 0.1, 0.2, 0.32, 0.33].map((h) => layerFitsNozzle(h, 0.4))).toEqual([false, true, true, true, false]);
    expect([0.14, 0.15, 0.48, 0.49].map((h) => layerFitsNozzle(h, 0.6))).toEqual([false, true, true, false]);
  });

  it('can be replaced by admins only, and are validated', async () => {
    const { updatedAt: _u, ...body } = createSeedPrintSettings();
    body.filaments[0] = { ...body.filaments[0], name: 'PLA+', pricePerKg: 90 };
    await request(app).put('/api/print-settings').send(body).expect(401);
    const saved = (await request(app).put('/api/print-settings').set(admin).send(body).expect(200)).body as PrintSettings;
    expect(saved.filaments[0]).toMatchObject({ name: 'PLA+', pricePerKg: 90 });
    expect(Date.parse(saved.updatedAt)).toBeGreaterThan(0);
    expect((await request(app).get('/api/print-settings').expect(200)).body).toEqual(saved);

    const broken = structuredClone(body);
    broken.nozzles.push({ id: 'nozzle-0-1', diameterMm: 0.1, priceMultiplier: 2 }); // needs 0.025–0.08 mm layers
    broken.layerHeights[0].heightMm = 0.09; // …and the only thin one is now too thick
    broken.nozzles[0].priceMultiplier = 0;
    broken.layerHeights[1].heightMm = 0.2; // duplicate of layer-0-2
    broken.filaments[1].colors = [];
    broken.filaments[2].colors[0].hex = 'gold';
    broken.filaments[3].pricePerKg = 0;
    broken.filaments[3].id = 'pla';
    const response = await request(app).put('/api/print-settings').set(admin).send(broken).expect(400);
    expect(response.body).toEqual({
      error: 'The print options have problems.',
      details: [
        'Nozzle 0.2 mm: price multiplier must be greater than 0 and at most 10.',
        'Each layer height can be listed only once.',
        'Nozzle 0.1 mm: add a layer height between 0.025 and 0.08 mm (a quarter to 0.8 × the diameter).',
        'Each filament type needs a unique id.',
        'PETG: add at least one color.',
        'Color Gold: "gold" is not a valid hex color.',
        'TPU 95A: price per kilogram must be greater than 0.',
      ],
    });
    // The default layer height must suit the default nozzle: 0.08 mm is too thin for 0.4 mm.
    const mismatch = await request(app).put('/api/print-settings').set(admin)
      .send({ ...body, defaultLayerHeightId: 'layer-0-08' }).expect(400);
    expect(mismatch.body.details).toEqual(['The default layer height must fit the default nozzle (a quarter to 0.8 × its diameter).']);
    const empty = await request(app).put('/api/print-settings').set(admin)
      .send({ ...body, nozzles: [], layerHeights: [], filaments: [] }).expect(400);
    expect(empty.body.details).toEqual([
      'Add at least one nozzle diameter.', 'Add at least one layer height.', 'Add at least one filament type.',
    ]);
    expect((await request(app).get('/api/print-settings').expect(200)).body).toEqual(saved);
  });

  it('upgrades options saved with qualities and prices per gram, keeping the filaments', async () => {
    const legacy = {
      qualities: [
        { id: 'draft', name: 'Draft', layerHeightMm: 0.28, priceMultiplier: 0.8 },
        { id: 'fine', name: 'Fine', layerHeightMm: 0.12, priceMultiplier: 1.5 },
        { id: 'ultra', name: 'Ultra', layerHeightMm: 0.04, priceMultiplier: 3 },
      ],
      defaultQualityId: 'fine',
      filaments: [{ id: 'pla', name: 'House PLA', description: '', pricePerGram: 0.085, densityGPerCm3: 1.24, colors: [{ id: 'black', name: 'Black', hex: '#111111' }] }],
      updatedAt: '2026-11-01T00:00:00.000Z',
    };
    await db.printSettings.put(legacy as unknown as PrintSettings);
    expect(await seedPrintSettings(db)).toBe(true);
    const upgraded = (await db.printSettings.get())!;
    expect(upgraded).toEqual({
      // every bundled slicer preset is offered until the admin chooses
      profiles: SEED_PROFILES,
      nozzles: [{ id: 'nozzle-0-4', diameterMm: 0.4, priceMultiplier: 1 }],
      defaultNozzleId: 'nozzle-0-4',
      // 0.04 mm can't be printed with a 0.4 mm nozzle, so it is dropped.
      layerHeights: [{ id: 'draft', heightMm: 0.28, priceMultiplier: 0.8 }, { id: 'fine', heightMm: 0.12, priceMultiplier: 1.5 }],
      defaultLayerHeightId: 'fine',
      filaments: [{ id: 'pla', name: 'House PLA', description: '', pricePerKg: 85, densityGPerCm3: 1.24, colors: legacy.filaments[0].colors }],
      updatedAt: '2026-11-01T00:00:00.000Z',
    });
    expect(validatePrintSettings(upgraded)).toEqual([]);
    expect(await seedPrintSettings(db)).toBe(false);
  });

  it('snapshots the chosen nozzle, layer height and a filament per color part, and rejects withdrawn or unfit choices', async () => {
    const project = await upload(THREE_MF, 'tricolor.3mf');
    const parts = [
      { key: 'material:Red:#ff0000', name: 'Red', filamentId: 'pla', colorId: 'red' },
      { key: 'material:Gold:#c9a227', name: 'Rim', filamentId: 'silk-pla', colorId: 'gold' },
    ];
    const created = (await submit([{ ...line(project), nozzleId: 'nozzle-0-6', layerHeightId: 'layer-0-4', parts }]).expect(201))
      .body as Order;
    expect(modelOf(created).nozzle).toEqual({ id: 'nozzle-0-6', diameterMm: 0.6, priceMultiplier: 0.9 });
    expect(modelOf(created).layerHeight).toEqual({ id: 'layer-0-4', heightMm: 0.4, priceMultiplier: 0.7 });
    expect(modelOf(created).parts?.map((part) => [part.key, part.filament.name, part.filament.pricePerKg, part.color.name])).toEqual([
      ['material:Red:#ff0000', 'PLA', 80, 'Red'],
      ['material:Gold:#c9a227', 'Silk PLA', 120, 'Gold'],
    ]);
    // Later price changes don't alter the order.
    const settings = (await db.printSettings.get())!;
    await db.printSettings.put({ ...settings, filaments: settings.filaments.map((f) => ({ ...f, pricePerKg: 1000 })) });
    expect(modelOf((await db.orders.get(created.id))!).parts?.[0].filament.pricePerKg).toBe(80);

    const stl = await upload(STL, 'vase.stl');
    // 0.4 mm layers are thicker than 0.8 × a 0.4 mm nozzle.
    const unfit = await submit([{ ...line(stl), layerHeightId: 'layer-0-4' }]).expect(400);
    expect(unfit.body.details).toEqual([
      "File 1: a 0.4 mm layer height can't be printed with a 0.4 mm nozzle; choose 0.1–0.32 mm.",
    ]);
    const withdrawn = await submit([{
      ...line(stl), nozzleId: 'nozzle-9', layerHeightId: 'layer-9',
      parts: [{ key: 'model', name: 'Model', filamentId: 'petg', colorId: 'gold' }, { key: 'lid', name: 'Lid', filamentId: 'nylon', colorId: 'black' }],
    }]).expect(400);
    expect(withdrawn.body).toEqual({
      error: 'Some print options need attention.',
      details: [
        'File 1: the chosen nozzle is no longer offered. Please choose again.',
        'File 1: the chosen layer height is no longer offered. Please choose again.',
        'File 1: Model: the chosen color is no longer available for this filament. Please choose again.',
        'File 1: Lid: the chosen filament is no longer offered. Please choose again.',
      ],
    });
    // Nothing was claimed: the upload can still be used once the customer chooses again.
    expect((await db.customerFiles.find(stl.fileId))?.metadata.orderId).toBeUndefined();
    await submit([{ ...line(stl), parts: [{ key: 'a', name: 'A', filamentId: 'pla', colorId: 'red' }, { key: 'a', name: 'B', filamentId: 'pla', colorId: 'red' }] }])
      .expect(400);
    await submit([{ ...line(stl), parts: [] }]).expect(400);
    await submit([line(stl)]).expect(201);
  });
});

describe('orders of uploaded models', () => {
  it('accepts customer uploads without an admin key, keeping the name and detecting the format', async () => {
    const stl = await upload(STL, 'wazon łódź.stl');
    expect(stl).toMatchObject({ fileName: 'wazon łódź.stl', format: 'stl', sizeBytes: STL.length });
    expect(stl.fileId).toMatch(/^[0-9a-f]{24}$/);
    expect(stl.uploadKey.length).toBeGreaterThanOrEqual(32);
    // Only a hash of the upload key is stored.
    expect(JSON.stringify((await db.customerFiles.find(stl.fileId))?.metadata)).not.toContain(stl.uploadKey);
    expect(await upload(THREE_MF, 'project.3MF')).toMatchObject({ fileName: 'project.3MF', format: '3mf' });
    expect(await upload(ASCII_STL)).toMatchObject({ fileName: 'model.stl', format: 'stl' });
    expect(await upload(STL, 'no-extension')).toMatchObject({ fileName: 'no-extension.stl' });
  });

  it('rejects uploads that are empty, not models, or named with the other format', async () => {
    const post = () => request(app).post('/api/uploads').set('Content-Type', 'application/octet-stream');
    await post().send(Buffer.alloc(0)).expect(400);
    await request(app).post('/api/uploads').set('Content-Type', 'application/json').send({ a: 1 }).expect(400);
    const notModel = await post().set('X-File-Name', 'photo.stl').send(Buffer.from('not a model at all')).expect(400);
    expect(notModel.body.error).toBe('This does not look like an STL or 3MF file.');
    const mismatch = await post().set('X-File-Name', 'vase.3mf').send(STL).expect(400);
    expect(mismatch.body.error).toBe('The file contents do not match its .3mf extension.');
    expect(await db.customerFiles.ids()).toEqual([]);
  });

  it('places an order that needs a quote, with its files claimed', async () => {
    const stl = await upload(STL, 'vase.stl');
    const project = await upload(THREE_MF, 'lid.3mf');
    const response = await submit([line(stl, 3), line(project)], { customerNote: '  PETG, black please  ' }).expect(201);
    const created = response.body as Order;
    expect(response.headers.location).toBe(`/api/orders/${created.id}`);
    expect(created).toMatchObject({
      status: 'received', source: 'upload', currency: 'USD', adminNote: '', customer, customerNote: 'PETG, black please',
      price: { mode: 'quote', handlingFee: 5, estimated: null, reviewed: null, total: null },
      items: [
        { model: { source: 'upload', fileId: stl.fileId, fileName: 'vase.stl', format: 'stl', sizeBytes: STL.length }, quantity: 3, unitPrice: null, lineTotal: null },
        { model: { source: 'upload', fileId: project.fileId, fileName: 'lid.3mf', format: '3mf', sizeBytes: THREE_MF.length }, quantity: 1 },
      ],
    });
    expect(modelOf(created).nozzle).toEqual({ id: 'nozzle-0-4', diameterMm: 0.4, priceMultiplier: 1 });
    expect(modelOf(created).layerHeight).toEqual({ id: 'layer-0-2', heightMm: 0.2, priceMultiplier: 1 });
    expect(modelOf(created).parts).toEqual([{
      key: 'model', name: 'Model',
      filament: { id: 'pla', name: 'PLA', pricePerKg: 80, densityGPerCm3: 1.24 },
      color: { id: 'black', name: 'Black', hex: '#1c1c1e' },
    }]);
    expect(created.number).toMatch(/^CP-\d{6}-[A-HJ-NP-Z2-9]{4}$/);
    expect(JSON.stringify(created)).not.toContain(stl.uploadKey);
    expect(await db.orders.get(created.id)).toEqual(created);
    expect((await db.customerFiles.find(stl.fileId))?.metadata.orderId).toBe(created.id);
    expect(await db.logBook.list(created.id)).toEqual([expect.objectContaining({ type: 'status', from: null, to: 'received' })]);

    // The same upload can't be used again, by this or anybody else's order.
    const again = await submit([line(stl)]).expect(409);
    expect(again.body.details).toEqual(['File 1 (vase.stl): this upload already belongs to another order. Please upload the file again.']);
    expect(await db.orders.list({ limit: 10 })).toHaveLength(1);
  });

  it('requires the upload key, so other uploads cannot be attached by id', async () => {
    const stl = await upload(STL, 'vase.stl');
    const response = await submit([{ ...line(stl), uploadKey: 'x'.repeat(32) }, line(stl)]).expect(400);
    expect(response.body.details).toEqual(['items: Each uploaded file can be included only once.']);
    const wrongKey = await submit([{ ...line(stl), uploadKey: 'x'.repeat(32) }]).expect(409);
    expect(wrongKey.body).toEqual({
      error: 'Some of your uploaded files need attention.',
      details: ['File 1: the upload has expired or was not found. Please upload the file again.'],
    });
    await submit([{ ...line(stl), fileId: '000000000000000000000000' }]).expect(409);
    expect((await db.customerFiles.find(stl.fileId))?.metadata.orderId).toBeUndefined();
    expect(await db.orders.list({ limit: 10 })).toEqual([]);
  });

  it('validates contact details, quantities and the number of files', async () => {
    const stl = await upload(STL);
    const invalid = await request(app).post('/api/orders').send({
      source: 'upload', customer: { ...customer, name: ' ', email: 'nope' }, items: [line(stl, 0)],
    }).expect(400);
    expect(invalid.body.details).toEqual(expect.arrayContaining([
      'customer.name: Name is required.', 'customer.email: Enter a valid email address.', expect.stringMatching(/^items\.0\.quantity: /),
    ]));
    expect((await submit([]).expect(400)).body.details).toEqual(['items: Add at least one model file.']);
    const many = Array.from({ length: 11 }, (_, i) => ({ ...line(stl), fileId: `${i}`.padStart(24, 'a') }));
    expect((await submit(many).expect(400)).body.details).toContain('items: Send at most 10 files per order.');
    await submit([line(stl, 21)]).expect(400);
  });

  it('keeps the files private to admins', async () => {
    const stl = await upload(STL, 'wazon łódź.stl');
    const { id } = (await submit([line(stl)]).expect(201)).body as Order;
    await request(app).get(`/api/orders/${id}/files/${stl.fileId}`).expect(401);
    // Customer uploads never appear among the public model files.
    await request(app).get(`/api/model-files/${stl.fileId}`).expect(404);

    const download = await request(app).get(`/api/orders/${id}/files/${stl.fileId}`).set(admin).buffer(true).expect(200);
    expect(Buffer.compare(download.body as Buffer, STL)).toBe(0);
    expect(download.headers['content-disposition']).toBe(`attachment; filename="wazon __d_.stl"; filename*=UTF-8''${encodeURIComponent('wazon łódź.stl')}`);
    expect(download.headers['cache-control']).toBe('private, no-store');
    // Only files of that order are served.
    const other = await upload(STL);
    await request(app).get(`/api/orders/${id}/files/${other.fileId}`).set(admin).expect(404);
    await request(app).get(`/api/orders/missing/files/${stl.fileId}`).set(admin).expect(404);
  });

  it('deletes the files together with the order', async () => {
    const first = (await submit([line(await upload(STL))]).expect(201)).body as Order;
    const stl = await upload(STL);
    const second = (await submit([line(stl, 2)]).expect(201)).body as Order;
    await request(app).delete(`/api/orders/${second.id}`).set(admin).expect(204);
    expect(await db.customerFiles.find(stl.fileId)).toBeNull();
    expect(await db.orders.get(first.id)).not.toBeNull();
    expect(await db.customerFiles.find(modelOf(first).fileId)).not.toBeNull();
  });

  it('cleans up uploads that were never confirmed, once they are old enough', async () => {
    const confirmed = await upload(STL);
    await submit([line(confirmed)]).expect(201);
    const abandoned = await upload(STL);
    expect(await pruneCustomerFiles(db)).toBe(0);
    const later = Date.now() + UNCLAIMED_UPLOAD_TTL_MS + 1000;
    expect(await pruneCustomerFiles(db, { now: later })).toBe(1);
    expect(await db.customerFiles.find(abandoned.fileId)).toBeNull();
    expect(await db.customerFiles.find(confirmed.fileId)).not.toBeNull();
    // An expired upload is reported as such when the customer finally confirms.
    expect((await submit([line(abandoned)]).expect(409)).body.details[0]).toContain('expired');
  });

  it('refuses to confirm uploads close to cleanup, so cleanup never races a confirmation', async () => {
    expect(UPLOAD_CONFIRM_WINDOW_MS).toBeLessThan(UNCLAIMED_UPLOAD_TTL_MS);
    const stl = await upload(STL);
    const late = new Date(Date.now() + UPLOAD_CONFIRM_WINDOW_MS + 1000);
    await expect(createOrder(db, search, { source: 'upload', customer, items: [line(stl)] }, late)).rejects.toMatchObject({
      status: 409, details: ['File 1: the upload has expired or was not found. Please upload the file again.'],
    });
    expect((await db.customerFiles.find(stl.fileId))?.metadata.orderId).toBeUndefined();
    const inTime = new Date(Date.now() + UPLOAD_CONFIRM_WINDOW_MS - 60_000);
    expect((await createOrder(db, search, { source: 'upload', customer, items: [line(stl)] }, inTime)).items).toHaveLength(1);
  });
});

describe('sliced uploads', () => {
  const profile = {
    printer: 'Snapmaker U1 (0.4 nozzle)', process: '0.20 Standard @Snapmaker U1 (0.4 nozzle)', filament: 'Generic PLA @U1 0.4 nozzle',
    support: true, scale: 1.5,
  };
  const rates = { hourlyRate: 3, handlingFee: 4.5, filamentPricePerKg: { PLA: 20, PETG: 30, ABS: 25, ASA: 35, TPU: 50, resin: 60 } };
  /** Two color parts: red in PLA ($80/kg), white in PETG ($100/kg). */
  const parts = [
    { key: 'filament:1', name: 'Red', filamentId: 'pla', colorId: 'red' },
    { key: 'filament:2', name: 'White', filamentId: 'petg', colorId: 'white' },
  ];
  // 90 min ($4.50) + 50 g PLA ($4.00) + 20 g PETG ($2.00) = $10.50 a copy
  const estimate = { printMinutes: 90, filaments: [{ key: 'filament:1', grams: 50 }, { key: 'filament:2', grams: 20 }] };
  const sliced = ({ fileId, uploadKey }: CustomerUpload, quantity = 2): UploadItemInput => ({
    fileId, uploadKey, quantity, profile, estimate, parts,
  });

  beforeEach(async () => {
    await request(app).put('/api/settings/pricing').set(admin).send(rates).expect(200);
  });

  it('offers every bundled slicer preset and lets admins narrow them down', async () => {
    const settings = (await request(app).get('/api/print-settings').expect(200)).body as PrintSettings;
    expect(settings.profiles).toEqual(SEED_PROFILES);
    const { updatedAt: _u, ...body } = settings;
    const narrowed = { ...body, profiles: { ...SEED_PROFILES, printers: [profile.printer] } };
    expect((await request(app).put('/api/print-settings').set(admin).send(narrowed).expect(200)).body.profiles.printers).toEqual([profile.printer]);
    const empty = { ...body, profiles: { ...SEED_PROFILES, processes: [] } };
    expect((await request(app).put('/api/print-settings').set(admin).send(empty).expect(400)).body.details)
      .toEqual(['Offer at least one printer, process and filament preset for slicing.']);
  });

  it('prices the browser slicing before sending, and stores the profile, scale and estimate with the order', async () => {
    const quote = (await request(app).post('/api/uploads/estimate')
      .send({ items: [{ quantity: 2, parts: parts.map(({ key, filamentId }) => ({ key, filamentId })), estimate }] }).expect(200)).body;
    expect(quote).toEqual({ items: [{ unitPrice: 10.5 }], handlingFee: 4.5, total: 25.5, currency: 'USD' });
    await request(app).post('/api/uploads/estimate').send({ items: [{ quantity: 1, parts: [{ key: 'model', filamentId: 'gold' }], estimate }] }).expect(400);

    const created = (await submit([sliced(await upload(THREE_MF, 'duo.3mf'))]).expect(201)).body as Order;
    expect(modelOf(created)).toMatchObject({ profile });
    expect(created.items[0].estimate).toEqual({ ...estimate, unitPrice: 10.5 });
    expect(modelOf(created)).not.toHaveProperty('nozzle');
    expect(created.price).toEqual({ mode: 'quote', handlingFee: 4.5, estimated: 25.5, reviewed: null, total: null });

    const unknown = await submit([{ ...sliced(await upload(STL, 'a.stl')), profile: { ...profile, printer: 'Mystery printer', scale: 50 } }]).expect(400);
    expect(unknown.body.details).toEqual([
      'File 1: the slicing preset "Mystery printer" is not offered.',
      'File 1: the scale must be from 1% to 1000%.',
    ]);
    const { profile: _p, ...withoutProfile } = sliced(await upload(STL, 'b.stl'));
    expect((await submit([withoutProfile]).expect(400)).body.details).toEqual(['File 1: choose a slicing profile.']);
  });

  it('prices the shop\'s measurements of every file by its parts\' filaments, and the order from them', async () => {
    const created = (await submit([sliced(await upload(THREE_MF, 'duo.3mf')), sliced(await upload(STL, 'vase.stl'), 1)]).expect(201)).body as Order;
    // admin result: 120 min ($6.00) + 60 g PLA ($4.80) + 25 g PETG ($2.50) = $13.30 a copy
    const review = { printMinutes: 120, filaments: [{ key: 'filament:1', grams: 60 }, { key: 'filament:2', grams: 25 }] };
    const path = `/api/orders/${created.id}/items/0/review`;
    await request(app).put(path).send(review).expect(401);
    const once = (await request(app).put(path).set(admin)
      .send({ ...review, sliced: { ...review, printMinutes: 118, slicedAt: '2026-11-09T10:00:00.000Z' } }).expect(200)).body as Order;
    expect(once.items[0].review).toMatchObject({
      printMinutes: 120, hourlyRate: 3, printTimeCost: 6, filamentCost: 7.3, unitPrice: 13.3, sliced: { printMinutes: 118 },
      filaments: [
        { key: 'filament:1', label: 'Red: PLA Red', grams: 60, pricePerKg: 80, cost: 4.8 },
        { key: 'filament:2', label: 'White: PETG White', grams: 25, pricePerKg: 100, cost: 2.5 },
      ],
    });
    expect(once.price.reviewed).toBeNull();
    const both = (await request(app).put(`/api/orders/${created.id}/items/1/review`).set(admin)
      .send({ printMinutes: 60, filaments: [{ key: 'filament:1', grams: 10 }] }).expect(200)).body as Order;
    // handling + 2 × $13.30 + 1 × ($3.00 + $0.80)
    expect(both.price.reviewed).toBe(34.9);
    expect((await db.orders.get(created.id))?.price.reviewed).toBe(34.9);
    await request(app).put(`/api/orders/${created.id}/items/5/review`).set(admin).send(review).expect(404);
    await request(app).put(path).set(admin).send({ printMinutes: -1, filaments: [] }).expect(400);
    // Materials are not filaments of an uploaded model with parts.
    expect((await request(app).put(path).set(admin).send({ printMinutes: 5, filaments: [{ key: 'PLA', grams: 5 }] }).expect(400)).body.details)
      .toEqual(['Unknown filament "PLA" for this model.']);
    // the admin then quotes it
    const quoted = (await request(app).patch(`/api/orders/${created.id}`).set(admin).send({ price: both.price.reviewed, status: 'quoted' }).expect(200)).body as Order;
    expect(quoted.price.total).toBe(34.9);
    expect(quoted.status).toBe('quoted');
  });

  it('accepts print requests from storefronts of the previous version', async () => {
    const stl = await upload(STL, 'old.stl');
    const legacy = (await request(app).post('/api/custom-orders/files').set('Content-Type', 'application/octet-stream').send(STL).expect(201)).body as CustomerUpload;
    const { filaments, ...rest } = estimate;
    const oldEstimate = { ...rest, parts: filaments };
    expect((await request(app).post('/api/custom-orders/estimate')
      .send({ files: [{ quantity: 2, parts: parts.map(({ key, filamentId }) => ({ key, filamentId })), estimate: oldEstimate }] }).expect(200)).body)
      .toMatchObject({ total: 25.5, items: [{ unitPrice: 10.5 }], files: [{ unitPrice: 10.5 }] });
    const response = await request(app).post('/api/custom-orders').send({
      customer, customerNote: 'old storefront',
      files: [{ ...sliced(stl), estimate: oldEstimate }, { ...sliced(legacy), estimate: oldEstimate }],
    }).expect(201);
    const order = response.body as Order;
    expect(response.headers.location).toBe(`/api/orders/${order.id}`);
    expect(order).toMatchObject({ source: 'upload', status: 'received', customerNote: 'old storefront', price: { estimated: 46.5 } });
    expect(order.items[0].estimate).toEqual({ ...estimate, unitPrice: 10.5 });
    // with the fields such a storefront reads from its confirmation
    expect(response.body).toMatchObject({
      estimatedPrice: 46.5, quotedPrice: null,
      files: [{ fileId: stl.fileId, fileName: 'old.stl', quantity: 2, estimate: { ...oldEstimate, unitPrice: 10.5 } }, { fileId: legacy.fileId }],
    });
  });
});
