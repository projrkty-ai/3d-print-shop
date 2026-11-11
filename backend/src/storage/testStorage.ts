import type { Storage } from './types';

/**
 * Opens an empty, prepared store for tests. The vitest projects run each storage-backed test file
 * against `TEST_DATABASE=sqlite` (in memory, offline) and `TEST_DATABASE=mongodb` (MongoMemoryServer).
 */
export async function openTestStorage(name: string): Promise<{ storage: Storage; stop: () => Promise<void> }> {
  if ((process.env.TEST_DATABASE ?? 'sqlite') === 'sqlite') {
    const { sqliteStorage } = await import('./sqlite');
    const storage = sqliteStorage(':memory:');
    await storage.prepare();
    return { storage, stop: () => storage.close() };
  }
  const [{ MongoMemoryServer }, { MongoClient }, { mongoStorage }] = await Promise.all([
    import('mongodb-memory-server'), import('mongodb'), import('./mongo'),
  ]);
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  const storage = mongoStorage(client.db(name), client);
  await storage.prepare();
  return {
    storage,
    stop: async () => {
      await storage.close();
      await mongo.stop();
    },
  };
}

/** Removes every order with its log book, uploads and mail files (tests only; the API has no bulk delete). */
export async function deleteAllOrders(storage: Storage) {
  for (const order of await storage.orders.list({ limit: 10_000 })) {
    await storage.orders.delete(order.id);
    await storage.logBook.deleteForOrder(order.id);
  }
  for (const id of await storage.customerFiles.ids()) await storage.customerFiles.delete(id);
  for (const id of await storage.mailFiles.ids()) await storage.mailFiles.delete(id);
  for (const product of await storage.projectProducts.list()) await storage.projectProducts.delete(product.id);
}

/** Removes every printer and printer model with the models' profile archives (tests only). */
export async function deleteAllPrinters(storage: Storage) {
  for (const printer of await storage.printers.list()) await storage.printers.delete(printer.id);
  for (const model of await storage.printerModels.list()) await storage.printerModels.delete(model.id);
  for (const id of await storage.printerFiles.ids()) await storage.printerFiles.delete(id);
}
