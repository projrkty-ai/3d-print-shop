import type { Readable } from 'node:stream';
import type { Order, OrderStatus, Product } from '../domain/types';

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
  /** Uploaded STL/3MF files. */
  modelFiles: FileStore;
  /** Uploaded description images and shop textures. */
  mediaFiles: FileStore;
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

export interface OrderStore {
  insert(order: Order): Promise<void>;
  /** Newest first. */
  list(filter: { status?: OrderStatus; limit: number }): Promise<Order[]>;
  get(id: string): Promise<Order | null>;
  /** Returns the updated order, or null when it didn't exist. */
  update(id: string, changes: Partial<Pick<Order, 'status' | 'adminNote' | 'updatedAt'>>): Promise<Order | null>;
  /** Returns false when the order didn't exist. */
  delete(id: string): Promise<boolean>;
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
