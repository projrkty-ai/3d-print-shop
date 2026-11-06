// Loads the demo catalog into the configured store (DATABASE, SQLITE_PATH / MONGODB_URI).
// `npm run db:seed` fills an empty catalog; `npm run db:seed -- --reset` replaces all products (orders are kept).
import { openStorage, seedProducts, storageConfig } from './storage';

const reset = process.argv.includes('--reset');
const storage = await openStorage(storageConfig());
try {
  await storage.prepare();
  const count = await seedProducts(storage, { reset });
  console.log(count > 0
    ? `Inserted ${count} demo products into ${storage.description}.`
    : `Products already exist in ${storage.description}; use --reset to replace them.`);
} finally {
  await storage.close();
}
