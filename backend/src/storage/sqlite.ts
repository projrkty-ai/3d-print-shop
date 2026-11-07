import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { Readable } from 'node:stream';
import type { CustomOrder, EmailTemplates, LogEntry, Order, PricingSettings, PrintSettings, Product, ProjectProduct } from '../domain/types';
import { DuplicateOrderNumberError, FILE_ID, type CustomerFileStore, type DocumentStore, type FileStore, type Storage } from './types';
import { upgradeProjectOrder, upgradeProjectProduct } from './upgrades';

/**
 * Documents are stored as JSON, exactly as the API returns them, next to indexed columns
 * for the fields the API filters and sorts on. Uploaded files are BLOBs in the same file.
 * Bump SCHEMA_VERSION and extend `migrate` when the table layout changes.
 */
const SCHEMA_VERSION = 4;

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

  -- Added in schema 2: print requests for customers' own model files, and their print options.
  CREATE TABLE IF NOT EXISTS log_entries (
    id TEXT PRIMARY KEY,
    order_kind TEXT NOT NULL,
    order_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    message_id TEXT,
    document TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS log_entries_order ON log_entries (order_kind, order_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    document TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS custom_orders (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    document TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS custom_orders_created_at ON custom_orders (created_at DESC);
  CREATE INDEX IF NOT EXISTS custom_orders_status_created_at ON custom_orders (status, created_at DESC);

  CREATE TABLE IF NOT EXISTS project_orders (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    document TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS project_orders_created_at ON project_orders (created_at DESC);
  CREATE INDEX IF NOT EXISTS project_orders_status_created_at ON project_orders (status, created_at DESC);

  CREATE TABLE IF NOT EXISTS project_products (
    id TEXT PRIMARY KEY,
    published INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    document TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS project_products_created_at ON project_products (created_at DESC);

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

type OrderLike = { id: string; number: string; status: string; createdAt: string; updatedAt: string; adminNote: string };

/** Orders and project orders: a JSON document per row with the number unique and the status indexed. */
function documentStore<T extends OrderLike>(db: DatabaseSync, table: 'orders' | 'project_orders'): DocumentStore<T> {
  const statement = {
    insert: db.prepare(
      `INSERT INTO ${table} (id, number, status, created_at, document) VALUES (:id, :number, :status, :created_at, :document)`,
    ),
    list: db.prepare(`SELECT document FROM ${table} ORDER BY created_at DESC, rowid DESC LIMIT ?`),
    listByStatus: db.prepare(`SELECT document FROM ${table} WHERE status = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`),
    get: db.prepare(`SELECT document FROM ${table} WHERE id = ?`),
    update: db.prepare(`UPDATE ${table} SET status = :status, document = :document WHERE id = :id`),
    delete: db.prepare(`DELETE FROM ${table} WHERE id = ?`),
  };
  const taken = new RegExp(`UNIQUE constraint failed: ${table}\\.number`);
  return {
    async insert(value) {
      try {
        statement.insert.run({
          id: value.id, number: value.number, status: value.status, created_at: value.createdAt, document: JSON.stringify(value),
        });
      } catch (err) {
        if (err instanceof Error && taken.test(err.message)) throw new DuplicateOrderNumberError(value.number);
        throw err;
      }
    },
    list: async ({ status, limit }) =>
      (status ? statement.listByStatus.all(status, limit) : statement.list.all(limit)).map((row) => parse<T>(row)!),
    get: async (id) => parse<T>(statement.get.get(id)),
    async update(id, changes) {
      const existing = parse<T>(statement.get.get(id));
      if (!existing) return null;
      const updated = { ...existing, ...changes };
      statement.update.run({ id, status: updated.status, document: JSON.stringify(updated) });
      return updated;
    },
    delete: async (id) => statement.delete.run(id).changes > 0,
  };
}

function projectProductStore(db: DatabaseSync): Storage['projectProducts'] {
  const statement = {
    list: db.prepare('SELECT document FROM project_products ORDER BY created_at DESC, rowid DESC'),
    listPublished: db.prepare('SELECT document FROM project_products WHERE published = 1 ORDER BY created_at DESC, rowid DESC'),
    get: db.prepare('SELECT document FROM project_products WHERE id = ?'),
    insert: db.prepare('INSERT INTO project_products (id, published, created_at, document) VALUES (:id, :published, :created_at, :document)'),
    replace: db.prepare('UPDATE project_products SET published = :published, document = :document WHERE id = :id'),
    delete: db.prepare('DELETE FROM project_products WHERE id = ?'),
  };
  const columns = (value: ProjectProduct) => ({
    id: value.id, published: value.published ? 1 : 0, created_at: value.createdAt, document: JSON.stringify(value),
  });
  return {
    list: async ({ publishedOnly = false } = {}) =>
      (publishedOnly ? statement.listPublished : statement.list).all().map((row) => parse<ProjectProduct>(row)!),
    get: async (id) => parse<ProjectProduct>(statement.get.get(id)),
    async insert(value) {
      statement.insert.run(columns(value));
    },
    replace: async (value) => {
      const { created_at: _createdAt, ...changed } = columns(value);
      return statement.replace.run(changed).changes > 0;
    },
    delete: async (id) => statement.delete.run(id).changes > 0,
  };
}

function settingsStore(db: DatabaseSync): Storage['settings'] {
  const get = db.prepare('SELECT document FROM settings WHERE key = ?');
  const put = db.prepare('INSERT INTO settings (key, document) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET document = excluded.document');
  return {
    getPricing: async () => parse<PricingSettings>(get.get('pricing')),
    async putPricing(value) {
      put.run('pricing', JSON.stringify(value));
    },
  };
}

type Bucket = 'modelFiles' | 'mediaFiles' | 'customerFiles' | 'mailFiles';

function fileStore(db: DatabaseSync, bucket: Bucket): FileStore {
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

function customerFileStore(db: DatabaseSync): CustomerFileStore {
  const bucket: Bucket = 'customerFiles';
  // Conditional update: of two concurrent claims, only one changes the row.
  const claim = db.prepare(
    `UPDATE files SET metadata = json_set(metadata, '$.orderId', ?)
     WHERE bucket = ? AND id = ? AND json_extract(metadata, '$.orderId') IS NULL`,
  );
  const list = db.prepare('SELECT id, file_name, length, metadata FROM files WHERE bucket = ? ORDER BY rowid');
  return {
    ...fileStore(db, bucket),
    async claim(id, orderId) {
      return FILE_ID.test(id) && claim.run(orderId, bucket, id).changes > 0;
    },
    async list() {
      return list.all(bucket).map((row) => ({
        id: row.id as string, fileName: row.file_name as string, length: row.length as number,
        metadata: JSON.parse(row.metadata as string) as Record<string, unknown>,
      }));
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
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (version > SCHEMA_VERSION) {
    db.close();
    throw new Error(`${path} was created by a newer version of this application (schema ${version}).`);
  }
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  const settingsColumns = db.prepare("PRAGMA table_info('settings')").all();
  if (settingsColumns.some((column) => column.name === 'id') && !settingsColumns.some((column) => column.name === 'key')) {
    db.exec('ALTER TABLE settings RENAME COLUMN id TO key');
  }
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
  const setting = {
    get: db.prepare('SELECT document FROM settings WHERE key = ?'),
    put: db.prepare('INSERT INTO settings (key, document) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET document = excluded.document'),
  };
  const log = {
    insert: db.prepare(
      'INSERT INTO log_entries (id, order_kind, order_id, created_at, message_id, document) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    list: db.prepare('SELECT document FROM log_entries WHERE order_kind = ? AND order_id = ? ORDER BY created_at DESC, rowid DESC'),
    get: db.prepare('SELECT document FROM log_entries WHERE order_kind = ? AND order_id = ? AND id = ?'),
    messageId: db.prepare('SELECT 1 FROM log_entries WHERE order_kind = ? AND order_id = ? AND message_id = ? LIMIT 1'),
    delete: db.prepare('DELETE FROM log_entries WHERE order_kind = ? AND order_id = ?'),
  };
  const customOrder = {
    insert: db.prepare(
      'INSERT INTO custom_orders (id, number, status, created_at, document) VALUES (:id, :number, :status, :created_at, :document)',
    ),
    list: db.prepare('SELECT document FROM custom_orders ORDER BY created_at DESC, rowid DESC LIMIT ?'),
    listByStatus: db.prepare('SELECT document FROM custom_orders WHERE status = ? ORDER BY created_at DESC, rowid DESC LIMIT ?'),
    get: db.prepare('SELECT document FROM custom_orders WHERE id = ?'),
    update: db.prepare('UPDATE custom_orders SET status = :status, document = :document WHERE id = :id'),
    delete: db.prepare('DELETE FROM custom_orders WHERE id = ?'),
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
    customOrders: {
      async insert(value) {
        try {
          customOrder.insert.run({
            id: value.id, number: value.number, status: value.status, created_at: value.createdAt, document: JSON.stringify(value),
          });
        } catch (err) {
          if (err instanceof Error && /UNIQUE constraint failed: custom_orders\.number/.test(err.message)) {
            throw new DuplicateOrderNumberError(value.number);
          }
          throw err;
        }
      },
      list: async ({ status, limit }) =>
        (status ? customOrder.listByStatus.all(status, limit) : customOrder.list.all(limit)).map((row) => parse<CustomOrder>(row)!),
      get: async (id) => parse<CustomOrder>(customOrder.get.get(id)),
      async update(id, changes) {
        const existing = parse<CustomOrder>(customOrder.get.get(id));
        if (!existing) return null;
        const updated = { ...existing, ...changes };
        customOrder.update.run({ id, status: updated.status, document: JSON.stringify(updated) });
        return updated;
      },
      async delete(id) {
        const existing = parse<CustomOrder>(customOrder.get.get(id));
        if (existing) customOrder.delete.run(id);
        return existing;
      },
    },
    projectOrders: documentStore(db, 'project_orders'),
    projectProducts: projectProductStore(db),
    settings: settingsStore(db),
    modelFiles: fileStore(db, 'modelFiles'),
    mediaFiles: fileStore(db, 'mediaFiles'),
    customerFiles: customerFileStore(db),
    printSettings: {
      get: async () => parse<PrintSettings>(setting.get.get('printSettings')),
      async put(value) {
        setting.put.run('printSettings', JSON.stringify(value));
      },
    },
    emailTemplates: {
      get: async () => parse<EmailTemplates>(setting.get.get('emailTemplates')),
      async put(value) {
        setting.put.run('emailTemplates', JSON.stringify(value));
      },
    },
    logBook: {
      async insert(entry) {
        const messageId = 'messageId' in entry ? entry.messageId ?? null : null;
        log.insert.run(entry.id, entry.orderKind, entry.orderId, entry.createdAt, messageId, JSON.stringify(entry));
      },
      list: async (kind, orderId) => log.list.all(kind, orderId).map((row) => parse<LogEntry>(row)!),
      get: async (kind, orderId, id) => parse<LogEntry>(log.get.get(kind, orderId, id)),
      hasMessageId: async (kind, orderId, messageId) => log.messageId.get(kind, orderId, messageId) !== undefined,
      async deleteForOrder(kind, orderId) {
        const entries = log.list.all(kind, orderId).map((row) => parse<LogEntry>(row)!);
        log.delete.run(kind, orderId);
        return entries;
      },
    },
    mailFiles: fileStore(db, 'mailFiles'),
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
      // Project orders and ready-to-print products saved by earlier versions.
      for (const [table, upgrade] of [['project_orders', upgradeProjectOrder], ['project_products', upgradeProjectProduct]] as const) {
        const rows = db.prepare(`SELECT id, document FROM ${table}`).all();
        const save = db.prepare(`UPDATE ${table} SET document = ? WHERE id = ?`);
        transaction(() => {
          for (const row of rows) {
            const upgraded = upgrade(JSON.parse(row.document as string) as Record<string, unknown>);
            if (upgraded) save.run(JSON.stringify(upgraded), row.id as string);
          }
        });
      }
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    },
    async close() {
      if (db.isOpen) db.close();
    },
  };
}
