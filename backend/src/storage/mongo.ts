import { GridFSBucket, MongoClient, MongoServerError, ObjectId, type Db } from 'mongodb';
import type { Order, Product } from '../domain/types';
import { DuplicateOrderNumberError, FILE_ID, type FileStore, type Storage } from './types';

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

/** Storage on an open database; the caller owns the connection unless `client` is given. */
export function mongoStorage(db: Db, client?: MongoClient, description = `MongoDB database "${db.databaseName}"`): Storage {
  const products = db.collection<Product>('products');
  const orders = db.collection<Order>('orders');
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
    orders: {
      async insert(order) {
        try {
          await orders.insertOne({ ...order });
        } catch (err) {
          if (err instanceof MongoServerError && err.code === 11000 && /number/.test(err.message)) {
            throw new DuplicateOrderNumberError(order.number);
          }
          throw err;
        }
      },
      list: ({ status, limit }) =>
        orders.find(status ? { status } : {}, withoutMongoId).sort({ createdAt: -1 }).limit(limit).toArray(),
      get: (id) => orders.findOne({ id }, withoutMongoId),
      update: (id, changes) =>
        orders.findOneAndUpdate({ id }, { $set: changes }, { ...withoutMongoId, returnDocument: 'after' }),
      delete: async (id) => (await orders.deleteOne({ id })).deletedCount > 0,
    },
    modelFiles: gridFsStore(new GridFSBucket(db, { bucketName: 'modelFiles' })),
    mediaFiles: gridFsStore(new GridFSBucket(db, { bucketName: 'mediaFiles' })),
    async prepare() {
      await Promise.all([
        products.createIndex({ id: 1 }, { unique: true }),
        orders.createIndex({ id: 1 }, { unique: true }),
        orders.createIndex({ number: 1 }, { unique: true }),
        orders.createIndex({ createdAt: -1 }),
        orders.createIndex({ status: 1, createdAt: -1 }),
      ]);
      // Products saved before plate support.
      await products.updateMany(
        { mesh: { $type: 'object' }, 'mesh.plates': { $exists: false } },
        { $set: { 'mesh.plates': [], 'mesh.plate': null } },
      );
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
