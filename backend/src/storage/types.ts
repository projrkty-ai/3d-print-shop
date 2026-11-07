import type { Readable } from 'node:stream';
import type { CustomOrder, CustomOrderStatus, EmailTemplates, LogEntry, Order, OrderKind, OrderStatus, PricingSettings, PrintSettings, Product, ProjectOrder, ProjectOrderStatus, ProjectProduct } from '../domain/types';

/**
 * Persistence used by the API. MongoDB is the production store; SQLite lets the whole shop run
 * locally without a database server. Both implement exactly this contract (see storage.test.ts).
 */
export interface Storage {
  readonly kind: 'mongodb' | 'sqlite';
  /** Human-readable location for startup logs, without credentials. */
  readonly description: string;
  products: ProductStore;
  orders: OrderStore;
  /** Customer requests to print projects from external model sites. */
  projectOrders: ProjectOrderStore;
  /** Reviewed projects offered at a fixed price. */
  projectProducts: ProjectProductStore;
  /** Shop-wide settings documents, e.g. pricing rates. */
  settings: SettingsStore;
  /** Uploaded STL/3MF files. */
  modelFiles: FileStore;
  /** Uploaded description images and shop textures. */
  mediaFiles: FileStore;
  /** Print requests for customers' own model files. */
  customOrders: CustomOrderStore;
  /** Model files customers uploaded for print requests. Private: never served publicly. */
  customerFiles: CustomerFileStore;
  /** Nozzles, layer heights and filaments offered for print requests: one document, edited by the admin. */
  printSettings: PrintSettingsStore;
  /** Status changes and emails of every order and print request. */
  logBook: LogBookStore;
  /** Original .eml files imported into log books. Private: downloaded by admins only. */
  mailFiles: FileStore;
  /** The email sent for each status: one document, edited by the admin. */
  emailTemplates: { get(): Promise<EmailTemplates | null>; put(templates: EmailTemplates): Promise<void> };
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

/** Orders and project orders are stored alike: whole documents, listed newest first. */
export interface DocumentStore<T extends { id: string; number: string; status: string; createdAt: string; updatedAt: string; adminNote: string }> {
  insert(document: T): Promise<void>;
  /** Newest first. */
  list(filter: { status?: T['status']; limit: number }): Promise<T[]>;
  get(id: string): Promise<T | null>;
  /** Returns the updated document, or null when it didn't exist. Number and creation time never change. */
  update(id: string, changes: Partial<Omit<T, 'id' | 'number' | 'createdAt'>>): Promise<T | null>;
  /** Returns false when the document didn't exist. */
  delete(id: string): Promise<boolean>;
}

/** Same contract as `OrderStore`; numbers share the uniqueness rule within print requests. */
export interface CustomOrderStore {
  /** Throws `DuplicateOrderNumberError` when the number is taken. */
  insert(order: CustomOrder): Promise<void>;
  /** Newest first. */
  list(filter: { status?: CustomOrderStatus; limit: number }): Promise<CustomOrder[]>;
  get(id: string): Promise<CustomOrder | null>;
  /** Returns the updated request, or null when it didn't exist. */
  update(
    id: string,
    changes: Partial<Pick<CustomOrder, 'status' | 'adminNote' | 'quotedPrice' | 'updatedAt'>>,
  ): Promise<CustomOrder | null>;
  /** Returns the deleted request, or null when it didn't exist. */
  delete(id: string): Promise<CustomOrder | null>;
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
  list(orderKind: OrderKind, orderId: string): Promise<LogEntry[]>;
  get(orderKind: OrderKind, orderId: string, id: string): Promise<LogEntry | null>;
  /** Whether the order's log already holds an email with this Message-ID (sent or imported). */
  hasMessageId(orderKind: OrderKind, orderId: string, messageId: string): Promise<boolean>;
  /** Deletes the order's log and returns the deleted entries (to release their files). */
  deleteForOrder(orderKind: OrderKind, orderId: string): Promise<LogEntry[]>;
}
export type OrderStore = DocumentStore<Order>;

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
export type ProjectOrderStore = DocumentStore<ProjectOrder>;
/** Kept so `OrderStore`'s status filter stays typed where it is used. */
export type { OrderStatus, ProjectOrderStatus };

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
 * Customer uploads are stored before the request is confirmed. Confirming claims them for the
 * request (recorded as `metadata.orderId`), so each file belongs to at most one request and
 * files that were never claimed can be cleaned up.
 */
export interface CustomerFileStore extends FileStore {
  /** Atomically records the owning request; false when the file is missing or already claimed. */
  claim(id: string, orderId: string): Promise<boolean>;
  /** Every stored file with its metadata, oldest first. */
  list(): Promise<StoredFile[]>;
}
