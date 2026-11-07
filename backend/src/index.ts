import { randomBytes } from 'node:crypto';
import { createApp } from './app';
import { pruneCustomerFiles } from './customOrders';
import { createMailer, mailConfigFromEnv } from './mail/mailer';
import { openStorage, seedEmailTemplates, seedPrintSettings, seedProducts, storageConfig, type Storage } from './storage';
import { modelSearchFromEnv, parseModelSources, type ModelSearch } from './modelSearch';

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
if (await seedPrintSettings(storage)) console.log('Stored example (or upgraded) print options: nozzles, layer heights and filaments.');
if (await seedEmailTemplates(storage)) console.log('Stored the default status email templates.');

let mailer;
try {
  mailer = createMailer(mailConfigFromEnv());
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
console.log(mailer.transport === 'smtp' ? `Emails to customers are sent by SMTP from ${mailer.from}.`
  : mailer.transport === 'outbox' ? 'Emails to customers are saved as .eml files in the outbox folder (no SMTP_HOST).'
    : 'Emails to customers are not configured (set SMTP_HOST and MAIL_FROM); sending will be logged as failed.');

const allowedOrigins = (process.env.CORS_ORIGINS ??
  'http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174,http://localhost:4173,http://localhost:4174,http://127.0.0.1:4173,http://127.0.0.1:4174')
  .split(',').map((origin) => origin.trim()).filter(Boolean);
for (const origin of allowedOrigins) {
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
    throw new Error(`CORS_ORIGINS must contain exact HTTP(S) origins without paths: ${origin}`);
  }
}
/** Customer uploads that were never confirmed as a print request are removed after a day. */
const pruneUploads = () => {
  pruneCustomerFiles(storage)
    .then((count) => count > 0 && console.log(`Deleted ${count} unconfirmed customer upload(s).`))
    .catch((err: unknown) => console.error('Could not clean up customer uploads:', err));
};
pruneUploads();
setInterval(pruneUploads, 60 * 60 * 1000).unref();

let modelSearch: ModelSearch;
try {
  modelSearch = modelSearchFromEnv();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
const modelSources = parseModelSources(process.env.MODEL_SEARCH_SOURCES);
console.log(modelSources.length ? `Model search: ${modelSources.join(', ')}.` : 'Model search is disabled.');
if (modelSources.includes('thingiverse') && !process.env.THINGIVERSE_TOKEN?.trim()) {
  console.warn('THINGIVERSE_TOKEN is not set — model search skips Thingiverse.');
}
const server = createApp({ db: storage, adminToken, allowedOrigins, mailer, modelSearch }).listen(port, () => {
  console.log(`API listening on http://localhost:${port}/api`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close();
    void storage.close().then(() => process.exit(0));
  });
}
