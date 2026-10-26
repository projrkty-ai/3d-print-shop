import { GridFSBucket, MongoClient, ObjectId, type Db } from 'mongodb';
import { createSeedProducts } from './domain/data/seedProducts';
import type { Order, Product } from './domain/types';

const productsOf = (db: Db) => db.collection<Product>('products');
const ordersOf = (db: Db) => db.collection<Order>('orders');

/** Documents carry their own string `id`; Mongo's `_id` never leaves the server. */
export const withoutMongoId = { projection: { _id: 0 } } as const;

export function openDatabase(db: Db) {
  return {
    products: productsOf(db),
    orders: ordersOf(db),
    modelFiles: new GridFSBucket(db, { bucketName: 'modelFiles' }),
    mediaFiles: new GridFSBucket(db, { bucketName: 'mediaFiles' }),
  };
}

export type Collections = ReturnType<typeof openDatabase>;

export async function ensureIndexes({ products, orders }: Collections) {
  await Promise.all([
    products.createIndex({ id: 1 }, { unique: true }),
    orders.createIndex({ id: 1 }, { unique: true }),
    orders.createIndex({ number: 1 }, { unique: true }),
    orders.createIndex({ createdAt: -1 }),
    orders.createIndex({ status: 1, createdAt: -1 }),
  ]);
}

/** Brings documents saved by older versions up to the current shape. */
export async function migrateDocuments({ products }: Collections) {
  await products.updateMany(
    { mesh: { $type: 'object' }, 'mesh.plates': { $exists: false } },
    { $set: { 'mesh.plates': [], 'mesh.plate': null } },
  );
}

/** Loads the demo catalog into an empty database (or replaces all products when `reset`). */
export async function seedProducts(collections: Collections, { reset = false } = {}): Promise<number> {
  const { products } = collections;
  if (!reset && (await products.estimatedDocumentCount()) > 0) return 0;
  if (reset) await products.deleteMany({});
  const seed = createSeedProducts();
  await products.insertMany(seed);
  if (reset) await pruneModelFiles(collections);
  return seed.length;
}

/** Deletes uploaded model files that no product refers to. */
export async function pruneModelFiles({ products, modelFiles }: Collections) {
  const referenced = new Set(
    (await products.distinct('mesh.url')).map((url) => modelFileId(url)?.toHexString()).filter(Boolean),
  );
  for (const file of await modelFiles.find({}, { projection: { _id: 1 } }).toArray()) {
    if (!referenced.has(file._id.toHexString())) await modelFiles.delete(file._id);
  }
}

/** Uploaded model files are served from here; product meshes point at these URLs. */
export const MODEL_FILE_URL_PREFIX = '/api/model-files/';

export function modelFileId(url: string | undefined): ObjectId | null {
  if (!url?.startsWith(MODEL_FILE_URL_PREFIX)) return null;
  const id = url.slice(MODEL_FILE_URL_PREFIX.length);
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

/** Deletes an uploaded model file once no product uses it (duplicated products share one file). */
export async function releaseModelFile({ products, modelFiles }: Collections, url: string | undefined) {
  const fileId = modelFileId(url);
  if (!fileId || (await products.countDocuments({ 'mesh.url': url }, { limit: 1 })) > 0) return;
  await modelFiles.delete(fileId).catch((err: unknown) => {
    // Already gone (e.g. deleted concurrently) is fine.
    if (!(err instanceof Error && /not found/i.test(err.message))) throw err;
  });
}

export async function connect(uri: string) {
  const client = new MongoClient(uri);
  await client.connect();
  return { client, db: client.db() };
}
