// Loads the demo catalog into the configured store (DATABASE, SQLITE_PATH / MONGODB_URI).
// `npm run db:seed` fills an empty catalog and missing print options; `npm run db:seed -- --reset`
// replaces all products and the print options with the examples (orders are kept).
import { openStorage, seedEmailTemplates, seedPrintSettings, seedProducts, storageConfig } from './storage';

const reset = process.argv.includes('--reset');
const storage = await openStorage(storageConfig());
try {
  await storage.prepare();
  const count = await seedProducts(storage, { reset });
  console.log(count > 0
    ? `Inserted ${count} demo products into ${storage.description}.`
    : `Products already exist in ${storage.description}; use --reset to replace them.`);
  console.log(await seedPrintSettings(storage, { reset })
    ? 'Stored the example (or upgraded) nozzles, layer heights and filaments.'
    : 'Print options already exist; use --reset to replace them with the examples.');
  console.log(await seedEmailTemplates(storage, { reset })
    ? 'Stored the default status email templates.'
    : 'Email templates already exist; use --reset to restore the defaults.');
} finally {
  await storage.close();
}
