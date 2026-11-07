import { resolve } from 'node:path';
import { createSeedProducts } from '../domain/data/seedProducts';
import { createSeedEmailTemplates, TEMPLATE_KEYS } from '../domain/emailTemplates';
import { createSeedPrintSettings, upgradePrintSettings } from '../domain/printSettings';
import { FILE_ID, type Storage } from './types';

export * from './types';

export type StorageConfig =
  | { kind: 'sqlite'; path: string }
  | { kind: 'mongodb'; uri: string };

export const DEFAULT_SQLITE_PATH = 'data/printforge.sqlite';
export const DEFAULT_MONGODB_URI = 'mongodb://localhost:27017/printforge';

/**
 * `DATABASE` selects the store explicitly. Without it, production (`npm start`) keeps using
 * MongoDB, so existing deployments never silently switch to an empty local file, while
 * development uses SQLite and needs no database server.
 */
export function storageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const kind = env.DATABASE ?? (env.NODE_ENV === 'production' ? 'mongodb' : 'sqlite');
  if (kind === 'sqlite') return { kind, path: resolve(env.SQLITE_PATH || DEFAULT_SQLITE_PATH) };
  if (kind === 'mongodb') return { kind, uri: env.MONGODB_URI || DEFAULT_MONGODB_URI };
  throw new Error(`DATABASE must be "sqlite" or "mongodb", not "${kind}".`);
}

/** Connects to the configured store; call `prepare()` before use. Drivers load only when selected. */
export async function openStorage(config: StorageConfig): Promise<Storage> {
  if (config.kind === 'mongodb') {
    const { connectMongo } = await import('./mongo');
    try {
      return await connectMongo(config.uri);
    } catch (err) {
      throw new Error(
        `Could not connect to MongoDB. Is it running (docker compose up -d)? For local development without it, set DATABASE=sqlite.`,
        { cause: err },
      );
    }
  }
  let sqlite: typeof import('./sqlite');
  try {
    sqlite = await import('./sqlite');
  } catch (err) {
    throw new Error(
      `SQLite storage needs Node.js 22.13 or newer (built-in node:sqlite); this is ${process.version}. Upgrade Node.js or set DATABASE=mongodb.`,
      { cause: err },
    );
  }
  return sqlite.sqliteStorage(config.path);
}

/** Loads the demo catalog into an empty store (or replaces all products when `reset`). Orders are kept. */
export async function seedProducts(storage: Storage, { reset = false } = {}): Promise<number> {
  if (!reset && (await storage.products.count()) > 0) return 0;
  if (reset) await storage.products.deleteAll();
  const seed = createSeedProducts();
  await storage.products.insertMany(seed);
  if (reset) await pruneModelFiles(storage);
  return seed.length;
}

/**
 * Stores the example nozzles, layer heights and filaments when none exist yet (or replaces them
 * when `reset`), and converts options saved in the first format (qualities, prices per gram).
 * Returns whether it wrote anything.
 */
export async function seedPrintSettings(storage: Storage, { reset = false } = {}): Promise<boolean> {
  const stored = reset ? null : await storage.printSettings.get();
  const current = upgradePrintSettings(stored);
  if (current && current === stored) return false;
  await storage.printSettings.put(current ?? createSeedPrintSettings());
  return true;
}

/**
 * Stores the default email templates (in APP_LANGUAGE) when none exist, or when `reset`. Templates
 * added by a newer version (e.g. a new status) are filled in from the defaults; edited ones are kept.
 */
export async function seedEmailTemplates(storage: Storage, { reset = false } = {}): Promise<boolean> {
  const stored = reset ? null : await storage.emailTemplates.get();
  const seed = createSeedEmailTemplates();
  if (stored && TEMPLATE_KEYS.every((key) => stored.templates[key])) return false;
  await storage.emailTemplates.put(stored ? { ...stored, templates: { ...seed.templates, ...stored.templates } } : seed);
  return true;
}

/** Uploaded model files are served from here; product meshes point at these URLs. */
export const MODEL_FILE_URL_PREFIX = '/api/model-files/';

export function modelFileId(url: string | undefined): string | null {
  if (!url?.startsWith(MODEL_FILE_URL_PREFIX)) return null;
  const id = url.slice(MODEL_FILE_URL_PREFIX.length);
  return FILE_ID.test(id) ? id : null;
}

/** Deletes uploaded model files that no product refers to. */
export async function pruneModelFiles({ products, modelFiles }: Storage) {
  const referenced = new Set((await products.meshUrls()).map(modelFileId).filter(Boolean));
  for (const id of await modelFiles.ids()) {
    if (!referenced.has(id)) await modelFiles.delete(id);
  }
}

/** Deletes an uploaded model file once no product uses it (duplicated products share one file). */
export async function releaseModelFile({ products, modelFiles }: Storage, url: string | undefined) {
  const id = modelFileId(url);
  if (!id || (await products.isMeshUrlUsed(url!))) return;
  await modelFiles.delete(id);
}
