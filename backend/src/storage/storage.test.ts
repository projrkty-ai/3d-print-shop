import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSeedProducts } from '../domain/data/seedProducts';
import { createSeedPrintSettings } from '../domain/printSettings';
import { createSeedEmailTemplates } from '../domain/emailTemplates';
import { DEFAULT_PRICING } from '../domain/utils/projectPricing';
import type { ItemReview, LogEntry, Order, OrderProject, PricingSettings, Printer, PrinterModel, Product, ProjectProduct } from '../domain/types';
import {
  DuplicateNameError, DuplicateOrderNumberError, pruneModelFiles, releaseModelFile, seedPrintSettings, seedProducts, storageConfig, upgradePrinters, type Storage,
} from './index';
import { deleteAllOrders, deleteAllPrinters, openTestStorage } from './testStorage';

let storage: Storage;
let stop: (() => Promise<void>) | undefined;

beforeAll(async () => {
  ({ storage, stop } = await openTestStorage('storage-contract'));
}, 120_000);
afterAll(async () => {
  await stop?.();
});
beforeEach(async () => {
  await deleteAllOrders(storage);
  await deleteAllPrinters(storage);
  await storage.products.deleteAll();
  for (const id of await storage.modelFiles.ids()) await storage.modelFiles.delete(id);
});

const product = (id: string, patch: Partial<Product> = {}): Product => ({ ...createSeedProducts()[2], id, ...patch });

const customer = { name: 'Zoë Łukasiewicz', email: 'z@example.com', address: { line1: 'Długa 1', city: 'Kraków', postalCode: '30-001', country: 'PL' } };
const externalProject: Omit<OrderProject, 'verified' | 'sameSettingsForAll'> = {
  source: 'printables', id: '12345', title: 'Planter „deluxe”', description: 'Self-watering.', thumbnailUrl: null,
  url: 'https://www.printables.com/model/12345-planter', author: 'Prusa', license: 'CC BY 4.0',
};
const projectItems: ProjectProduct['items'] = [{
  file: { id: 'f1', name: 'planter.stl', sizeBytes: 1024, thumbnailUrl: null },
  settings: { quantity: 2, scalePercent: 100, filaments: [{ material: 'PETG', color: 'black' }, { material: 'TPU', color: 'red' }] },
}];

function order(id: string, patch: Partial<Order> = {}): Order {
  return {
    id, number: `PF-${id}`, status: 'received', source: 'catalog', items: [], customer, customerNote: '', currency: 'USD', adminNote: '',
    price: { mode: 'fixed', handlingFee: 5, estimated: null, reviewed: null, total: 5 },
    createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', ...patch,
  };
}

/** An order of an external project's model, which needs a quote. */
function projectOrder(id: string, patch: Partial<Order> = {}): Order {
  return order(id, {
    number: `PJ-${id}`, source: 'project', project: { ...externalProject, verified: true, sameSettingsForAll: true },
    items: [{ model: { source: 'project', file: projectItems[0].file, scalePercent: 100, filaments: projectItems[0].settings.filaments }, quantity: 2, unitPrice: null, lineTotal: null }],
    price: { mode: 'quote', handlingFee: 5, estimated: null, reviewed: null, total: null },
    ...patch,
  });
}

function printer(id: string, patch: Partial<Printer> = {}): Printer {
  return {
    id, name: `U1-${id}`, modelId: 'u1', location: 'Pokój 2, regał B, półka 3', notes: '',
    createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', ...patch,
  };
}

function printerModel(id: string, patch: Partial<PrinterModel> = {}): PrinterModel {
  return {
    id, name: `Snapmaker ${id}`, manufacturer: 'Snapmaker', plate: { widthMm: 270, depthMm: 270, heightMm: 270 }, maxColors: 4, profiles: null,
    createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', ...patch,
  };
}

/** Documents as the versions with separate order kinds stored them: a catalog order, a print request, project orders. */
const legacy = {
  catalogOrder: {
    id: 'legacy-catalog', number: 'PF-261101-AAAA', status: 'pending', customer, currency: 'USD', adminNote: 'Rush', customerNote: 'Gift',
    items: [{ productId: 'spiral-vase', productName: 'Spiral Vase', customization: { colorId: 'white' }, sizeLabel: '10 cm', colorName: 'White', colorHex: '#ffffff', unitPrice: 12, quantity: 2, priceLines: [{ label: 'Print', amount: 12 }], lineTotal: 24 }],
    total: 29, handlingFee: 5, createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z',
  },
  customOrder: {
    id: 'legacy-request', number: 'CP-261101-BBBB', status: 'approved', customer, currency: 'USD', adminNote: '', quotedPrice: 30, handlingFee: 4.5,
    estimatedPrice: 25.5, reviewedPrice: 31.1,
    files: [{
      fileId: 'aaaaaaaaaaaaaaaaaaaaaaaa', fileName: 'wazon łódź.stl', format: 'stl', sizeBytes: 134, quantity: 2,
      parts: [{ key: 'model', name: 'Model', filament: { id: 'pla', name: 'PLA', pricePerKg: 80, densityGPerCm3: 1.24 }, color: { id: 'black', name: 'Black', hex: '#000000' } }],
      estimate: { printMinutes: 90, parts: [{ key: 'model', grams: 50 }], unitPrice: 10.5 },
      review: { printMinutes: 120, parts: [{ key: 'model', grams: 60 }], unitPrice: 13.3, reviewedAt: '2026-11-03T10:00:00.000Z', sliced: { printMinutes: 118, parts: [{ key: 'model', grams: 60 }], slicedAt: '2026-11-03T09:00:00.000Z' } },
    }],
    createdAt: '2026-11-01T11:00:00.000Z', updatedAt: '2026-11-03T10:00:00.000Z',
  },
  /** Reviewed, of one model (two copies): the review becomes that model's measurements of one copy. */
  projectOrder: {
    id: 'legacy-project', number: 'PJ-261101-CCCC', status: 'quoted', customer, adminNote: '', project: externalProject, projectVerified: false,
    items: projectItems, sameSettingsForAll: true, notes: 'Please hurry', requiresQuote: true,
    review: {
      printMinutes: 120, hourlyRate: 3, printTimeCost: 6, filaments: [{ material: 'PETG', grams: 80, pricePerKg: 30, cost: 2.4 }],
      filamentCost: 2.4, handlingFee: 5, total: 13.4, currency: 'USD', reviewedAt: '2026-11-04T10:00:00.000Z',
    },
    createdAt: '2026-11-01T12:00:00.000Z', updatedAt: '2026-11-04T10:00:00.000Z',
  },
  /** Of the first version: `files` with one set of `preferences`. */
  firstProjectOrder: {
    id: 'legacy-first', number: 'PJ-261101-DDDD', status: 'new', customer, adminNote: '', project: externalProject, projectVerified: true,
    files: [{ id: 'f1', name: 'a.stl', sizeBytes: 1, thumbnailUrl: null }, { id: 'f2', name: 'b.stl', sizeBytes: null, thumbnailUrl: null }],
    preferences: { quantity: 3, material: 'PLA', color: 'white', scalePercent: 150, notes: 'Old note' },
    createdAt: '2026-11-01T13:00:00.000Z', updatedAt: '2026-11-01T13:00:00.000Z',
  },
  /** Placed for a Print on Demand product: 3 sets, priced at once. */
  productOrder: {
    id: 'legacy-product-order', number: 'PJ-261101-EEEE', status: 'accepted', customer, adminNote: '', project: externalProject, projectVerified: true,
    items: [{ ...projectItems[0], settings: { ...projectItems[0].settings, quantity: 6 } }], sameSettingsForAll: true, notes: '', requiresQuote: false,
    product: { id: 'pp', title: 'Kit', sets: 3, materialsChanged: false },
    review: {
      printMinutes: 180, hourlyRate: 2, printTimeCost: 6, filaments: [{ material: 'PLA', grams: 300, pricePerKg: 20, cost: 6 }],
      filamentCost: 6, handlingFee: 5, total: 17, currency: 'USD', reviewedAt: '2026-11-01T14:00:00.000Z',
    },
    createdAt: '2026-11-01T14:00:00.000Z', updatedAt: '2026-11-01T14:00:00.000Z',
  },
  logEntry: { id: 'legacy-log', orderKind: 'customOrder', orderId: 'legacy-request', createdAt: '2026-11-01T11:00:00.000Z', type: 'status', from: null, to: 'submitted' },
  emailEntry: {
    id: 'legacy-email', orderKind: 'customOrder', orderId: 'legacy-request', createdAt: '2026-11-02T11:00:00.000Z', type: 'emailSent',
    to: 'z@example.com', subject: 'Approved', body: 'Price', template: 'customOrder.approved', delivery: 'sent', messageId: '<m@shop>',
  },
};

/** What the legacy documents become: ordinary orders, ids and numbers kept, statuses mapped. */
async function expectMigrated(storage: Storage) {
  const orders = await storage.orders.list({ limit: 100 });
  expect(orders.map((o) => [o.id, o.number, o.source, o.status])).toEqual([
    ['legacy-product-order', 'PJ-261101-EEEE', 'printOnDemand', 'accepted'],
    ['legacy-first', 'PJ-261101-DDDD', 'project', 'received'],
    ['legacy-project', 'PJ-261101-CCCC', 'project', 'quoted'],
    ['legacy-request', 'CP-261101-BBBB', 'upload', 'quoted'],
    ['legacy-catalog', 'PF-261101-AAAA', 'catalog', 'received'],
  ]);
  const byId = Object.fromEntries(orders.map((o) => [o.id, o]));
  const { unitPrice: _unit, quantity: _quantity, lineTotal: _line, ...catalogModel } = legacy.catalogOrder.items[0];
  expect(byId['legacy-catalog']).toEqual({
    id: 'legacy-catalog', number: 'PF-261101-AAAA', status: 'received', source: 'catalog', customer, customerNote: 'Gift', adminNote: 'Rush', currency: 'USD',
    items: [{ model: { source: 'catalog', ...catalogModel }, quantity: 2, unitPrice: 12, lineTotal: 24 }],
    price: { mode: 'fixed', handlingFee: 5, estimated: null, reviewed: null, total: 29 },
    createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z',
  });
  const upload = byId['legacy-request'];
  expect(upload.price).toEqual({ mode: 'quote', handlingFee: 4.5, estimated: 25.5, reviewed: 31.1, total: 30 });
  expect(upload.customerNote).toBe('');
  expect(upload.items[0]).toMatchObject({
    model: { source: 'upload', fileId: 'aaaaaaaaaaaaaaaaaaaaaaaa', fileName: 'wazon łódź.stl' }, quantity: 2, unitPrice: null,
    estimate: { printMinutes: 90, filaments: [{ key: 'model', grams: 50 }], unitPrice: 10.5 },
    review: {
      printMinutes: 120, filaments: [{ key: 'model', label: 'PLA Black', grams: 60, pricePerKg: 80, cost: 4.8 }], filamentCost: 4.8,
      printTimeCost: 8.5, hourlyRate: 4.25, unitPrice: 13.3, reviewedAt: '2026-11-03T10:00:00.000Z',
      sliced: { printMinutes: 118, filaments: [{ key: 'model', grams: 60 }], slicedAt: '2026-11-03T09:00:00.000Z' },
    } satisfies Partial<ItemReview>,
  });
  const reviewed = byId['legacy-project'];
  expect(reviewed).toMatchObject({
    customerNote: 'Please hurry', project: { ...externalProject, verified: false, sameSettingsForAll: true },
    price: { mode: 'quote', handlingFee: 5, reviewed: 13.4, total: 13.4 },
    items: [{
      model: { source: 'project', file: projectItems[0].file, scalePercent: 100, filaments: projectItems[0].settings.filaments }, quantity: 2,
      review: { printMinutes: 60, hourlyRate: 3, printTimeCost: 3, filaments: [{ key: 'PETG', grams: 40, pricePerKg: 30, cost: 1.2 }], unitPrice: 4.2 },
    }],
  });
  expect(byId['legacy-first']).toMatchObject({
    customerNote: 'Old note', price: { mode: 'quote', total: null },
    items: [
      { model: { file: { id: 'f1' }, scalePercent: 150, filaments: [{ material: 'PLA', color: 'white' }] }, quantity: 3 },
      { model: { file: { id: 'f2' } }, quantity: 3 },
    ],
  });
  expect(byId['legacy-product-order']).toMatchObject({
    price: { mode: 'fixed', handlingFee: 5, total: 17 },
    items: [{
      model: { source: 'printOnDemand', productId: 'pp', title: 'Kit', materialsChanged: false, models: [{ settings: { quantity: 2 } }] },
      quantity: 3, unitPrice: 4, lineTotal: 12, review: { printMinutes: 60, unitPrice: 4 },
    }],
  });
  // Statuses and email templates of the log are the shared statuses too.
  expect(await storage.logBook.list('legacy-request')).toEqual([
    {
      id: 'legacy-email', orderId: 'legacy-request', createdAt: '2026-11-02T11:00:00.000Z', type: 'emailSent',
      to: 'z@example.com', subject: 'Approved', body: 'Price', template: 'quoted', delivery: 'sent', messageId: '<m@shop>',
    },
    { id: 'legacy-log', orderId: 'legacy-request', createdAt: '2026-11-01T11:00:00.000Z', type: 'status', from: null, to: 'received' },
  ]);
  expect(await storage.logBook.hasMessageId('legacy-request', '<m@shop>')).toBe(true);
}

describe(`${process.env.TEST_DATABASE ?? 'sqlite'} storage contract`, () => {
  it('keeps pricing, print options and email templates independent across prepare calls', async () => {
    const pricing = { ...DEFAULT_PRICING, hourlyRate: 17, updatedAt: '2026-11-07T12:00:00.000Z' };
    const printSettings = createSeedPrintSettings();
    const templates = createSeedEmailTemplates('2026-11-07T12:00:00.000Z');
    await storage.settings.putPricing(pricing);
    await storage.printSettings.put(printSettings);
    await storage.emailTemplates.put(templates);
    await storage.prepare();
    await storage.prepare();
    expect(await storage.settings.getPricing()).toEqual(pricing);
    expect(await storage.printSettings.get()).toEqual(printSettings);
    expect(await storage.emailTemplates.get()).toEqual(templates);
  });
  it('round-trips whole product documents and keeps catalog order, also after replacing', async () => {
    const seed = createSeedProducts();
    await storage.products.insertMany(seed);
    expect(await storage.products.list()).toEqual(seed);
    expect(await storage.products.count()).toBe(seed.length);
    expect((await storage.products.list({ publishedOnly: true })).map((p) => p.id))
      .toEqual(seed.filter((p) => p.published).map((p) => p.id));
    const changed = { ...seed[0], name: 'Renamed „vase” ✓', updatedAt: '2027-01-01T00:00:00.000Z' };
    expect(await storage.products.replace(changed)).toBe(true);
    expect((await storage.products.list()).map((p) => p.id)).toEqual(seed.map((p) => p.id));
    expect(await storage.products.get(seed[0].id)).toEqual(changed);
    expect(await storage.products.replace(product('missing'))).toBe(false);
    expect(await storage.products.get('missing')).toBeNull();
    const later = product('later', { createdAt: '2027-01-01T00:00:00.000Z' });
    const earlier = product('earlier', { createdAt: '2020-01-01T00:00:00.000Z' });
    await storage.products.insert(later);
    await storage.products.insert(earlier);
    const ids = (await storage.products.list()).map((p) => p.id);
    expect(ids[0]).toBe('earlier');
    expect(ids.at(-1)).toBe('later');
    expect((await storage.products.getMany(['later', 'nope', 'earlier'])).map((p) => p.id).sort()).toEqual(['earlier', 'later']);
    expect((await storage.products.ids()).sort()).toEqual([...seed.map((p) => p.id), 'earlier', 'later'].sort());
  });

  it('deletes products and tracks which model files they use', async () => {
    const mesh = { ...createSeedProducts()[0].mesh!, url: '/api/model-files/aaaaaaaaaaaaaaaaaaaaaaaa' };
    await storage.products.insertMany([product('a', { mesh }), product('b', { mesh }), product('c')]);
    expect(await storage.products.meshUrls()).toEqual([mesh.url]);
    expect(await storage.products.isMeshUrlUsed(mesh.url)).toBe(true);
    expect((await storage.products.delete('a'))?.id).toBe('a');
    expect(await storage.products.delete('a')).toBeNull();
    expect(await storage.products.isMeshUrlUsed(mesh.url)).toBe(true);
    await storage.products.delete('b');
    expect(await storage.products.isMeshUrlUsed(mesh.url)).toBe(false);
    await storage.products.deleteAll();
    expect(await storage.products.count()).toBe(0);
  });

  it('lists orders of every source newest first, filtered by status and source, and updates and deletes them', async () => {
    await storage.orders.insert(order('old', { createdAt: '2026-01-01T00:00:00.000Z' }));
    await storage.orders.insert(projectOrder('new', { createdAt: '2026-03-01T00:00:00.000Z', status: 'paid' }));
    await storage.orders.insert(order('mid', { createdAt: '2026-02-01T00:00:00.000Z' }));
    expect((await storage.orders.list({ limit: 10 })).map((o) => o.id)).toEqual(['new', 'mid', 'old']);
    expect((await storage.orders.list({ limit: 2 })).map((o) => o.id)).toEqual(['new', 'mid']);
    expect((await storage.orders.list({ status: 'received', limit: 10 })).map((o) => o.id)).toEqual(['mid', 'old']);
    expect((await storage.orders.list({ source: 'project', limit: 10 })).map((o) => o.id)).toEqual(['new']);
    expect((await storage.orders.list({ source: 'catalog', status: 'paid', limit: 10 })).map((o) => o.id)).toEqual([]);
    expect(await storage.orders.get('old')).toEqual(order('old', { createdAt: '2026-01-01T00:00:00.000Z' }));
    expect(await storage.orders.get('new')).toEqual(projectOrder('new', { createdAt: '2026-03-01T00:00:00.000Z', status: 'paid' }));

    const updated = await storage.orders.update('old', { status: 'shipped', adminNote: 'Tracking 123', updatedAt: '2026-04-01T00:00:00.000Z' });
    expect(updated).toMatchObject({ id: 'old', status: 'shipped', adminNote: 'Tracking 123', customer: { name: 'Zoë Łukasiewicz' } });
    expect(await storage.orders.get('old')).toEqual(updated);
    expect((await storage.orders.list({ status: 'shipped', limit: 10 })).map((o) => o.id)).toEqual(['old']);
    expect(await storage.orders.update('missing', { status: 'paid' })).toBeNull();
    expect(await storage.orders.delete('old')).toBe(true);
    expect(await storage.orders.delete('old')).toBe(false);
    expect(await storage.orders.get('old')).toBeNull();
  });

  it('saves item measurements and the price without changing the number, source or creation time', async () => {
    await storage.orders.insert(projectOrder('measured'));
    const review: ItemReview = {
      printMinutes: 90, hourlyRate: 2, printTimeCost: 3, filaments: [{ key: 'PETG', label: 'PETG', grams: 40, pricePerKg: 28, cost: 1.12 }],
      filamentCost: 1.12, unitPrice: 4.12, reviewedAt: '2026-11-02T10:00:00.000Z',
    };
    const items = [{ ...projectOrder('measured').items[0], review }];
    const price = { mode: 'quote' as const, handlingFee: 5, estimated: null, reviewed: 13.24, total: 15 };
    const updated = await storage.orders.update('measured', { items, price, updatedAt: '2026-11-02T10:00:00.000Z' });
    expect(updated).toEqual({ ...projectOrder('measured'), items, price, updatedAt: '2026-11-02T10:00:00.000Z' });
    expect(await storage.orders.get('measured')).toEqual(updated);
  });

  it('stores ready-to-print products newest first, published ones separately, and replaces and deletes them', async () => {
    const source = projectOrder('source');
    const product = (id: string, patch: Partial<ProjectProduct> = {}): ProjectProduct => ({
      id, title: `Planter ${id}`, description: 'Ready to print', published: true, project: externalProject, items: projectItems,
      measurements: { printMinutes: 60, filaments: [{ material: 'PLA', grams: 50 }] },
      sourceOrder: { id: source.id, number: source.number },
      createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', ...patch,
    });
    await storage.projectProducts.insert(product('old'));
    await storage.projectProducts.insert(product('hidden', { published: false, createdAt: '2026-11-02T10:00:00.000Z' }));
    await storage.projectProducts.insert(product('new', { createdAt: '2026-11-03T10:00:00.000Z' }));
    expect((await storage.projectProducts.list()).map((p) => p.id)).toEqual(['new', 'hidden', 'old']);
    expect((await storage.projectProducts.list({ publishedOnly: true })).map((p) => p.id)).toEqual(['new', 'old']);
    expect(await storage.projectProducts.get('old')).toEqual(product('old'));

    expect(await storage.projectProducts.replace({ ...product('hidden'), published: true, title: 'Shown „now”' })).toBe(true);
    expect((await storage.projectProducts.list({ publishedOnly: true })).map((p) => p.id)).toEqual(['new', 'hidden', 'old']);
    expect((await storage.projectProducts.get('hidden'))?.title).toBe('Shown „now”');
    expect(await storage.projectProducts.replace(product('missing'))).toBe(false);
    expect(await storage.projectProducts.delete('old')).toBe(true);
    expect(await storage.projectProducts.delete('old')).toBe(false);
    expect(await storage.projectProducts.get('old')).toBeNull();
  });

  it('keeps one pricing settings document', async () => {
    const pricing: PricingSettings = {
      hourlyRate: 2.5, handlingFee: 4, filamentPricePerKg: { PLA: 20, PETG: 22, ABS: 21, ASA: 30, TPU: 38, resin: 55 },
      updatedAt: '2026-11-05T10:00:00.000Z',
    };
    await storage.settings.putPricing(pricing);
    expect(await storage.settings.getPricing()).toEqual(pricing);
    await storage.settings.putPricing({ ...pricing, hourlyRate: 3 });
    expect(await storage.settings.getPricing()).toEqual({ ...pricing, hourlyRate: 3 });
  });

  it('upgrades ready-to-print products that stored a price snapshot to their measurements', async () => {
    const source = projectOrder('source');
    const legacy = {
      id: 'legacy-product', title: 'Kit', description: '', published: true, project: externalProject, items: projectItems,
      pricing: {
        printMinutes: 90, hourlyRate: 2, printTimeCost: 3, handlingFee: 5, total: 10.6, currency: 'USD', filamentCost: 2.6,
        filaments: [{ material: 'PETG', grams: 80, pricePerKg: 25, cost: 2 }, { material: 'TPU', grams: 15, pricePerKg: 40, cost: 0.6 }],
      },
      sourceOrder: { id: source.id, number: source.number }, createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z',
    };
    await storage.projectProducts.insert(legacy as unknown as ProjectProduct);
    await storage.prepare();
    const { pricing: _pricing, ...rest } = legacy as typeof legacy & { pricing: unknown };
    expect(await storage.projectProducts.get('legacy-product')).toEqual({
      ...rest, measurements: { printMinutes: 90, filaments: [{ material: 'PETG', grams: 80 }, { material: 'TPU', grams: 15 }] },
    });
  });

  it('reports a taken order number so checkout can draw another', async () => {
    await storage.orders.insert(order('first', { number: 'PF-261101-AAAA' }));
    await expect(storage.orders.insert(order('second', { number: 'PF-261101-AAAA' })))
      .rejects.toBeInstanceOf(DuplicateOrderNumberError);
    expect((await storage.orders.list({ limit: 10 })).map((o) => o.id)).toEqual(['first']);
  });

  it('claims each customer upload for exactly one order and lists uploads with metadata', async () => {
    const first = await storage.customerFiles.upload('a.stl', Buffer.from('solid a'), { uploadedAt: '2026-01-01T00:00:00.000Z' });
    const second = await storage.customerFiles.upload('b.3mf', Buffer.from('PK'), { uploadedAt: '2026-01-02T00:00:00.000Z' });
    expect(await storage.modelFiles.find(first)).toBeNull();
    const claims = await Promise.all([storage.customerFiles.claim(first, 'x'), storage.customerFiles.claim(first, 'y')]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const owner = claims[0] ? 'x' : 'y';
    expect(await storage.customerFiles.claim(first, 'x')).toBe(false);
    expect(await storage.customerFiles.claim('000000000000000000000000', 'x')).toBe(false);
    expect(await storage.customerFiles.claim('not-an-id', 'x')).toBe(false);
    expect((await storage.customerFiles.find(first))?.metadata).toEqual({ uploadedAt: '2026-01-01T00:00:00.000Z', orderId: owner });
    expect(await storage.customerFiles.list()).toEqual([
      { id: first, fileName: 'a.stl', length: 7, metadata: { uploadedAt: '2026-01-01T00:00:00.000Z', orderId: owner } },
      { id: second, fileName: 'b.3mf', length: 2, metadata: { uploadedAt: '2026-01-02T00:00:00.000Z' } },
    ]);
    expect(await text(storage.customerFiles.openDownloadStream(first))).toBe('solid a');
    await storage.customerFiles.delete(first);
    expect((await storage.customerFiles.list()).map((file) => file.id)).toEqual([second]);
  });

  it('stores one print settings document, replacing it on every save and seeding it only when missing', async () => {
    await storage.printSettings.put(createSeedPrintSettings('2026-01-01T00:00:00.000Z'));
    const seeded = await storage.printSettings.get();
    expect(seeded).toEqual(createSeedPrintSettings('2026-01-01T00:00:00.000Z'));
    const changed = { ...seeded!, defaultLayerHeightId: 'layer-0-12', filaments: seeded!.filaments.slice(0, 1), updatedAt: '2026-02-01T00:00:00.000Z' };
    await storage.printSettings.put(changed);
    expect(await storage.printSettings.get()).toEqual(changed);
    expect(await seedPrintSettings(storage)).toBe(false);
    expect(await seedPrintSettings(storage, { reset: true })).toBe(true);
    expect((await storage.printSettings.get())?.filaments).toHaveLength(4);
  });

  it('keeps each order\'s log book newest first, finds Message-IDs and deletes it with the order', async () => {
    const at = '2026-11-01T10:00:00.000Z';
    const entry = (id: string, patch: Partial<LogEntry> = {}) =>
      ({ id, orderId: 'o1', createdAt: at, type: 'status', from: null, to: 'received', ...patch }) as LogEntry;
    await storage.logBook.insert(entry('placed'));
    // Same millisecond: insertion order decides, so an email follows the status change it announces.
    await storage.logBook.insert(entry('paid', { createdAt: '2026-11-02T10:00:00.000Z', from: 'received', to: 'paid' } as Partial<LogEntry>));
    await storage.logBook.insert(entry('email', {
      createdAt: '2026-11-02T10:00:00.000Z', type: 'emailSent', to: 'a@example.com', subject: 'Paid', body: 'Thanks',
      template: 'paid', delivery: 'sent', messageId: '<m1@shop>',
    } as Partial<LogEntry>));
    await storage.logBook.insert(entry('other-order', { orderId: 'o2' }));
    expect((await storage.logBook.list('o1')).map((e) => e.id)).toEqual(['email', 'paid', 'placed']);
    expect(await storage.logBook.get('o1', 'paid')).toEqual(entry('paid', { createdAt: '2026-11-02T10:00:00.000Z', from: 'received', to: 'paid' } as Partial<LogEntry>));
    expect(await storage.logBook.get('o2', 'paid')).toBeNull();
    expect(await storage.logBook.hasMessageId('o1', '<m1@shop>')).toBe(true);
    expect(await storage.logBook.hasMessageId('o2', '<m1@shop>')).toBe(false);
    expect((await storage.logBook.deleteForOrder('o1')).map((e) => e.id).sort()).toEqual(['email', 'paid', 'placed']);
    expect(await storage.logBook.list('o1')).toEqual([]);
    expect((await storage.logBook.list('o2')).map((e) => e.id)).toEqual(['other-order']);
    await storage.logBook.deleteForOrder('o2');
  });

  it('stores the email templates document and keeps mail files in their own bucket', async () => {
    const templates = createSeedEmailTemplates('2026-01-01T00:00:00.000Z');
    await storage.emailTemplates.put(templates);
    expect(await storage.emailTemplates.get()).toEqual(templates);
    const edited = { ...templates, templates: { ...templates.templates, paid: { subject: 'Paid {{orderNumber}}', body: 'x' } } };
    await storage.emailTemplates.put(edited);
    expect((await storage.emailTemplates.get())?.templates.paid.subject).toBe('Paid {{orderNumber}}');
    const id = await storage.mailFiles.upload('message.eml', Buffer.from('From: a@b.c\r\n\r\nHi'), { orderId: 'o1' });
    expect(await storage.customerFiles.find(id)).toBeNull();
    expect((await storage.mailFiles.find(id))?.metadata).toEqual({ orderId: 'o1' });
    await storage.mailFiles.delete(id);
  });

  it('stores, serves and deletes files in separate buckets', async () => {
    const data = Buffer.from([0, 1, 2, 255, 254, 10, 13]);
    const id = await storage.mediaFiles.upload('image.png', data, { contentType: 'image/png' });
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    expect(await storage.mediaFiles.find(id)).toEqual({ id, fileName: 'image.png', length: data.length, metadata: { contentType: 'image/png' } });
    const chunks: Buffer[] = [];
    for await (const chunk of storage.mediaFiles.openDownloadStream(id)) chunks.push(Buffer.from(chunk as Uint8Array));
    expect(Buffer.concat(chunks)).toEqual(data);
    expect(await storage.modelFiles.find(id)).toBeNull();
    expect(await storage.mediaFiles.find('not-an-id')).toBeNull();
    expect(await storage.mediaFiles.find('000000000000000000000000')).toBeNull();
    await storage.mediaFiles.delete(id);
    await storage.mediaFiles.delete(id);
    expect(await storage.mediaFiles.find(id)).toBeNull();
  });

  it('releases and prunes model files that no product uses any more', async () => {
    const used = await storage.modelFiles.upload('used.stl', Buffer.from('solid used'), {});
    const orphan = await storage.modelFiles.upload('orphan.stl', Buffer.from('solid orphan'), {});
    const url = `/api/model-files/${used}`;
    await storage.products.insert(product('uses-file', { mesh: { ...createSeedProducts()[0].mesh!, url } }));
    await pruneModelFiles(storage);
    expect(await storage.modelFiles.ids()).toEqual([used]);
    expect(await text(storage.modelFiles.openDownloadStream(used))).toBe('solid used');
    await releaseModelFile(storage, url);
    expect(await storage.modelFiles.find(used)).not.toBeNull();
    await storage.products.delete('uses-file');
    await releaseModelFile(storage, url);
    expect(await storage.modelFiles.find(used)).toBeNull();
    expect(orphan).not.toBe(used);
  });

  it.each(['printers', 'printerModels'] as const)('stores %s with unique names (ignoring case), listed by name', async (kind) => {
    const store = storage[kind] as Storage['printerModels'];
    const make = (id: string, name: string) => (kind === 'printers' ? printer(id, { name }) : printerModel(id, { name })) as PrinterModel;
    await store.insert(make('b', 'Zeta'));
    await store.insert(make('a', 'alpha'));
    expect((await store.list()).map((p) => p.name)).toEqual(['alpha', 'Zeta']);
    expect(await store.get('a')).toEqual(make('a', 'alpha'));
    expect(await store.get('missing')).toBeNull();
    await expect(store.insert(make('c', ' ALPHA '))).rejects.toBeInstanceOf(DuplicateNameError);
    await expect(store.replace(make('b', 'Alpha'))).rejects.toBeInstanceOf(DuplicateNameError);
    expect((await store.list()).map((p) => p.id)).toEqual(['a', 'b']);
    const changed = { ...make('b', 'Beta'), updatedAt: '2027-01-01T00:00:00.000Z' };
    expect(await store.replace(changed)).toBe(true);
    expect(await store.get('b')).toEqual(changed);
    expect(await store.replace(make('missing', 'Missing'))).toBe(false);
    // The name is free again after renaming.
    await store.insert(make('c', 'Zeta'));
    expect((await store.delete('c'))?.name).toBe('Zeta');
    expect(await store.delete('c')).toBeNull();
    expect((await store.list()).map((p) => p.name)).toEqual(['alpha', 'Beta']);
  });

  it('keeps printers and models apart, and model profile archives in the printer-file store', async () => {
    await storage.printerModels.insert(printerModel('u1', { name: 'Same name' }));
    await storage.printers.insert(printer('p1', { name: 'Same name' }));
    const fileId = await storage.printerFiles.upload('profiles.zip', Buffer.from('PK'), { modelId: 'u1' });
    const withProfiles = printerModel('u1', {
      name: 'Same name',
      profiles: {
        fileId, fileName: 'profiles.zip', sizeBytes: 2, uploadedAt: '2027-01-01T00:00:00.000Z',
        entries: [{ name: 'machine/Snapmaker U1 (0.4 nozzle).json', sizeBytes: 1234 }],
        presets: { machine: ['Snapmaker U1 (0.4 nozzle)'], process: [], filament: [] },
      },
    });
    await storage.printerModels.replace(withProfiles);
    expect(await storage.printerModels.list()).toEqual([withProfiles]);
    expect(await storage.printers.list()).toEqual([printer('p1', { name: 'Same name' })]);
    expect((await storage.printerFiles.find(fileId))?.metadata).toEqual({ modelId: 'u1' });
    expect(await text(storage.printerFiles.openDownloadStream(fileId))).toBe('PK');
  });

  it('moves the model, plate, colors and profiles of printers saved before printer models to shared models', async () => {
    const profiles = (fileName: string) => ({
      fileId: 'aaaaaaaaaaaaaaaaaaaaaaaa', fileName, sizeBytes: 2, uploadedAt: '2026-11-02T00:00:00.000Z',
      entries: [], presets: { machine: [], process: [], filament: [] },
    });
    const legacy = (id: string, model: string, patch: object) => ({
      id, name: id, model, plate: { widthMm: 270, depthMm: 270, heightMm: 270 }, maxColors: 4, location: 'Shelf', notes: '', profiles: null,
      createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', ...patch,
    }) as unknown as Printer;
    await storage.printerModels.insert(printerModel('existing', { name: 'Bambu Lab P1S', maxColors: 16 }));
    await storage.printers.insert(legacy('old-u1', 'Snapmaker U1', { maxColors: 1, profiles: profiles('old.zip') }));
    await storage.printers.insert(legacy('new-u1', 'snapmaker u1 ', { updatedAt: '2026-11-05T00:00:00.000Z', profiles: profiles('new.zip') }));
    await storage.printers.insert(legacy('p1s', 'bambu lab p1s', { maxColors: 4 }));
    await storage.printers.insert(printer('current', { modelId: 'existing' }));

    expect(await upgradePrinters(storage)).toBe(3);
    expect(await upgradePrinters(storage)).toBe(0);
    const models = await storage.printerModels.list();
    expect(models.map((model) => [model.name, model.maxColors, model.profiles?.fileName ?? null])).toEqual([
      ['Bambu Lab P1S', 16, null], ['snapmaker u1', 4, 'new.zip'],
    ]);
    const u1 = models.find((model) => model.name === 'snapmaker u1')!;
    expect(await storage.printers.list()).toEqual([
      { id: 'new-u1', name: 'new-u1', modelId: u1.id, location: 'Shelf', notes: '', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z' },
      { id: 'old-u1', name: 'old-u1', modelId: u1.id, location: 'Shelf', notes: '', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' },
      { id: 'p1s', name: 'p1s', modelId: 'existing', location: 'Shelf', notes: '', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' },
      printer('current', { modelId: 'existing' }),
    ]);
  });

  it('seeds an empty catalog once and replaces products only on reset', async () => {
    expect(await seedProducts(storage)).toBe(createSeedProducts().length);
    expect(await seedProducts(storage)).toBe(0);
    await storage.products.delete('pen-holder');
    expect(await seedProducts(storage, { reset: true })).toBe(createSeedProducts().length);
    expect(await storage.products.get('pen-holder')).not.toBeNull();
  });
});

describe.runIf((process.env.TEST_DATABASE ?? 'sqlite') === 'sqlite')('SQLite file storage', () => {
  let directory: string;
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'printforge-sqlite-'));
  });
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it.each([[1, null], [2, 'key'], [3, 'id']] as const)(
    'upgrades schema %s while retaining legacy settings and uploads',
    async (version, column) => {
      const { DatabaseSync } = await import('node:sqlite');
      const { sqliteStorage } = await import('./sqlite');
      const path = join(directory, `legacy-${version}.sqlite`);
      const raw = new DatabaseSync(path);
      const pricing = { ...DEFAULT_PRICING, hourlyRate: 23 };
      const printSettings = createSeedPrintSettings();
      raw.exec(`
        CREATE TABLE files (
          bucket TEXT NOT NULL, id TEXT NOT NULL, file_name TEXT NOT NULL,
          length INTEGER NOT NULL, metadata TEXT NOT NULL, data BLOB NOT NULL,
          PRIMARY KEY (bucket, id)
        );
        PRAGMA user_version = ${version};
      `);
      const id = 'aaaaaaaaaaaaaaaaaaaaaaaa';
      raw.prepare('INSERT INTO files VALUES (?, ?, ?, ?, ?, ?)').run(
        'modelFiles', id, 'kept.stl', 4, '{}', Buffer.from('kept'),
      );
      if (column) {
        raw.exec(`CREATE TABLE settings (${column} TEXT PRIMARY KEY, document TEXT NOT NULL)`);
        raw.prepare('INSERT INTO settings VALUES (?, ?)').run(
          version === 3 ? 'pricing' : 'printSettings',
          JSON.stringify(version === 3 ? pricing : printSettings),
        );
      }
      raw.close();
      const migrated = sqliteStorage(path);
      try {
        await migrated.prepare();
        if (version === 3) expect(await migrated.settings.getPricing()).toEqual(pricing);
        if (version === 2) expect(await migrated.printSettings.get()).toEqual(printSettings);
        await migrated.settings.putPricing(pricing);
        await migrated.printSettings.put(printSettings);
        await migrated.emailTemplates.put(createSeedEmailTemplates('2026-11-07T12:00:00.000Z'));
        await migrated.orders.insert(order('legacy', { source: 'upload', number: 'CP-legacy' }));
        await migrated.orders.insert(projectOrder('legacy-project'));
        await migrated.prepare();
        expect(await migrated.settings.getPricing()).toEqual(pricing);
        expect(await migrated.printSettings.get()).toEqual(printSettings);
        expect((await migrated.orders.get('legacy'))?.number).toBe('CP-legacy');
        expect((await migrated.orders.list({ source: 'project', limit: 10 })).map((o) => o.number)).toEqual(['PJ-legacy-project']);
        expect(await text(migrated.modelFiles.openDownloadStream(id))).toBe('kept');
      } finally {
        await migrated.close();
      }
    },
  );

  it('keeps data across restarts in a file, creating missing directories', async () => {
    const { sqliteStorage } = await import('./sqlite');
    const path = join(directory, 'nested', 'shop.sqlite');
    const first = sqliteStorage(path);
    await first.prepare();
    await seedProducts(first);
    await first.orders.insert(order('kept'));
    await first.orders.insert(projectOrder('kept-project'));
    const fileId = await first.mediaFiles.upload('image.png', Buffer.from('png'), { contentType: 'image/png' });
    await first.close();

    const second = sqliteStorage(path);
    await second.prepare();
    expect(await seedProducts(second)).toBe(0);
    expect(await second.products.count()).toBe(createSeedProducts().length);
    expect((await second.orders.get('kept'))?.customer.name).toBe('Zoë Łukasiewicz');
    expect((await second.orders.get('kept-project'))?.project?.title).toBe('Planter „deluxe”');
    expect((await second.mediaFiles.find(fileId))?.length).toBe(3);
    expect(second.description).toBe(`SQLite database ${path}`);
    await second.close();
  });

  it.each([4, 5])('moves print requests and project orders of schema %s into the orders, keeping log books', async (version) => {
    const { DatabaseSync } = await import('node:sqlite');
    const { sqliteStorage } = await import('./sqlite');
    const path = join(directory, `separate-kinds-${version}.sqlite`);
    const raw = new DatabaseSync(path);
    raw.exec(`
      CREATE TABLE orders (id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, status TEXT NOT NULL, created_at TEXT NOT NULL, document TEXT NOT NULL);
      CREATE TABLE custom_orders (id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, status TEXT NOT NULL, created_at TEXT NOT NULL, document TEXT NOT NULL);
      CREATE TABLE project_orders (id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, status TEXT NOT NULL, created_at TEXT NOT NULL, document TEXT NOT NULL);
      CREATE TABLE log_entries (id TEXT PRIMARY KEY, order_kind TEXT NOT NULL, order_id TEXT NOT NULL, created_at TEXT NOT NULL, message_id TEXT, document TEXT NOT NULL);
      PRAGMA user_version = ${version};
    `);
    const insert = (table: string, document: { id: string; number: string; status: string; createdAt: string }) =>
      raw.prepare(`INSERT INTO ${table} VALUES (?, ?, ?, ?, ?)`).run(document.id, document.number, document.status, document.createdAt, JSON.stringify(document));
    insert('orders', legacy.catalogOrder);
    insert('custom_orders', legacy.customOrder);
    for (const document of [legacy.projectOrder, legacy.firstProjectOrder, legacy.productOrder]) insert('project_orders', document);
    raw.prepare('INSERT INTO log_entries VALUES (?, ?, ?, ?, NULL, ?)').run('legacy-log', 'customOrder', 'legacy-request', legacy.logEntry.createdAt, JSON.stringify(legacy.logEntry));
    raw.prepare('INSERT INTO log_entries VALUES (?, ?, ?, ?, ?, ?)').run(
      'legacy-email', 'customOrder', 'legacy-request', legacy.emailEntry.createdAt, legacy.emailEntry.messageId, JSON.stringify(legacy.emailEntry),
    );
    raw.close();

    const migrated = sqliteStorage(path);
    try {
      await migrated.prepare();
      await expectMigrated(migrated);
      // Safe to repeat; the separate tables are gone.
      await migrated.prepare();
      await expectMigrated(migrated);
    } finally {
      await migrated.close();
    }
    const check = new DatabaseSync(path);
    const tables = check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
    expect(tables).not.toContain('custom_orders');
    expect(tables).not.toContain('project_orders');
    expect(check.prepare('PRAGMA user_version').get()).toEqual({ user_version: 6 });
    check.close();
  });

  it('refuses a database written by a newer schema version', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const { sqliteStorage } = await import('./sqlite');
    const path = join(directory, 'future.sqlite');
    const raw = new DatabaseSync(path);
    raw.exec('PRAGMA user_version = 99');
    raw.close();
    expect(() => sqliteStorage(path)).toThrow('newer version');
    const unchanged = new DatabaseSync(path);
    expect(unchanged.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toEqual([]);
    unchanged.close();
  });
});

describe.runIf(process.env.TEST_DATABASE === 'mongodb')('MongoDB order migration', () => {
  it('moves print requests and project orders into the orders, keeping log books', async () => {
    const [{ MongoMemoryServer }, { MongoClient }, { mongoStorage }] = await Promise.all([
      import('mongodb-memory-server'), import('mongodb'), import('./mongo'),
    ]);
    const server = await MongoMemoryServer.create();
    const client = await MongoClient.connect(server.getUri());
    try {
      const db = client.db('separate-kinds');
      await db.collection('orders').insertOne({ ...legacy.catalogOrder });
      await db.collection('customOrders').insertOne({ ...legacy.customOrder });
      await db.collection('projectOrders').insertMany([legacy.projectOrder, legacy.firstProjectOrder, legacy.productOrder].map((document) => ({ ...document })));
      await db.collection('logEntries').createIndex({ orderKind: 1, orderId: 1, createdAt: -1 });
      await db.collection('logEntries').insertMany([{ ...legacy.logEntry }, { ...legacy.emailEntry }]);
      const migrated = mongoStorage(db);
      await migrated.prepare();
      await expectMigrated(migrated);
      await migrated.prepare();
      await expectMigrated(migrated);
      const collections = (await db.listCollections().toArray()).map((collection) => collection.name);
      expect(collections).not.toContain('customOrders');
      expect(collections).not.toContain('projectOrders');
      expect((await db.collection('logEntries').listIndexes().toArray()).some((index) => 'orderKind' in index.key)).toBe(false);
    } finally {
      await client.close();
      await server.stop();
    }
  }, 120_000);
});

describe.runIf(process.env.TEST_DATABASE === 'mongodb')('MongoDB settings migration', () => {
  it('migrates legacy pricing and its unique id index without losing custom-model settings', async () => {
    const [{ MongoMemoryServer }, { MongoClient }, { mongoStorage }] = await Promise.all([
      import('mongodb-memory-server'), import('mongodb'), import('./mongo'),
    ]);
    const server = await MongoMemoryServer.create();
    const client = await MongoClient.connect(server.getUri());
    try {
      const db = client.db('legacy-settings');
      const settings = db.collection('settings');
      const pricing = { ...DEFAULT_PRICING, hourlyRate: 31 };
      await settings.createIndex({ id: 1 }, { unique: true });
      await settings.insertOne({ id: 'pricing', ...pricing });
      const migrated = mongoStorage(db);
      await migrated.prepare();
      expect(await migrated.settings.getPricing()).toEqual(pricing);
      const printSettings = createSeedPrintSettings();
      const templates = createSeedEmailTemplates('2026-11-07T12:00:00.000Z');
      await migrated.printSettings.put(printSettings);
      await migrated.emailTemplates.put(templates);
      await migrated.prepare();
      expect(await migrated.settings.getPricing()).toEqual(pricing);
      expect(await migrated.printSettings.get()).toEqual(printSettings);
      expect(await migrated.emailTemplates.get()).toEqual(templates);
      expect(await settings.countDocuments()).toBe(3);
    } finally {
      await client.close();
      await server.stop();
    }
  }, 120_000);
});


describe('storage configuration', () => {
  it('uses SQLite for development and MongoDB in production unless DATABASE says otherwise', () => {
    expect(storageConfig({})).toEqual({ kind: 'sqlite', path: join(process.cwd(), 'data/printforge.sqlite') });
    const customPath = join(tmpdir(), 'shop.sqlite');
    expect(storageConfig({ SQLITE_PATH: customPath })).toEqual({ kind: 'sqlite', path: customPath });
    expect(storageConfig({ NODE_ENV: 'production' })).toEqual({ kind: 'mongodb', uri: 'mongodb://localhost:27017/printforge' });
    expect(storageConfig({ NODE_ENV: 'production', DATABASE: 'sqlite' }).kind).toBe('sqlite');
    expect(storageConfig({ DATABASE: 'mongodb', MONGODB_URI: 'mongodb://db:27017/shop' })).toEqual({ kind: 'mongodb', uri: 'mongodb://db:27017/shop' });
    expect(() => storageConfig({ DATABASE: 'postgres' })).toThrow('DATABASE must be "sqlite" or "mongodb"');
  });
});
