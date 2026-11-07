import { GridFSBucket, MongoClient, MongoServerError, ObjectId, type Collection, type Db, type Document } from 'mongodb';
import type { CustomOrder, EmailTemplates, LogEntry, PricingSettings, PrintSettings, Product, ProjectProduct } from '../domain/types';
import { DuplicateOrderNumberError, FILE_ID, type CustomerFileStore, type DocumentStore, type FileStore, type Storage } from './types';
import { upgradeProjectOrder, upgradeProjectProduct } from './upgrades';

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
type OrderLike = { id: string; number: string; status: string; createdAt: string; updatedAt: string; adminNote: string };

/** Orders and project orders: whole documents with a unique number and an indexed status. */
function documentStore<T extends OrderLike>(collection: Collection<Document>): DocumentStore<T> {
  return {
    async insert(document) {
      try {
        // Copies, because the driver adds `_id` to the inserted object.
        await collection.insertOne({ ...document });
      } catch (err) {
        if (err instanceof MongoServerError && err.code === 11000 && /number/.test(err.message)) {
          throw new DuplicateOrderNumberError(document.number);
        }
        throw err;
      }
    },
    list: async ({ status, limit }) =>
      (await collection.find(status ? { status } : {}, withoutMongoId).sort({ createdAt: -1 }).limit(limit).toArray()) as unknown as T[],
    get: async (id) => (await collection.findOne({ id }, withoutMongoId)) as unknown as T | null,
    update: async (id, changes) =>
      (await collection.findOneAndUpdate({ id }, { $set: changes }, { ...withoutMongoId, returnDocument: 'after' })) as unknown as T | null,
    delete: async (id) => (await collection.deleteOne({ id })).deletedCount > 0,
  };
}

async function prepareOrders(collection: Collection<Document>) {
  await Promise.all([
    collection.createIndex({ id: 1 }, { unique: true }),
    collection.createIndex({ number: 1 }, { unique: true }),
    collection.createIndex({ createdAt: -1 }),
    collection.createIndex({ status: 1, createdAt: -1 }),
  ]);
}

/** Storage on an open database; the caller owns the connection unless `client` is given. */
export function mongoStorage(db: Db, client?: MongoClient, description = `MongoDB database "${db.databaseName}"`): Storage {
  const products = db.collection<Product>('products');
  const orders = db.collection('orders');
  const customOrders = db.collection<CustomOrder>('customOrders');
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
  const projectOrders = db.collection('projectOrders');
  const projectProducts = db.collection<ProjectProduct>('projectProducts');
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
    orders: documentStore(orders),
    projectOrders: documentStore(projectOrders),
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
    customOrders: {
      async insert(order) {
        try {
          await customOrders.insertOne({ ...order });
        } catch (err) {
          if (err instanceof MongoServerError && err.code === 11000 && /number/.test(err.message)) {
            throw new DuplicateOrderNumberError(order.number);
          }
          throw err;
        }
      },
      list: ({ status, limit }) =>
        customOrders.find(status ? { status } : {}, withoutMongoId).sort({ createdAt: -1 }).limit(limit).toArray(),
      get: (id) => customOrders.findOne({ id }, withoutMongoId),
      update: (id, changes) =>
        customOrders.findOneAndUpdate({ id }, { $set: changes }, { ...withoutMongoId, returnDocument: 'after' }),
      delete: (id) => customOrders.findOneAndDelete({ id }, withoutMongoId),
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
      list: (orderKind, orderId) =>
        logEntries.find({ orderKind, orderId }, withoutMongoId).sort({ createdAt: -1, _id: -1 }).toArray(),
      get: (orderKind, orderId, id) => logEntries.findOne({ orderKind, orderId, id }, withoutMongoId),
      hasMessageId: async (orderKind, orderId, messageId) =>
        (await logEntries.countDocuments({ orderKind, orderId, messageId }, { limit: 1 })) > 0,
      async deleteForOrder(orderKind, orderId) {
        const entries = await logEntries.find({ orderKind, orderId }, withoutMongoId).toArray();
        await logEntries.deleteMany({ orderKind, orderId });
        return entries;
      },
    },
    mailFiles: gridFsStore(new GridFSBucket(db, { bucketName: 'mailFiles' })),
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
        customOrders.createIndex({ id: 1 }, { unique: true }),
        customOrders.createIndex({ number: 1 }, { unique: true }),
        customOrders.createIndex({ createdAt: -1 }),
        customOrders.createIndex({ status: 1, createdAt: -1 }),
        settings.createIndex({ key: 1 }, { unique: true }),
        logEntries.createIndex({ id: 1 }, { unique: true }),
        logEntries.createIndex({ orderKind: 1, orderId: 1, createdAt: -1 }),
        logEntries.createIndex({ orderKind: 1, orderId: 1, messageId: 1 }),
        prepareOrders(projectOrders),
        projectProducts.createIndex({ id: 1 }, { unique: true }),
        projectProducts.createIndex({ published: 1, createdAt: -1 }),
      ]);
      // Products saved before plate support.
      await products.updateMany(
        { mesh: { $type: 'object' }, 'mesh.plates': { $exists: false } },
        { $set: { 'mesh.plates': [], 'mesh.plate': null } },
      );
      // Project orders and ready-to-print products saved by earlier versions.
      const outdated = { $or: [{ items: { $exists: false } }, { requiresQuote: { $exists: false } }] };
      for (const document of await projectOrders.find(outdated, withoutMongoId).toArray()) {
        const upgraded = upgradeProjectOrder(document);
        if (upgraded) await projectOrders.replaceOne({ id: upgraded.id }, { ...upgraded });
      }
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
