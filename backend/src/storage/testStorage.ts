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

/** Removes every order (tests only; the API has no bulk delete). */
export async function deleteAllOrders(storage: Storage) {
  for (const order of await storage.orders.list({ limit: 10_000 })) await storage.orders.delete(order.id);
}
