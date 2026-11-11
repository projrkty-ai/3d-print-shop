import { GridFSBucket, MongoClient, MongoServerError, ObjectId, type Collection, type Db, type Document } from 'mongodb';
import { printerNameKey } from '../domain/printers';
import type { EmailTemplates, LogEntry, Order, PricingSettings, Printer, PrinterModel, PrintSettings, Product, ProjectProduct } from '../domain/types';
import {
  DuplicateNameError, DuplicateOrderNumberError, FILE_ID, type CustomerFileStore, type FileStore, type NamedStore, type OrderStore, type Storage,
} from './types';
import {
  isUnifiedOrder, upgradeCatalogOrder, upgradeCustomOrder, upgradeLegacyProjectOrder, upgradeLogEntry, upgradeProjectProduct,
} from './upgrades';

/** Documents carry their own string `id`; Mongo's `_id` never leaves the server. */
const withoutMongoId = { projection: { _id: 0 } } as const;

function gridFsStore(bucket: GridFSBucket): FileStore {
  const objectId = (id: string) => (FILE_ID.test(id) ? new ObjectId(id) : null);
  return {
    async upload(fileName, data, metadata) {
      const upload = bucket.openUploadStream(fileName, { metadata });
      await new Promise<void>((resolve, reject) => {
        upload.once('finish', () => resolve());
        upload.once('error', reject);
        upload.end(data);
      });
      return upload.id.toHexString();
    },
    async find(id) {
      const _id = objectId(id);
      const [file] = _id ? await bucket.find({ _id }).toArray() : [];
      return file ? { id, fileName: file.filename, length: file.length, metadata: file.metadata ?? {} } : null;
    },
    openDownloadStream: (id) => bucket.openDownloadStream(new ObjectId(id)),
    async delete(id) {
      const _id = objectId(id);
      if (!_id) return;
      await bucket.delete(_id).catch((err: unknown) => {
        // Already gone (e.g. deleted concurrently) is fine.
        if (!(err instanceof Error && /not found/i.test(err.message))) throw err;
      });
    },
    async ids() {
      return (await bucket.find({}, { projection: { _id: 1 } }).toArray()).map((file) => file._id.toHexString());
    },
  };
}

/** GridFS keeps file metadata in `<bucket>.files`; claiming updates it in place. */
function customerFileStore(db: Db, bucketName: string): CustomerFileStore {
  const bucket = new GridFSBucket(db, { bucketName });
  const files = db.collection(`${bucketName}.files`);
  return {
    ...gridFsStore(bucket),
    async claim(id, orderId) {
      if (!FILE_ID.test(id)) return false;
      const result = await files.updateOne(
        { _id: new ObjectId(id), 'metadata.orderId': { $exists: false } },
        { $set: { 'metadata.orderId': orderId } },
      );
      return result.modifiedCount > 0;
    },
    async list() {
      return (await bucket.find({}).sort({ uploadDate: 1, _id: 1 }).toArray()).map((file) => ({
        id: file._id.toHexString(), fileName: file.filename, length: file.length, metadata: file.metadata ?? {},
      }));
    },
  };
}
/** Orders: whole documents with a unique number and an indexed status and source. */
function orderStore(collection: Collection<Document>): OrderStore {
  return {
    async insert(order) {
      try {
        // Copies, because the driver adds `_id` to the inserted object.
        await collection.insertOne({ ...order });
      } catch (err) {
        if (err instanceof MongoServerError && err.code === 11000 && /number/.test(err.message)) {
          throw new DuplicateOrderNumberError(order.number);
        }
        throw err;
      }
    },
    list: async ({ status, source, limit }) =>
      (await collection.find({ ...(status && { status }), ...(source && { source }) }, withoutMongoId)
        .sort({ createdAt: -1, _id: -1 }).limit(limit).toArray()) as unknown as Order[],
    get: async (id) => (await collection.findOne({ id }, withoutMongoId)) as unknown as Order | null,
    update: async (id, changes) =>
      (await collection.findOneAndUpdate({ id }, { $set: changes }, { ...withoutMongoId, returnDocument: 'after' })) as unknown as Order | null,
    delete: async (id) => (await collection.deleteOne({ id })).deletedCount > 0,
  };
}

/** Printers and printer models carry a `nameKey` (the name lowercased) for the unique index; it never leaves the server. */
function namedStore<T extends { id: string; name: string }>(collection: Collection<Document>): NamedStore<T> {
  const projection = { projection: { _id: 0, nameKey: 0 } } as const;
  const document = (value: T) => ({ ...value, nameKey: printerNameKey(value.name) });
  const uniquely = async <R>(value: T, run: () => Promise<R>): Promise<R> => {
    try {
      return await run();
    } catch (err) {
      if (err instanceof MongoServerError && err.code === 11000 && /nameKey/.test(err.message)) throw new DuplicateNameError(value.name);
      throw err;
    }
  };
  return {
    list: async () => ((await collection.find({}, projection).toArray()) as unknown as T[]).sort((a, b) => a.name.localeCompare(b.name)),
    get: async (id) => (await collection.findOne({ id }, projection)) as unknown as T | null,
    async insert(value) {
      await uniquely(value, () => collection.insertOne(document(value)));
    },
    replace: (value) => uniquely(value, async () => (await collection.replaceOne({ id: value.id }, document(value))).matchedCount > 0),
    delete: async (id) => (await collection.findOneAndDelete({ id }, projection)) as unknown as T | null,
  };
}

/** Storage on an open database; the caller owns the connection unless `client` is given. */
export function mongoStorage(db: Db, client?: MongoClient, description = `MongoDB database "${db.databaseName}"`): Storage {
  const products = db.collection<Product>('products');
  const orders = db.collection('orders');
  /** Named documents such as `{ key: 'printSettings', value: {...} }`. */
  const settings = db.collection<{ key: string; value: PrintSettings | EmailTemplates | PricingSettings }>('settings');
  const logEntries = db.collection<LogEntry>('logEntries');
  const setting = <T extends PrintSettings | EmailTemplates | PricingSettings>(key: string) => {
    const collection = db.collection<{ key: string; value: T }>('settings');
    return {
      get: async () => (await collection.findOne({ key }))?.value ?? null,
      async put(value: T) {
        await collection.replaceOne({ key }, { key, value }, { upsert: true });
      },
    };
  };
  const projectProducts = db.collection<ProjectProduct>('projectProducts');
  const printers = db.collection('printers');
  const printerModels = db.collection('printerModels');
  /**
   * Orders of every source share the `orders` collection: catalog orders get the unified shape, and
   * print requests (`customOrders`) and project orders (`projectOrders`) move in — ids and numbers
   * are kept, so log books, uploads and links stay valid. Log entries lose their order kind. Safe to
   * repeat, also after an interruption.
   */
  async function migrateOrders() {
    for (const document of await orders.find({ price: { $exists: false } }, withoutMongoId).toArray()) {
      if (!isUnifiedOrder(document)) await orders.replaceOne({ id: document.id }, { ...upgradeCatalogOrder(document) });
    }
    for (const [name, upgrade] of [['customOrders', upgradeCustomOrder], ['projectOrders', upgradeLegacyProjectOrder]] as const) {
      const legacy = db.collection(name);
      for (const document of await legacy.find({}, withoutMongoId).toArray()) {
        const order = upgrade(document);
        await orders.updateOne({ id: order.id }, { $setOnInsert: { ...order } }, { upsert: true });
        await legacy.deleteOne({ id: order.id });
      }
      if ((await db.listCollections({ name }).toArray()).length > 0) await legacy.drop();
    }
    for (const document of await logEntries.find({ orderKind: { $exists: true } }, withoutMongoId).toArray()) {
      const entry = upgradeLogEntry(document as unknown as Record<string, unknown>);
      if (entry) await logEntries.replaceOne({ id: entry.id }, { ...entry });
    }
    const indexes = await logEntries.listIndexes().toArray().catch(() => []);
    for (const index of indexes) {
      if (index.key && 'orderKind' in index.key) await logEntries.dropIndex(index.name as string);
    }
  }

  return {
    kind: 'mongodb',
    description,
    products: {
      list: ({ publishedOnly = false } = {}) =>
        products.find(publishedOnly ? { published: true } : {}, withoutMongoId).sort({ createdAt: 1 }).toArray(),
      get: (id) => products.findOne({ id }, withoutMongoId),
      getMany: (ids) => products.find({ id: { $in: ids } }, withoutMongoId).toArray(),
      ids: () => products.distinct('id'),
      count: () => products.countDocuments(),
      async insert(product) {
        // Copies, because the driver adds `_id` to the inserted object.
        await products.insertOne({ ...product });
      },
      async insertMany(list) {
        if (list.length > 0) await products.insertMany(list.map((product) => ({ ...product })));
      },
      async replace(product) {
        return (await products.replaceOne({ id: product.id }, { ...product })).matchedCount > 0;
      },
      delete: (id) => products.findOneAndDelete({ id }, withoutMongoId),
      async deleteAll() {
        await products.deleteMany({});
      },
      meshUrls: async () => (await products.distinct('mesh.url')).filter((url): url is string => typeof url === 'string'),
      isMeshUrlUsed: async (url) => (await products.countDocuments({ 'mesh.url': url }, { limit: 1 })) > 0,
    },
    orders: orderStore(orders),
    projectProducts: {
      list: ({ publishedOnly = false } = {}) =>
        projectProducts.find(publishedOnly ? { published: true } : {}, withoutMongoId).sort({ createdAt: -1, _id: -1 }).toArray(),
      get: (id) => projectProducts.findOne({ id }, withoutMongoId),
      async insert(product) {
        await projectProducts.insertOne({ ...product });
      },
      replace: async (product) => (await projectProducts.replaceOne({ id: product.id }, { ...product })).matchedCount > 0,
      delete: async (id) => (await projectProducts.deleteOne({ id })).deletedCount > 0,
    },
    settings: {
      getPricing: setting<PricingSettings>('pricing').get,
      putPricing: setting<PricingSettings>('pricing').put,
    },
    modelFiles: gridFsStore(new GridFSBucket(db, { bucketName: 'modelFiles' })),
    mediaFiles: gridFsStore(new GridFSBucket(db, { bucketName: 'mediaFiles' })),
    customerFiles: customerFileStore(db, 'customerFiles'),
    printSettings: setting<PrintSettings>('printSettings'),
    emailTemplates: setting<EmailTemplates>('emailTemplates'),
    logBook: {
      async insert(entry) {
        await logEntries.insertOne({ ...entry });
      },
      // `_id` grows with insertion, so it orders entries created in the same millisecond.
      list: (orderId) =>
        logEntries.find({ orderId }, withoutMongoId).sort({ createdAt: -1, _id: -1 }).toArray(),
      get: (orderId, id) => logEntries.findOne({ orderId, id }, withoutMongoId),
      hasMessageId: async (orderId, messageId) =>
        (await logEntries.countDocuments({ orderId, messageId }, { limit: 1 })) > 0,
      async deleteForOrder(orderId) {
        const entries = await logEntries.find({ orderId }, withoutMongoId).toArray();
        await logEntries.deleteMany({ orderId });
        return entries;
      },
    },
    mailFiles: gridFsStore(new GridFSBucket(db, { bucketName: 'mailFiles' })),
    printers: namedStore<Printer>(printers),
    printerModels: namedStore<PrinterModel>(printerModels),
    printerFiles: gridFsStore(new GridFSBucket(db, { bucketName: 'printerFiles' })),
    async prepare() {
      const legacySettings = db.collection<PricingSettings & { id: string }>('settings');
      if (await legacySettings.countDocuments()) {
        const indexes = await legacySettings.listIndexes().toArray();
        const legacyIdIndex = indexes.find((index) => index.name === 'id_1');
        if (legacyIdIndex) await legacySettings.dropIndex('id_1');
        const legacyPricing = await legacySettings.findOne({ id: 'pricing' });
        if (legacyPricing) {
          const { _id, id: _idKey, ...value } = legacyPricing;
          await settings.replaceOne({ _id }, { key: 'pricing', value });
        }
      }
      await Promise.all([
        products.createIndex({ id: 1 }, { unique: true }),
        orders.createIndex({ id: 1 }, { unique: true }),
        orders.createIndex({ number: 1 }, { unique: true }),
        orders.createIndex({ createdAt: -1 }),
        orders.createIndex({ status: 1, createdAt: -1 }),
        orders.createIndex({ source: 1, createdAt: -1 }),
        settings.createIndex({ key: 1 }, { unique: true }),
        logEntries.createIndex({ id: 1 }, { unique: true }),
        logEntries.createIndex({ orderId: 1, createdAt: -1 }),
        logEntries.createIndex({ orderId: 1, messageId: 1 }),
        projectProducts.createIndex({ id: 1 }, { unique: true }),
        projectProducts.createIndex({ published: 1, createdAt: -1 }),
        printers.createIndex({ id: 1 }, { unique: true }),
        printers.createIndex({ nameKey: 1 }, { unique: true }),
        printerModels.createIndex({ id: 1 }, { unique: true }),
        printerModels.createIndex({ nameKey: 1 }, { unique: true }),
      ]);
      // Products saved before plate support.
      await products.updateMany(
        { mesh: { $type: 'object' }, 'mesh.plates': { $exists: false } },
        { $set: { 'mesh.plates': [], 'mesh.plate': null } },
      );
      await migrateOrders();
      // Ready-to-print products saved by earlier versions.
      for (const document of await projectProducts.find({ measurements: { $exists: false } }, withoutMongoId).toArray()) {
        const upgraded = upgradeProjectProduct(document as unknown as Record<string, unknown>);
        if (upgraded) await projectProducts.replaceOne({ id: upgraded.id }, { ...upgraded });
      }
    },
    async close() {
      await client?.close();
    },
  };
}

export async function connectMongo(uri: string): Promise<Storage> {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  // Never log credentials that may be part of the URI (multi-host URIs aren't valid WHATWG URLs).
  const hosts = uri.replace(/^mongodb(\+srv)?:\/\/([^@/]*@)?/, '').split(/[/?]/)[0];
  return mongoStorage(db, client, `MongoDB ${hosts}/${db.databaseName}`);
}
