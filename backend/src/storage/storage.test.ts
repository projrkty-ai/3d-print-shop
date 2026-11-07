import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSeedProducts } from '../domain/data/seedProducts';
import { createSeedPrintSettings } from '../domain/printSettings';
import { createSeedEmailTemplates } from '../domain/emailTemplates';
import { DEFAULT_PRICING } from '../domain/utils/projectPricing';
import type { CustomOrder, LogEntry, Order, PricingSettings, Product, ProjectOrder, ProjectProduct } from '../domain/types';
import {
  DuplicateOrderNumberError, pruneModelFiles, releaseModelFile, seedPrintSettings, seedProducts, storageConfig, type Storage,
} from './index';
import { deleteAllOrders, openTestStorage } from './testStorage';

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
  await storage.products.deleteAll();
  for (const id of await storage.modelFiles.ids()) await storage.modelFiles.delete(id);
});

const product = (id: string, patch: Partial<Product> = {}): Product => ({ ...createSeedProducts()[2], id, ...patch });

function order(id: string, patch: Partial<Order> = {}): Order {
  return {
    id, number: `PF-${id}`, status: 'pending', items: [], total: 0, currency: 'USD', adminNote: '',
    customer: { name: 'Zoë Łukasiewicz', email: 'z@example.com', address: { line1: 'Długa 1', city: 'Kraków', postalCode: '30-001', country: 'PL' } },
    createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', ...patch,
  };
}

function customOrder(id: string, patch: Partial<CustomOrder> = {}): CustomOrder {
  return {
    id, number: `CP-${id}`, status: 'submitted', currency: 'USD', adminNote: '', quotedPrice: null,
    files: [{ fileId: 'aaaaaaaaaaaaaaaaaaaaaaaa', fileName: 'wazon łódź.stl', format: 'stl', sizeBytes: 134, quantity: 2 }],
    customer: order(id).customer,
    createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', ...patch,
  };
}

function projectOrder(id: string, patch: Partial<ProjectOrder> = {}): ProjectOrder {
  return {
    id, number: `PJ-${id}`, status: 'new', adminNote: '', projectVerified: true, requiresQuote: true,
    customer: { name: 'Zoë Łukasiewicz', email: 'z@example.com', address: { line1: 'Długa 1', city: 'Kraków', postalCode: '30-001', country: 'PL' } },
    project: {
      source: 'printables', id: '12345', title: 'Planter „deluxe”', description: 'Self-watering.', thumbnailUrl: null,
      url: 'https://www.printables.com/model/12345-planter', author: 'Prusa', license: 'CC BY 4.0',
    },
    items: [{
      file: { id: 'f1', name: 'planter.stl', sizeBytes: 1024, thumbnailUrl: null },
      settings: { quantity: 2, scalePercent: 100, filaments: [{ material: 'PETG', color: 'black' }, { material: 'TPU', color: 'red' }] },
    }],
    sameSettingsForAll: true, notes: '',
    createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', ...patch,
  };
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

  it('lists orders newest first with status filter and limit, and updates and deletes them', async () => {
    await storage.orders.insert(order('old', { createdAt: '2026-01-01T00:00:00.000Z' }));
    await storage.orders.insert(order('new', { createdAt: '2026-03-01T00:00:00.000Z', status: 'paid' }));
    await storage.orders.insert(order('mid', { createdAt: '2026-02-01T00:00:00.000Z' }));
    expect((await storage.orders.list({ limit: 10 })).map((o) => o.id)).toEqual(['new', 'mid', 'old']);
    expect((await storage.orders.list({ limit: 2 })).map((o) => o.id)).toEqual(['new', 'mid']);
    expect((await storage.orders.list({ status: 'pending', limit: 10 })).map((o) => o.id)).toEqual(['mid', 'old']);
    expect(await storage.orders.get('old')).toEqual(order('old', { createdAt: '2026-01-01T00:00:00.000Z' }));

    const updated = await storage.orders.update('old', { status: 'shipped', adminNote: 'Tracking 123', updatedAt: '2026-04-01T00:00:00.000Z' });
    expect(updated).toMatchObject({ id: 'old', status: 'shipped', adminNote: 'Tracking 123', customer: { name: 'Zoë Łukasiewicz' } });
    expect(await storage.orders.get('old')).toEqual(updated);
    expect((await storage.orders.list({ status: 'shipped', limit: 10 })).map((o) => o.id)).toEqual(['old']);
    expect(await storage.orders.update('missing', { status: 'paid' })).toBeNull();
    expect(await storage.orders.delete('old')).toBe(true);
    expect(await storage.orders.delete('old')).toBe(false);
    expect(await storage.orders.get('old')).toBeNull();
  });

  it('stores project orders separately from orders, newest first with status filter, and updates and deletes them', async () => {
    await storage.projectOrders.insert(projectOrder('old', { createdAt: '2026-01-01T00:00:00.000Z' }));
    await storage.projectOrders.insert(projectOrder('new', { createdAt: '2026-03-01T00:00:00.000Z', status: 'quoted' }));
    await storage.orders.insert(order('regular'));
    expect((await storage.projectOrders.list({ limit: 10 })).map((o) => o.id)).toEqual(['new', 'old']);
    expect((await storage.projectOrders.list({ status: 'new', limit: 10 })).map((o) => o.id)).toEqual(['old']);
    expect((await storage.orders.list({ limit: 10 })).map((o) => o.id)).toEqual(['regular']);
    expect(await storage.projectOrders.get('old')).toEqual(projectOrder('old', { createdAt: '2026-01-01T00:00:00.000Z' }));
    expect(await storage.orders.get('old')).toBeNull();

    const updated = await storage.projectOrders.update('old', { status: 'accepted', adminNote: 'Quoted $40', updatedAt: '2026-04-01T00:00:00.000Z' });
    expect(updated).toMatchObject({ id: 'old', status: 'accepted', adminNote: 'Quoted $40', project: { title: 'Planter „deluxe”' } });
    expect((await storage.projectOrders.list({ status: 'accepted', limit: 10 })).map((o) => o.id)).toEqual(['old']);
    await expect(storage.projectOrders.insert(projectOrder('dup', { number: 'PJ-new' }))).rejects.toBeInstanceOf(DuplicateOrderNumberError);
    expect(await storage.projectOrders.update('missing', { status: 'quoted' })).toBeNull();
    expect(await storage.projectOrders.delete('old')).toBe(true);
    expect(await storage.projectOrders.delete('old')).toBe(false);
  });

  it('saves a price review on a project order without changing its number or creation time', async () => {
    await storage.projectOrders.insert(projectOrder('reviewed'));
    const review = {
      printMinutes: 90, hourlyRate: 2, printTimeCost: 3, filaments: [{ material: 'PETG' as const, grams: 40, pricePerKg: 28, cost: 1.12 }],
      filamentCost: 1.12, handlingFee: 5, total: 9.12, currency: 'USD', reviewedAt: '2026-11-02T10:00:00.000Z',
    };
    const updated = await storage.projectOrders.update('reviewed', { review, updatedAt: '2026-11-02T10:00:00.000Z' });
    expect(updated).toEqual({ ...projectOrder('reviewed'), review, updatedAt: '2026-11-02T10:00:00.000Z' });
    expect(await storage.projectOrders.get('reviewed')).toEqual(updated);
  });

  it('stores ready-to-print products newest first, published ones separately, and replaces and deletes them', async () => {
    const source = projectOrder('source');
    const product = (id: string, patch: Partial<ProjectProduct> = {}): ProjectProduct => ({
      id, title: `Planter ${id}`, description: 'Ready to print', published: true, project: source.project, items: source.items,
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

  it('upgrades project orders saved before per-model print settings', async () => {
    const { items: _items, sameSettingsForAll: _same, notes: _notes, requiresQuote: _quote, ...current } = projectOrder('legacy');
    const legacy = {
      ...current,
      files: [{ id: 'f1', name: 'a.stl', sizeBytes: 1, thumbnailUrl: null }, { id: 'f2', name: 'b.stl', sizeBytes: null, thumbnailUrl: null }],
      preferences: { quantity: 3, material: 'PLA', color: 'white', scalePercent: 150, notes: 'Old note' },
    };
    const { items: _i, sameSettingsForAll: _s, notes: _n, requiresQuote: _q, ...whole } = projectOrder('legacy-whole', { number: 'PJ-legacy-whole' });
    await storage.projectOrders.insert(legacy as unknown as ProjectOrder);
    await storage.projectOrders.insert({ ...whole, files: [], preferences: { quantity: 1, material: 'any', color: '', scalePercent: 100, notes: '' } } as unknown as ProjectOrder);
    await storage.projectOrders.insert(projectOrder('current', { number: 'PJ-current' }));
    const { requiresQuote: _r, ...fromProduct } = projectOrder('from-product', {
      number: 'PJ-from-product', product: { id: 'pp', title: 'Kit', sets: 2 } as ProjectOrder['product'],
    });
    await storage.projectOrders.insert(fromProduct as ProjectOrder);
    await storage.prepare();

    const settings = { quantity: 3, scalePercent: 150, filaments: [{ material: 'PLA', color: 'white' }] };
    expect(await storage.projectOrders.get('legacy')).toEqual({
      ...current, sameSettingsForAll: true, notes: 'Old note', requiresQuote: true,
      items: [{ file: legacy.files[0], settings }, { file: legacy.files[1], settings }],
    });
    expect((await storage.projectOrders.get('legacy-whole'))?.items).toEqual([
      { file: null, settings: { quantity: 1, scalePercent: 100, filaments: [{ material: 'any', color: '' }] } },
    ]);
    expect(await storage.projectOrders.get('current')).toEqual(projectOrder('current', { number: 'PJ-current' }));
    // Earlier versions always priced product orders at once.
    expect(await storage.projectOrders.get('from-product')).toMatchObject({
      requiresQuote: false, product: { id: 'pp', title: 'Kit', sets: 2, materialsChanged: false },
    });
  });

  it('upgrades ready-to-print products that stored a price snapshot to their measurements', async () => {
    const source = projectOrder('source');
    const legacy = {
      id: 'legacy-product', title: 'Kit', description: '', published: true, project: source.project, items: source.items,
      pricing: {
        printMinutes: 90, hourlyRate: 2, printTimeCost: 3, handlingFee: 5, total: 10.6, currency: 'USD', filamentCost: 2.6,
        filaments: [{ material: 'PETG', grams: 80, pricePerKg: 25, cost: 2 }, { material: 'TPU', grams: 15, pricePerKg: 40, cost: 0.6 }],
      },
      sourceOrder: { id: source.id, number: source.number }, createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z',
    };
    await storage.projectProducts.insert(legacy as unknown as ProjectProduct);
    await storage.prepare();
    const { pricing: _pricing, ...rest } = legacy;
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

  it('lists print requests newest first with status filter, and updates and deletes them', async () => {
    await storage.customOrders.insert(customOrder('old', { createdAt: '2026-01-01T00:00:00.000Z' }));
    await storage.customOrders.insert(customOrder('new', { createdAt: '2026-03-01T00:00:00.000Z', status: 'approved' }));
    await storage.customOrders.insert(customOrder('mid', { createdAt: '2026-02-01T00:00:00.000Z' }));
    expect((await storage.customOrders.list({ limit: 10 })).map((o) => o.id)).toEqual(['new', 'mid', 'old']);
    expect((await storage.customOrders.list({ limit: 1 })).map((o) => o.id)).toEqual(['new']);
    expect((await storage.customOrders.list({ status: 'submitted', limit: 10 })).map((o) => o.id)).toEqual(['mid', 'old']);
    expect(await storage.customOrders.get('old')).toEqual(customOrder('old', { createdAt: '2026-01-01T00:00:00.000Z' }));
    // Print requests and catalog orders are separate collections.
    expect(await storage.orders.list({ limit: 10 })).toEqual([]);

    const updated = await storage.customOrders.update('old', {
      status: 'approved', quotedPrice: 42.5, adminNote: 'PETG', updatedAt: '2026-04-01T00:00:00.000Z',
    });
    expect(updated).toMatchObject({ id: 'old', status: 'approved', quotedPrice: 42.5, adminNote: 'PETG', files: [{ quantity: 2 }] });
    expect(await storage.customOrders.get('old')).toEqual(updated);
    expect((await storage.customOrders.list({ status: 'approved', limit: 10 })).map((o) => o.id)).toEqual(['new', 'old']);
    expect(await storage.customOrders.update('missing', { status: 'rejected' })).toBeNull();
    expect((await storage.customOrders.delete('old'))?.files[0].fileName).toBe('wazon łódź.stl');
    expect(await storage.customOrders.delete('old')).toBeNull();
    expect(await storage.customOrders.get('old')).toBeNull();
  });

  it('reports a taken print request number', async () => {
    await storage.customOrders.insert(customOrder('first', { number: 'CP-261101-AAAA' }));
    await expect(storage.customOrders.insert(customOrder('second', { number: 'CP-261101-AAAA' })))
      .rejects.toBeInstanceOf(DuplicateOrderNumberError);
    // The same number as a catalog order is no conflict: the prefixes differ in practice, the collections always.
    await storage.orders.insert(order('catalog', { number: 'CP-261101-AAAA' }));
  });

  it('claims each customer upload for exactly one request and lists uploads with metadata', async () => {
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
      ({ id, orderKind: 'order', orderId: 'o1', createdAt: at, type: 'status', from: null, to: 'pending', ...patch }) as LogEntry;
    await storage.logBook.insert(entry('placed'));
    // Same millisecond: insertion order decides, so an email follows the status change it announces.
    await storage.logBook.insert(entry('paid', { createdAt: '2026-11-02T10:00:00.000Z', from: 'pending', to: 'paid' } as Partial<LogEntry>));
    await storage.logBook.insert(entry('email', {
      createdAt: '2026-11-02T10:00:00.000Z', type: 'emailSent', to: 'a@example.com', subject: 'Paid', body: 'Thanks',
      template: 'order.paid', delivery: 'sent', messageId: '<m1@shop>',
    } as Partial<LogEntry>));
    await storage.logBook.insert(entry('other-order', { orderId: 'o2' }));
    await storage.logBook.insert(entry('same-id-other-kind', { orderKind: 'customOrder' }));
    expect((await storage.logBook.list('order', 'o1')).map((e) => e.id)).toEqual(['email', 'paid', 'placed']);
    expect(await storage.logBook.get('order', 'o1', 'paid')).toMatchObject({ type: 'status', from: 'pending', to: 'paid' });
    expect(await storage.logBook.get('order', 'o2', 'paid')).toBeNull();
    expect(await storage.logBook.hasMessageId('order', 'o1', '<m1@shop>')).toBe(true);
    expect(await storage.logBook.hasMessageId('order', 'o2', '<m1@shop>')).toBe(false);
    expect((await storage.logBook.deleteForOrder('order', 'o1')).map((e) => e.id).sort()).toEqual(['email', 'paid', 'placed']);
    expect(await storage.logBook.list('order', 'o1')).toEqual([]);
    expect((await storage.logBook.list('order', 'o2')).map((e) => e.id)).toEqual(['other-order']);
    expect((await storage.logBook.list('customOrder', 'o1')).map((e) => e.id)).toEqual(['same-id-other-kind']);
    await storage.logBook.deleteForOrder('order', 'o2');
    await storage.logBook.deleteForOrder('customOrder', 'o1');
  });

  it('stores the email templates document and keeps mail files in their own bucket', async () => {
    const templates = createSeedEmailTemplates('2026-01-01T00:00:00.000Z');
    await storage.emailTemplates.put(templates);
    expect(await storage.emailTemplates.get()).toEqual(templates);
    const edited = { ...templates, templates: { ...templates.templates, 'order.paid': { subject: 'Paid {{orderNumber}}', body: 'x' } } };
    await storage.emailTemplates.put(edited);
    expect((await storage.emailTemplates.get())?.templates['order.paid'].subject).toBe('Paid {{orderNumber}}');
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
        await migrated.customOrders.insert(customOrder('legacy'));
        await migrated.projectOrders.insert(projectOrder('legacy'));
        await migrated.prepare();
        expect(await migrated.settings.getPricing()).toEqual(pricing);
        expect(await migrated.printSettings.get()).toEqual(printSettings);
        expect((await migrated.customOrders.get('legacy'))?.number).toBe('CP-legacy');
        expect((await migrated.projectOrders.get('legacy'))?.number).toBe('PJ-legacy');
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
    await first.projectOrders.insert(projectOrder('kept-project'));
    const fileId = await first.mediaFiles.upload('image.png', Buffer.from('png'), { contentType: 'image/png' });
    await first.close();

    const second = sqliteStorage(path);
    await second.prepare();
    expect(await seedProducts(second)).toBe(0);
    expect(await second.products.count()).toBe(createSeedProducts().length);
    expect((await second.orders.get('kept'))?.customer.name).toBe('Zoë Łukasiewicz');
    expect((await second.projectOrders.get('kept-project'))?.project.title).toBe('Planter „deluxe”');
    expect((await second.mediaFiles.find(fileId))?.length).toBe(3);
    expect(second.description).toBe(`SQLite database ${path}`);
    await second.close();
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
