import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSeedProducts } from '../domain/data/seedProducts';
import type { Order, Product } from '../domain/types';
import { DuplicateOrderNumberError, pruneModelFiles, releaseModelFile, seedProducts, storageConfig, type Storage } from './index';
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

describe(`${process.env.TEST_DATABASE ?? 'sqlite'} storage contract`, () => {
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

  it('reports a taken order number so checkout can draw another', async () => {
    await storage.orders.insert(order('first', { number: 'PF-261101-AAAA' }));
    await expect(storage.orders.insert(order('second', { number: 'PF-261101-AAAA' })))
      .rejects.toBeInstanceOf(DuplicateOrderNumberError);
    expect((await storage.orders.list({ limit: 10 })).map((o) => o.id)).toEqual(['first']);
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

  it('keeps data across restarts in a file, creating missing directories', async () => {
    const { sqliteStorage } = await import('./sqlite');
    const path = join(directory, 'nested', 'shop.sqlite');
    const first = sqliteStorage(path);
    await first.prepare();
    await seedProducts(first);
    await first.orders.insert(order('kept'));
    const fileId = await first.mediaFiles.upload('image.png', Buffer.from('png'), { contentType: 'image/png' });
    await first.close();

    const second = sqliteStorage(path);
    await second.prepare();
    expect(await seedProducts(second)).toBe(0);
    expect(await second.products.count()).toBe(createSeedProducts().length);
    expect((await second.orders.get('kept'))?.customer.name).toBe('Zoë Łukasiewicz');
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
    const future = sqliteStorage(path);
    await expect(future.prepare()).rejects.toThrow('newer version');
    await future.close();
  });
});

describe('storage configuration', () => {
  it('uses SQLite for development and MongoDB in production unless DATABASE says otherwise', () => {
    expect(storageConfig({})).toEqual({ kind: 'sqlite', path: join(process.cwd(), 'data/printforge.sqlite') });
    expect(storageConfig({ SQLITE_PATH: '/tmp/shop.sqlite' })).toEqual({ kind: 'sqlite', path: '/tmp/shop.sqlite' });
    expect(storageConfig({ NODE_ENV: 'production' })).toEqual({ kind: 'mongodb', uri: 'mongodb://localhost:27017/printforge' });
    expect(storageConfig({ NODE_ENV: 'production', DATABASE: 'sqlite' }).kind).toBe('sqlite');
    expect(storageConfig({ DATABASE: 'mongodb', MONGODB_URI: 'mongodb://db:27017/shop' })).toEqual({ kind: 'mongodb', uri: 'mongodb://db:27017/shop' });
    expect(() => storageConfig({ DATABASE: 'postgres' })).toThrow('DATABASE must be "sqlite" or "mongodb"');
  });
});
