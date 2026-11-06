import { randomBytes } from 'node:crypto';
import { createApp } from './app';
import { openStorage, seedProducts, storageConfig, type Storage } from './storage';

const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3001);

let adminToken = process.env.ADMIN_TOKEN ?? '';
if (!adminToken) {
  if (production) {
    console.error('ADMIN_TOKEN must be set in production.');
    process.exit(1);
  }
  adminToken = randomBytes(18).toString('base64url');
  console.warn(`ADMIN_TOKEN is not set — using a temporary admin token for this run:\n  ${adminToken}`);
}

let storage: Storage;
try {
  storage = await openStorage(storageConfig());
  await storage.prepare();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  if (err instanceof Error && err.cause) console.error(err.cause);
  process.exit(1);
}
console.log(`Using ${storage.description}.`);
const seeded = await seedProducts(storage);
if (seeded > 0) console.log(`Seeded ${seeded} demo products.`);

const allowedOrigins = (process.env.CORS_ORIGINS ??
  'http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174,http://localhost:4173,http://localhost:4174,http://127.0.0.1:4173,http://127.0.0.1:4174')
  .split(',').map((origin) => origin.trim()).filter(Boolean);
for (const origin of allowedOrigins) {
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
    throw new Error(`CORS_ORIGINS must contain exact HTTP(S) origins without paths: ${origin}`);
  }
}
const server = createApp({ db: storage, adminToken, allowedOrigins }).listen(port, () => {
  console.log(`API listening on http://localhost:${port}/api`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close();
    void storage.close().then(() => process.exit(0));
  });
}
