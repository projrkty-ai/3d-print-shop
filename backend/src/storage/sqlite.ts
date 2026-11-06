import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { Readable } from 'node:stream';
import type { Order, Product } from '../domain/types';
import { DuplicateOrderNumberError, FILE_ID, type FileStore, type Storage } from './types';

/**
 * Documents are stored as JSON, exactly as the API returns them, next to indexed columns
 * for the fields the API filters and sorts on. Uploaded files are BLOBs in the same file.
 * Bump SCHEMA_VERSION and extend `migrate` when the table layout changes.
 */
const SCHEMA_VERSION = 1;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    published INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    mesh_url TEXT,
    document TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS products_created_at ON products (created_at);
  CREATE INDEX IF NOT EXISTS products_mesh_url ON products (mesh_url);

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    document TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS orders_created_at ON orders (created_at DESC);
  CREATE INDEX IF NOT EXISTS orders_status_created_at ON orders (status, created_at DESC);

  CREATE TABLE IF NOT EXISTS files (
    bucket TEXT NOT NULL,
    id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    length INTEGER NOT NULL,
    metadata TEXT NOT NULL,
    data BLOB NOT NULL,
    PRIMARY KEY (bucket, id)
  );
`;

type Row = Record<string, SQLInputValue>;
const parse = <T>(row: Row | undefined): T | null => (row ? (JSON.parse(row.document as string) as T) : null);

function productColumns(product: Product) {
  return {
    id: product.id,
    published: product.published ? 1 : 0,
    created_at: product.createdAt,
    mesh_url: product.mesh?.url ?? null,
    document: JSON.stringify(product),
  };
}

function fileStore(db: DatabaseSync, bucket: 'modelFiles' | 'mediaFiles'): FileStore {
  const insert = db.prepare('INSERT INTO files (bucket, id, file_name, length, metadata, data) VALUES (?, ?, ?, ?, ?, ?)');
  const select = db.prepare('SELECT id, file_name, length, metadata FROM files WHERE bucket = ? AND id = ?');
  const content = db.prepare('SELECT data FROM files WHERE bucket = ? AND id = ?');
  const remove = db.prepare('DELETE FROM files WHERE bucket = ? AND id = ?');
  const list = db.prepare('SELECT id FROM files WHERE bucket = ? ORDER BY rowid');
  return {
    async upload(fileName, data, metadata) {
      // Same 12-byte hex format as MongoDB ObjectIds, so file URLs look the same in either store.
      const id = randomBytes(12).toString('hex');
      insert.run(bucket, id, fileName, data.length, JSON.stringify(metadata), data);
      return id;
    },
    async find(id) {
      if (!FILE_ID.test(id)) return null;
      const row = select.get(bucket, id);
      return row ? {
        id, fileName: row.file_name as string, length: row.length as number,
        metadata: JSON.parse(row.metadata as string) as Record<string, unknown>,
      } : null;
    },
    openDownloadStream(id) {
      const row = content.get(bucket, id);
      if (!row) return Readable.from([]).destroy(new Error(`File ${id} not found.`));
      const data = row.data as Uint8Array;
      return Readable.from([Buffer.from(data.buffer, data.byteOffset, data.byteLength)]);
    },
    async delete(id) {
      remove.run(bucket, id);
    },
    async ids() {
      return list.all(bucket).map((row) => row.id as string);
    },
  };
}

/**
 * SQLite storage in one file (or `:memory:`), using Node's built-in `node:sqlite`
 * (Node.js 22.13+). Meant for local development and single-process installations.
 */
export function sqliteStorage(path: string): Storage {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);

  const transaction = (run: () => void) => {
    db.exec('BEGIN');
    try {
      run();
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };

  const product = {
    list: db.prepare('SELECT document FROM products ORDER BY created_at, rowid'),
    listPublished: db.prepare('SELECT document FROM products WHERE published = 1 ORDER BY created_at, rowid'),
    get: db.prepare('SELECT document FROM products WHERE id = ?'),
    ids: db.prepare('SELECT id FROM products'),
    count: db.prepare('SELECT COUNT(*) AS count FROM products'),
    insert: db.prepare(
      'INSERT INTO products (id, published, created_at, mesh_url, document) VALUES (:id, :published, :created_at, :mesh_url, :document)',
    ),
    // An UPDATE keeps the rowid, and with it the product's place among equal creation times.
    replace: db.prepare(
      'UPDATE products SET published = :published, created_at = :created_at, mesh_url = :mesh_url, document = :document WHERE id = :id',
    ),
    delete: db.prepare('DELETE FROM products WHERE id = ?'),
    deleteAll: db.prepare('DELETE FROM products'),
    meshUrls: db.prepare('SELECT DISTINCT mesh_url FROM products WHERE mesh_url IS NOT NULL'),
    meshUrlUsed: db.prepare('SELECT 1 FROM products WHERE mesh_url = ? LIMIT 1'),
  };
  const order = {
    insert: db.prepare(
      'INSERT INTO orders (id, number, status, created_at, document) VALUES (:id, :number, :status, :created_at, :document)',
    ),
    list: db.prepare('SELECT document FROM orders ORDER BY created_at DESC, rowid DESC LIMIT ?'),
    listByStatus: db.prepare('SELECT document FROM orders WHERE status = ? ORDER BY created_at DESC, rowid DESC LIMIT ?'),
    get: db.prepare('SELECT document FROM orders WHERE id = ?'),
    update: db.prepare('UPDATE orders SET status = :status, document = :document WHERE id = :id'),
    delete: db.prepare('DELETE FROM orders WHERE id = ?'),
  };

  return {
    kind: 'sqlite',
    description: path === ':memory:' ? 'SQLite (in memory)' : `SQLite database ${path}`,
    products: {
      list: async ({ publishedOnly = false } = {}) =>
        (publishedOnly ? product.listPublished : product.list).all().map((row) => parse<Product>(row)!),
      get: async (id) => parse<Product>(product.get.get(id)),
      async getMany(ids) {
        return ids.flatMap((id) => {
          const found = parse<Product>(product.get.get(id));
          return found ? [found] : [];
        });
      },
      ids: async () => product.ids.all().map((row) => row.id as string),
      count: async () => product.count.get()!.count as number,
      async insert(value) {
        product.insert.run(productColumns(value));
      },
      async insertMany(values) {
        transaction(() => values.forEach((value) => product.insert.run(productColumns(value))));
      },
      replace: async (value) => product.replace.run(productColumns(value)).changes > 0,
      async delete(id) {
        const existing = parse<Product>(product.get.get(id));
        if (existing) product.delete.run(id);
        return existing;
      },
      async deleteAll() {
        product.deleteAll.run();
      },
      meshUrls: async () => product.meshUrls.all().map((row) => row.mesh_url as string),
      isMeshUrlUsed: async (url) => product.meshUrlUsed.get(url) !== undefined,
    },
    orders: {
      async insert(value) {
        try {
          order.insert.run({
            id: value.id, number: value.number, status: value.status, created_at: value.createdAt, document: JSON.stringify(value),
          });
        } catch (err) {
          if (err instanceof Error && /UNIQUE constraint failed: orders\.number/.test(err.message)) {
            throw new DuplicateOrderNumberError(value.number);
          }
          throw err;
        }
      },
      list: async ({ status, limit }) =>
        (status ? order.listByStatus.all(status, limit) : order.list.all(limit)).map((row) => parse<Order>(row)!),
      get: async (id) => parse<Order>(order.get.get(id)),
      async update(id, changes) {
        const existing = parse<Order>(order.get.get(id));
        if (!existing) return null;
        const updated = { ...existing, ...changes };
        order.update.run({ id, status: updated.status, document: JSON.stringify(updated) });
        return updated;
      },
      delete: async (id) => order.delete.run(id).changes > 0,
    },
    modelFiles: fileStore(db, 'modelFiles'),
    mediaFiles: fileStore(db, 'mediaFiles'),
    async prepare() {
      const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
      if (version > SCHEMA_VERSION) {
        throw new Error(`${path} was created by a newer version of this application (schema ${version}).`);
      }
      // Products saved before plate support, e.g. imported from an older export.
      transaction(() => {
        for (const row of product.list.all()) {
          const value = parse<Product>(row)!;
          if (value.mesh && !Array.isArray(value.mesh.plates)) {
            product.replace.run(productColumns({ ...value, mesh: { ...value.mesh, plates: [], plate: null } }));
          }
        }
      });
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    },
    async close() {
      if (db.isOpen) db.close();
    },
  };
}
