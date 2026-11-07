import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { CURRENCY } from './domain/config';
import { layerFitsNozzle, layerHeightRange } from './domain/printSettings';
import type { CustomOrder, CustomOrderFile, CustomOrderInput, MeshFormat, PartFilament, PrintSettings } from './domain/types';
import { HttpError } from './http';
import { t } from './i18n';
import { deleteLogBook, logStatus } from './logBook';
import { orderNumber } from './orders';
import { decodeFileName } from './routes/modelFiles';
import { DuplicateOrderNumberError, type Storage } from './storage';

/**
 * Uploads that were never confirmed as part of a print request are deleted after this long.
 * It is also how long a customer may take between uploading and confirming.
 */
export const UNCLAIMED_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Uploads can be confirmed for an hour less than they are kept, so cleanup never deletes a file
 * while a request is claiming it: the two windows don't overlap.
 */
export const UPLOAD_CONFIRM_WINDOW_MS = UNCLAIMED_UPLOAD_TTL_MS - 60 * 60 * 1000;

const BINARY_STL_HEADER = 84;
const BINARY_STL_TRIANGLE = 50;
/** Some exporters pad binary STL files; tolerate a little trailing data. */
const BINARY_STL_SLACK = 512;

function isBinaryStl(data: Buffer): boolean {
  if (data.length < BINARY_STL_HEADER + BINARY_STL_TRIANGLE) return false;
  const triangles = data.readUInt32LE(80);
  const expected = BINARY_STL_HEADER + triangles * BINARY_STL_TRIANGLE;
  return triangles > 0 && data.length >= expected && data.length - expected <= BINARY_STL_SLACK;
}

function isAsciiStl(data: Buffer): boolean {
  const head = data.subarray(0, 512).toString('latin1').replace(/^\uFEFF/, '');
  const has = (word: string) => data.includes(word) || data.includes(word.toUpperCase());
  return /^\s*solid\b/i.test(head) && has('facet') && has('vertex') && has('endsolid');
}

/** A 3MF is a ZIP package with a content-types part and at least one 3D model part. */
function is3mf(data: Buffer): boolean {
  const isZip = data.length >= 4 && data.readUInt32LE(0) === 0x04034b50;
  return isZip && data.includes('[Content_Types].xml') && data.includes('.model');
}

/**
 * Format of a customer's model, detected from its contents. Stricter than the admin upload check,
 * since anyone can send these: a binary STL must have exactly as many bytes as its triangle count says.
 */
export function detectModelFormat(data: Buffer): MeshFormat | null {
  if (is3mf(data)) return '3mf';
  if (isBinaryStl(data) || isAsciiStl(data)) return 'stl';
  return null;
}

/** Keeps the customer's name, but its extension must agree with the contents (added when missing). */
export function customerFileName(header: string | undefined, format: MeshFormat): string {
  const name = decodeFileName(header);
  const extension = /\.(stl|3mf)$/i.exec(name)?.[1]?.toLowerCase();
  if (extension && extension !== format) throw new HttpError(400, t('modelExtension', extension));
  return extension ? name : `${name.slice(0, 250)}.${format}`;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function keyMatches(storedHash: unknown, key: string): boolean {
  if (typeof storedHash !== 'string') return false;
  const expected = Buffer.from(storedHash, 'hex');
  const actual = createHash('sha256').update(key).digest();
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export interface CustomerUpload {
  fileId: string;
  /** Secret proving the upload is the caller's; required to include the file in a request. Only its hash is stored. */
  uploadKey: string;
  fileName: string;
  format: MeshFormat;
  sizeBytes: number;
}

export async function storeCustomerFile(db: Storage, nameHeader: string | undefined, data: Buffer): Promise<CustomerUpload> {
  const format = detectModelFormat(data);
  if (!format) throw new HttpError(400, t('invalidModel'));
  const fileName = customerFileName(nameHeader, format);
  const uploadKey = randomBytes(24).toString('base64url');
  const fileId = await db.customerFiles.upload(fileName, data, {
    uploadedAt: new Date().toISOString(),
    format,
    uploadKeySha256: sha256(uploadKey),
  });
  return { fileId, uploadKey, fileName, format, sizeBytes: data.length };
}

type FileLine = CustomOrderInput['files'][number];

const mm = (value: number) => String(Math.round(value * 1000) / 1000);

/**
 * The customer's nozzle, layer height and per-part filament choices checked against the current
 * options (including that the layer height suits the nozzle), as a snapshot with sizes and prices.
 * Problems are added to `problems`, prefixed with `label`.
 */
function snapshotChoices(settings: PrintSettings, line: FileLine, label: string, problems: string[]) {
  const nozzle = settings.nozzles.find((n) => n.id === line.nozzleId);
  const layerHeight = settings.layerHeights.find((l) => l.id === line.layerHeightId);
  if (!nozzle) problems.push(`${label}: ${t('unknownNozzle')}`);
  if (!layerHeight) problems.push(`${label}: ${t('unknownLayerHeight')}`);
  if (nozzle && layerHeight && !layerFitsNozzle(layerHeight.heightMm, nozzle.diameterMm)) {
    const { min, max } = layerHeightRange(nozzle.diameterMm);
    problems.push(`${label}: ${t('layerDoesntFit', mm(layerHeight.heightMm), mm(nozzle.diameterMm), mm(min), mm(max))}`);
  }
  const parts = line.parts.flatMap((part): PartFilament[] => {
    const filament = settings.filaments.find((f) => f.id === part.filamentId);
    const color = filament?.colors.find((c) => c.id === part.colorId);
    if (!filament) problems.push(`${label}: ${t('unknownFilament', part.name)}`);
    else if (!color) problems.push(`${label}: ${t('unknownFilamentColor', part.name)}`);
    if (!filament || !color) return [];
    const { id, name, pricePerKg, densityGPerCm3 } = filament;
    return [{ key: part.key, name: part.name, filament: { id, name, pricePerKg, densityGPerCm3 }, color: { ...color } }];
  });
  return nozzle && layerHeight ? { nozzle: { ...nozzle }, layerHeight: { ...layerHeight }, parts } : null;
}

const roundCents = (value: number) => Math.round(value * 100) / 100;
export const roundQuote = (value: number | null) => (value === null ? null : roundCents(value));

/**
 * Records a confirmed print request. Every file must be an unclaimed upload whose key matches;
 * problems are reported per file with status 409, telling the client to upload those files again.
 */
export async function createCustomOrder(db: Storage, input: CustomOrderInput, now = new Date()): Promise<CustomOrder> {
  // Print options first (400): the customer must choose again, whereas file problems (409) mean uploading again.
  const settings = await db.printSettings.get();
  if (!settings) throw new HttpError(503, t('printSettingsMissing'));
  const optionProblems: string[] = [];
  const choices = input.files.map((line, index) => snapshotChoices(settings, line, t('file', index + 1), optionProblems));
  if (optionProblems.length > 0) throw new HttpError(400, t('printOptionsProblems'), optionProblems);

  const problems: string[] = [];
  const files: CustomOrderFile[] = [];
  for (const [index, line] of input.files.entries()) {
    const stored = await db.customerFiles.find(line.fileId);
    const label = `${t('file', index + 1)}${stored ? ` (${stored.fileName})` : ''}`;
    const uploadedAt = Date.parse(String(stored?.metadata.uploadedAt));
    const expired = !(now.getTime() - uploadedAt <= UPLOAD_CONFIRM_WINDOW_MS);
    // A wrong key is reported like a missing file, so ids of other customers' uploads can't be probed.
    if (!stored || !keyMatches(stored.metadata.uploadKeySha256, line.uploadKey) || expired) {
      problems.push(`${t('file', index + 1)}: ${t('uploadMissing')}`);
    } else if (stored.metadata.orderId !== undefined) {
      problems.push(`${label}: ${t('uploadClaimed')}`);
    } else {
      const format = stored.metadata.format === '3mf' ? '3mf' : 'stl';
      files.push({
        fileId: stored.id, fileName: stored.fileName, format, sizeBytes: stored.length, quantity: line.quantity, ...choices[index]!,
      });
    }
  }
  if (problems.length > 0) throw new HttpError(409, t('customOrderProblems'), problems);

  const order: CustomOrder = {
    id: randomUUID(),
    number: '',
    status: 'submitted',
    customer: input.customer,
    files,
    ...(input.customerNote && { customerNote: input.customerNote }),
    quotedPrice: null,
    currency: CURRENCY,
    adminNote: '',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  // Request numbers are random; on the rare collision, draw another.
  for (let attempt = 0; ; attempt++) {
    order.number = orderNumber(now, 'CP');
    try {
      await db.customOrders.insert(order);
      break;
    } catch (err) {
      if (!(err instanceof DuplicateOrderNumberError) || attempt >= 5) throw err;
    }
  }

  // Claiming is atomic per file, so a double submission can't attach one upload to two requests.
  for (const file of files) {
    if (!(await db.customerFiles.claim(file.fileId, order.id))) {
      await db.customOrders.delete(order.id);
      throw new HttpError(409, t('customOrderProblems'), [`${file.fileName}: ${t('uploadClaimed')}`]);
    }
  }
  await logStatus(db, 'customOrder', order.id, null, order.status);
  return order;
}

/** Deletes the request together with its uploaded files and its log book. */
export async function deleteCustomOrder(db: Storage, id: string): Promise<boolean> {
  const deleted = await db.customOrders.delete(id);
  if (!deleted) return false;
  for (const file of deleted.files) await db.customerFiles.delete(file.fileId);
  await deleteLogBook(db, 'customOrder', id);
  return true;
}

/**
 * Deletes uploads that never became part of a request (the customer left before confirming,
 * or confirming failed), once they are older than `ttlMs`. Returns how many were deleted.
 */
export async function pruneCustomerFiles(db: Storage, { now = Date.now(), ttlMs = UNCLAIMED_UPLOAD_TTL_MS } = {}): Promise<number> {
  let deleted = 0;
  for (const file of await db.customerFiles.list()) {
    const uploadedAt = Date.parse(String(file.metadata.uploadedAt));
    if (Number.isFinite(uploadedAt) && now - uploadedAt < ttlMs) continue;
    const orderId = file.metadata.orderId;
    if (typeof orderId === 'string' && (await db.customOrders.get(orderId))) continue;
    await db.customerFiles.delete(file.id);
    deleted++;
  }
  return deleted;
}
