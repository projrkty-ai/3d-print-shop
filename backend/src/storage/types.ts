import type { Readable } from 'node:stream';
import type { EmailTemplates, LogEntry, Order, OrderSource, OrderStatus, PricingSettings, Printer, PrinterModel, PrintSettings, Product, ProjectProduct } from '../domain/types';

/**
 * Persistence used by the API. MongoDB is the production store; SQLite lets the whole shop run
 * locally without a database server. Both implement exactly this contract (see storage.test.ts).
 */
export interface Storage {
  readonly kind: 'mongodb' | 'sqlite';
  /** Human-readable location for startup logs, without credentials. */
  readonly description: string;
  products: ProductStore;
  /** Every order, whatever its models' source (catalog, uploads, external projects, Print on Demand). */
  orders: OrderStore;
  /** Reviewed projects offered at a fixed price. */
  projectProducts: ProjectProductStore;
  /** Shop-wide settings documents, e.g. pricing rates. */
  settings: SettingsStore;
  /** Uploaded STL/3MF files. */
  modelFiles: FileStore;
  /** Uploaded description images and shop textures. */
  mediaFiles: FileStore;
  /** Model files customers uploaded for their orders. Private: never served publicly. */
  customerFiles: CustomerFileStore;
  /** Slicing profiles and filaments offered for customers' own models: one document, edited by the admin. */
  printSettings: PrintSettingsStore;
  /** Status changes and emails of every order. */
  logBook: LogBookStore;
  /** Original .eml files imported into log books. Private: downloaded by admins only. */
  mailFiles: FileStore;
  /** The email sent for each status: one document, edited by the admin. */
  emailTemplates: { get(): Promise<EmailTemplates | null>; put(templates: EmailTemplates): Promise<void> };
  /** The printers in the workshop (the printers warehouse). Each refers to a printer model. */
  printers: NamedStore<Printer>;
  /** Printer models: the plate size, colors and slicer profiles shared by all printers of a model. */
  printerModels: NamedStore<PrinterModel>;
  /** Slicer profile archives uploaded for printer models. Private: downloaded by admins only. */
  printerFiles: FileStore;
  /** Creates tables/indexes and upgrades documents saved by older versions. Safe to repeat. */
  prepare(): Promise<void>;
  close(): Promise<void>;
}

export interface ProductStore {
  /** Oldest first (the catalog order). */
  list(filter?: { publishedOnly?: boolean }): Promise<Product[]>;
  get(id: string): Promise<Product | null>;
  getMany(ids: string[]): Promise<Product[]>;
  ids(): Promise<string[]>;
  count(): Promise<number>;
  insert(product: Product): Promise<void>;
  insertMany(products: Product[]): Promise<void>;
  /** Returns false when no product has this id. */
  replace(product: Product): Promise<boolean>;
  /** Returns the deleted product, or null when it didn't exist. */
  delete(id: string): Promise<Product | null>;
  deleteAll(): Promise<void>;
  /** Model file URLs (`mesh.url`) referenced by any product. */
  meshUrls(): Promise<string[]>;
  isMeshUrlUsed(url: string): Promise<boolean>;
}

/** Thrown by `OrderStore.insert` when the order number is taken, so checkout can draw another. */
export class DuplicateOrderNumberError extends Error {
  constructor(readonly orderNumber: string) {
    super(`Order number ${orderNumber} already exists.`);
  }
}

/** Whole order documents, listed newest first. */
export interface OrderStore {
  /** Throws `DuplicateOrderNumberError` when the number is taken. */
  insert(order: Order): Promise<void>;
  /** Newest first. */
  list(filter: { status?: OrderStatus; source?: OrderSource; limit: number }): Promise<Order[]>;
  get(id: string): Promise<Order | null>;
  /** Returns the updated order, or null when it didn't exist. Number, source and creation time never change. */
  update(id: string, changes: Partial<Omit<Order, 'id' | 'number' | 'source' | 'createdAt'>>): Promise<Order | null>;
  /** Returns false when the order didn't exist. */
  delete(id: string): Promise<boolean>;
}

/** Thrown by `NamedStore.insert` and `replace` when another document already has the name (ignoring case). */
export class DuplicateNameError extends Error {
  constructor(readonly name: string) {
    super(`The name ${name} is already taken.`);
  }
}

/** Documents with a unique name (ignoring case and surrounding whitespace), e.g. printers and printer models. */
export interface NamedStore<T extends { id: string; name: string }> {
  /** Sorted by name. */
  list(): Promise<T[]>;
  get(id: string): Promise<T | null>;
  /** Throws `DuplicateNameError` when the name is taken. */
  insert(document: T): Promise<void>;
  /** Returns false when no document has this id. Throws `DuplicateNameError` when the new name is taken. */
  replace(document: T): Promise<boolean>;
  /** Returns the deleted document, or null when it didn't exist. */
  delete(id: string): Promise<T | null>;
}

export interface PrintSettingsStore {
  /** Null until seeded or saved. */
  get(): Promise<PrintSettings | null>;
  /** Stores the whole document, replacing any previous one. */
  put(settings: PrintSettings): Promise<void>;
}

export interface LogBookStore {
  insert(entry: LogEntry): Promise<void>;
  /** Newest first; entries with the same time in reverse insertion order. */
  list(orderId: string): Promise<LogEntry[]>;
  get(orderId: string, id: string): Promise<LogEntry | null>;
  /** Whether the order's log already holds an email with this Message-ID (sent or imported). */
  hasMessageId(orderId: string, messageId: string): Promise<boolean>;
  /** Deletes the order's log and returns the deleted entries (to release their files). */
  deleteForOrder(orderId: string): Promise<LogEntry[]>;
}

export interface ProjectProductStore {
  /** Newest first. */
  list(filter?: { publishedOnly?: boolean }): Promise<ProjectProduct[]>;
  get(id: string): Promise<ProjectProduct | null>;
  insert(product: ProjectProduct): Promise<void>;
  /** Returns false when no product has this id. */
  replace(product: ProjectProduct): Promise<boolean>;
  /** Returns false when the product didn't exist. */
  delete(id: string): Promise<boolean>;
}

/** One JSON document per settings key. */
export interface SettingsStore {
  getPricing(): Promise<PricingSettings | null>;
  putPricing(settings: PricingSettings): Promise<void>;
}

/** Ids are 24 lowercase hex characters (MongoDB ObjectId format), so stored URLs work with either store. */
export const FILE_ID = /^[0-9a-f]{24}$/;

export interface StoredFile {
  id: string;
  fileName: string;
  length: number;
  metadata: Record<string, unknown>;
}

export interface FileStore {
  /** Stores the file and returns its new id. */
  upload(fileName: string, data: Buffer, metadata: Record<string, unknown>): Promise<string>;
  /** Null for unknown or malformed ids. */
  find(id: string): Promise<StoredFile | null>;
  /** Contents of a file that `find` returned. */
  openDownloadStream(id: string): Readable;
  /** Does nothing when the file is already gone. */
  delete(id: string): Promise<void>;
  ids(): Promise<string[]>;
}

/**
 * Customer uploads are stored before the order is placed. Placing it claims them for the order
 * (recorded as `metadata.orderId`), so each file belongs to at most one order and files that were
 * never claimed can be cleaned up.
 */
export interface CustomerFileStore extends FileStore {
  /** Atomically records the owning request; false when the file is missing or already claimed. */
  claim(id: string, orderId: string): Promise<boolean>;
  /** Every stored file with its metadata, oldest first. */
  list(): Promise<StoredFile[]>;
}
