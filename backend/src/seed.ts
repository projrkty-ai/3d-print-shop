// Loads the demo catalog. `npm run db:seed` fills an empty database;
// `npm run db:seed -- --reset` replaces all products (orders are kept).
import { connect, ensureIndexes, openDatabase, seedProducts } from './db';

const reset = process.argv.includes('--reset');
const { client, db } = await connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/printforge');
try {
  const collections = openDatabase(db);
  await ensureIndexes(collections);
  const count = await seedProducts(collections, { reset });
  console.log(count > 0 ? `Inserted ${count} demo products.` : 'Products already exist; use --reset to replace them.');
} finally {
  await client.close();
}
