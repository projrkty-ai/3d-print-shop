import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import {
  createCustomOrder, detectModelFormat, pruneCustomerFiles, UNCLAIMED_UPLOAD_TTL_MS, UPLOAD_CONFIRM_WINDOW_MS, type CustomerUpload,
} from './customOrders';
import { createSeedPrintSettings, layerFitsNozzle, layerHeightRange, validatePrintSettings } from './domain/printSettings';
import type { CustomOrder, CustomOrderInput, PrintSettings } from './domain/types';
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

beforeAll(async () => {
  ({ storage: db, stop } = await openTestStorage('custom-orders'));
  app = createApp({ db, adminToken: TOKEN });
}, 120_000);

afterAll(async () => {
  await stop?.();
});

beforeEach(async () => {
  await deleteAllOrders(db);
  await seedPrintSettings(db, { reset: true });
});

const customer: CustomOrderInput['customer'] = {
  name: 'Anna Nowak',
  email: 'anna@example.com',
  address: { line1: 'Długa 1', city: 'Kraków', postalCode: '30-001', country: 'Poland' },
};

async function upload(data: Buffer, name?: string): Promise<CustomerUpload> {
  const req = request(app).post('/api/custom-orders/files').set('Content-Type', 'application/octet-stream');
  if (name !== undefined) req.set('X-File-Name', encodeURIComponent(name));
  return (await req.send(data).expect(201)).body as CustomerUpload;
}

/** A single-color model: 0.4 mm nozzle, 0.2 mm layers, black PLA. */
const line = ({ fileId, uploadKey }: CustomerUpload, quantity = 1): CustomOrderInput['files'][number] => ({
  fileId, uploadKey, quantity, nozzleId: 'nozzle-0-4', layerHeightId: 'layer-0-2',
  parts: [{ key: 'model', name: 'Model', filamentId: 'pla', colorId: 'black' }],
});

function submit(files: CustomOrderInput['files'], extra: Partial<CustomOrderInput> = {}) {
  return request(app).post('/api/custom-orders').send({ customer, files, ...extra });
}

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
      .body as CustomOrder;
    expect(created.files[0].nozzle).toEqual({ id: 'nozzle-0-6', diameterMm: 0.6, priceMultiplier: 0.9 });
    expect(created.files[0].layerHeight).toEqual({ id: 'layer-0-4', heightMm: 0.4, priceMultiplier: 0.7 });
    expect(created.files[0].parts?.map((part) => [part.key, part.filament.name, part.filament.pricePerKg, part.color.name])).toEqual([
      ['material:Red:#ff0000', 'PLA', 80, 'Red'],
      ['material:Gold:#c9a227', 'Silk PLA', 120, 'Gold'],
    ]);
    // Later price changes don't alter the request.
    const settings = (await db.printSettings.get())!;
    await db.printSettings.put({ ...settings, filaments: settings.filaments.map((f) => ({ ...f, pricePerKg: 1000 })) });
    expect((await db.customOrders.get(created.id))?.files[0].parts?.[0].filament.pricePerKg).toBe(80);

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

describe('custom print requests', () => {
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
    const post = () => request(app).post('/api/custom-orders/files').set('Content-Type', 'application/octet-stream');
    await post().send(Buffer.alloc(0)).expect(400);
    await request(app).post('/api/custom-orders/files').set('Content-Type', 'application/json').send({ a: 1 }).expect(400);
    const notModel = await post().set('X-File-Name', 'photo.stl').send(Buffer.from('not a model at all')).expect(400);
    expect(notModel.body.error).toBe('This does not look like an STL or 3MF file.');
    const mismatch = await post().set('X-File-Name', 'vase.3mf').send(STL).expect(400);
    expect(mismatch.body.error).toBe('The file contents do not match its .3mf extension.');
    expect(await db.customerFiles.ids()).toEqual([]);
  });

  it('persists a confirmed request for review, with files claimed and no price yet', async () => {
    const stl = await upload(STL, 'vase.stl');
    const project = await upload(THREE_MF, 'lid.3mf');
    const response = await submit([line(stl, 3), line(project)], { customerNote: '  PETG, black please  ' }).expect(201);
    const created = response.body as CustomOrder;
    expect(response.headers.location).toBe(`/api/custom-orders/${created.id}`);
    expect(created).toMatchObject({
      status: 'submitted', quotedPrice: null, currency: 'USD', adminNote: '', customer, customerNote: 'PETG, black please',
      files: [
        { fileId: stl.fileId, fileName: 'vase.stl', format: 'stl', sizeBytes: STL.length, quantity: 3 },
        { fileId: project.fileId, fileName: 'lid.3mf', format: '3mf', sizeBytes: THREE_MF.length, quantity: 1 },
      ],
    });
    expect(created.files[0].nozzle).toEqual({ id: 'nozzle-0-4', diameterMm: 0.4, priceMultiplier: 1 });
    expect(created.files[0].layerHeight).toEqual({ id: 'layer-0-2', heightMm: 0.2, priceMultiplier: 1 });
    expect(created.files[0].parts).toEqual([{
      key: 'model', name: 'Model',
      filament: { id: 'pla', name: 'PLA', pricePerKg: 80, densityGPerCm3: 1.24 },
      color: { id: 'black', name: 'Black', hex: '#1c1c1e' },
    }]);
    expect(created.number).toMatch(/^CP-\d{6}-[A-HJ-NP-Z2-9]{4}$/);
    expect(JSON.stringify(created)).not.toContain(stl.uploadKey);
    expect(await db.customOrders.get(created.id)).toEqual(created);
    expect((await db.customerFiles.find(stl.fileId))?.metadata.orderId).toBe(created.id);
    // Catalog orders are unaffected.
    expect(await db.orders.list({ limit: 10 })).toEqual([]);

    // The same upload can't be used again, by this or anybody else's request.
    const again = await submit([line(stl)]).expect(409);
    expect(again.body.details).toEqual(['File 1 (vase.stl): this upload already belongs to another print request. Please upload the file again.']);
  });

  it('requires the upload key, so other uploads cannot be attached by id', async () => {
    const stl = await upload(STL, 'vase.stl');
    const response = await submit([{ ...line(stl), uploadKey: 'x'.repeat(32) }, line(stl)]).expect(400);
    expect(response.body.details).toEqual(['files: Each uploaded file can be included only once.']);
    const wrongKey = await submit([{ ...line(stl), uploadKey: 'x'.repeat(32) }]).expect(409);
    expect(wrongKey.body).toEqual({
      error: 'Some files of your print request need attention.',
      details: ['File 1: the upload has expired or was not found. Please upload the file again.'],
    });
    await submit([{ ...line(stl), fileId: '000000000000000000000000' }]).expect(409);
    expect((await db.customerFiles.find(stl.fileId))?.metadata.orderId).toBeUndefined();
    expect(await db.customOrders.list({ limit: 10 })).toEqual([]);
  });

  it('validates contact details, quantities and the number of files', async () => {
    const stl = await upload(STL);
    const invalid = await request(app).post('/api/custom-orders').send({
      customer: { ...customer, name: ' ', email: 'nope' }, files: [line(stl, 0)],
    }).expect(400);
    expect(invalid.body.details).toEqual(expect.arrayContaining([
      'customer.name: Name is required.', 'customer.email: Enter a valid email address.', expect.stringMatching(/^files\.0\.quantity: /),
    ]));
    expect((await submit([]).expect(400)).body.details).toEqual(['files: Add at least one model file.']);
    const many = Array.from({ length: 11 }, (_, i) => ({ ...line(stl), fileId: `${i}`.padStart(24, 'a') }));
    expect((await submit(many).expect(400)).body.details).toContain('files: Send at most 10 files per print request.');
    await submit([line(stl, 21)]).expect(400);
  });

  it('keeps requests and their files private to admins', async () => {
    const stl = await upload(STL, 'wazon łódź.stl');
    const { id } = (await submit([line(stl)]).expect(201)).body as CustomOrder;
    await request(app).get('/api/custom-orders').expect(401);
    await request(app).get(`/api/custom-orders/${id}`).expect(401);
    await request(app).patch(`/api/custom-orders/${id}`).send({ status: 'approved' }).expect(401);
    await request(app).delete(`/api/custom-orders/${id}`).expect(401);
    await request(app).get(`/api/custom-orders/${id}/files/${stl.fileId}`).expect(401);
    // Customer uploads never appear among the public model files.
    await request(app).get(`/api/model-files/${stl.fileId}`).expect(404);

    const download = await request(app).get(`/api/custom-orders/${id}/files/${stl.fileId}`).set(admin).buffer(true).expect(200);
    expect(Buffer.compare(download.body as Buffer, STL)).toBe(0);
    expect(download.headers['content-disposition']).toBe(`attachment; filename="wazon __d_.stl"; filename*=UTF-8''${encodeURIComponent('wazon łódź.stl')}`);
    expect(download.headers['cache-control']).toBe('private, no-store');
    // Only files of that request are served.
    const other = await upload(STL);
    await request(app).get(`/api/custom-orders/${id}/files/${other.fileId}`).set(admin).expect(404);
    await request(app).get(`/api/custom-orders/missing/files/${stl.fileId}`).set(admin).expect(404);
  });

  it('lets admins list, filter, review with a quote, and delete requests together with their files', async () => {
    const first = (await submit([line(await upload(STL))]).expect(201)).body as CustomOrder;
    const stl = await upload(STL);
    const second = (await submit([line(stl, 2)]).expect(201)).body as CustomOrder;
    const listed = (await request(app).get('/api/custom-orders').set(admin).expect(200)).body as CustomOrder[];
    expect(listed.map((o) => o.id).sort()).toEqual([first.id, second.id].sort());
    await request(app).get('/api/custom-orders?status=bogus').set(admin).expect(400);

    const reviewed = await request(app).patch(`/api/custom-orders/${second.id}`).set(admin)
      .send({ status: 'approved', quotedPrice: 24.999, adminNote: 'Needs supports' }).expect(200);
    expect(reviewed.body).toMatchObject({ status: 'approved', quotedPrice: 25, adminNote: 'Needs supports', files: second.files });
    expect(reviewed.body.updatedAt >= second.updatedAt).toBe(true);
    expect((await request(app).get('/api/custom-orders?status=approved').set(admin).expect(200)).body.map((o: CustomOrder) => o.id))
      .toEqual([second.id]);
    const cleared = await request(app).patch(`/api/custom-orders/${second.id}`).set(admin).send({ quotedPrice: null }).expect(200);
    expect(cleared.body).toMatchObject({ status: 'approved', quotedPrice: null });
    for (const body of [{}, { quotedPrice: -1 }, { quotedPrice: '12' }, { status: 'paid' }, { files: [] }]) {
      await request(app).patch(`/api/custom-orders/${second.id}`).set(admin).send(body).expect(400);
    }
    await request(app).patch('/api/custom-orders/missing').set(admin).send({ status: 'rejected' }).expect(404);

    await request(app).delete(`/api/custom-orders/${second.id}`).set(admin).expect(204);
    await request(app).get(`/api/custom-orders/${second.id}`).set(admin).expect(404);
    expect(await db.customerFiles.find(stl.fileId)).toBeNull();
    await request(app).delete(`/api/custom-orders/${second.id}`).set(admin).expect(404);
    expect(await db.customOrders.get(first.id)).not.toBeNull();
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
    await expect(createCustomOrder(db, { customer, files: [line(stl)] }, late)).rejects.toMatchObject({
      status: 409, details: ['File 1: the upload has expired or was not found. Please upload the file again.'],
    });
    expect((await db.customerFiles.find(stl.fileId))?.metadata.orderId).toBeUndefined();
    const inTime = new Date(Date.now() + UPLOAD_CONFIRM_WINDOW_MS - 60_000);
    expect((await createCustomOrder(db, { customer, files: [line(stl)] }, inTime)).files).toHaveLength(1);
  });
});
