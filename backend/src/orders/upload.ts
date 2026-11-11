import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { CURRENCY } from '../domain/config';
import { layerFitsNozzle, layerHeightRange } from '../domain/printSettings';
import type {
  MeshFormat, OrderItem, PartFilament, PricingSettings, PrintSettings, UploadEstimate, UploadEstimateInput, UploadItemInput, UploadModel,
} from '../domain/types';
import { filamentSlots, priceMeasurements, roundCents, withItemTotals, type FilamentSlot } from '../domain/orderPricing';
import { DEFAULT_PRICING } from '../domain/utils/projectPricing';
import { HttpError } from '../http';
import { t } from '../i18n';
import { decodeFileName } from '../routes/modelFiles';
import type { Storage } from '../storage';
import type { SourceDraft } from './types';

/**
 * Uploads that were never confirmed as part of an order are deleted after this long.
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
  /** Secret proving the upload is the caller's; required to include the file in an order. Only its hash is stored. */
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

type FileLine = UploadItemInput;

const mm = (value: number) => String(Math.round(value * 1000) / 1000);

/** Scales a customer may slice their model at (the storefront also keeps it within the build volume). */
export const CUSTOM_SCALE = { min: 0.01, max: 10 } as const;

/** The customer's slicer profile checked against the presets the shop offers. */
function checkProfile(settings: PrintSettings, profile: NonNullable<FileLine['profile']>, label: string, problems: string[]) {
  const offered = settings.profiles;
  const presets: [string, string[] | undefined][] = [
    [profile.printer, offered?.printers], [profile.process, offered?.processes], [profile.filament, offered?.filaments],
  ];
  for (const [preset, list] of presets) if (list && !list.includes(preset)) problems.push(`${label}: ${t('unknownProfile', preset)}`);
  if (!(profile.scale >= CUSTOM_SCALE.min && profile.scale <= CUSTOM_SCALE.max)) problems.push(`${label}: ${t('profileScale')}`);
}

/**
 * The customer's slicer profile (or, from older storefronts, nozzle and layer height) and per-part
 * filament choices checked against the current options, as a snapshot with names and prices.
 * Problems are added to `problems`, prefixed with `label`.
 */
function snapshotChoices(settings: PrintSettings, line: FileLine, label: string, problems: string[]) {
  const nozzle = line.nozzleId === undefined ? undefined : settings.nozzles.find((n) => n.id === line.nozzleId);
  const layerHeight = line.layerHeightId === undefined ? undefined : settings.layerHeights.find((l) => l.id === line.layerHeightId);
  if (line.profile) checkProfile(settings, line.profile, label, problems);
  else if (line.nozzleId === undefined || line.layerHeightId === undefined) problems.push(`${label}: ${t('profileOrNozzle')}`);
  if (line.nozzleId !== undefined && !nozzle) problems.push(`${label}: ${t('unknownNozzle')}`);
  if (line.layerHeightId !== undefined && !layerHeight) problems.push(`${label}: ${t('unknownLayerHeight')}`);
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
  return {
    ...(nozzle && layerHeight && { nozzle: { ...nozzle }, layerHeight: { ...layerHeight } }),
    ...(line.profile && { profile: { ...line.profile } }),
    parts,
  };
}

/** The shop's hourly rate and handling fee (defaults until the admin saves them). */
export const pricingSettings = async (db: Storage) => (await db.settings.getPricing()) ?? DEFAULT_PRICING;

/** Estimates are the customer's own numbers: unknown parts are priced like the first one rather than refused. */
const priceEstimate = (estimate: UploadItemInput['estimate'] & object, slots: FilamentSlot[], pricing: PricingSettings) =>
  priceMeasurements(estimate, slots, pricing.hourlyRate, { lenient: true }) as Exclude<ReturnType<typeof priceMeasurements>, string>;

/** Prices the browser's slicing results before the order is sent, with the current filaments and rates. */
export async function estimateUploads(db: Storage, input: UploadEstimateInput): Promise<UploadEstimate> {
  const settings = await db.printSettings.get();
  if (!settings) throw new HttpError(503, t('printSettingsMissing'));
  const pricing = await pricingSettings(db);
  const problems: string[] = [];
  const items = input.items.map((line, index) => {
    const parts = line.parts.flatMap((part): PartFilament[] => {
      const filament = settings.filaments.find((f) => f.id === part.filamentId);
      if (!filament) problems.push(`${t('file', index + 1)}: ${t('unknownFilament', part.key)}`);
      return filament ? [{ key: part.key, name: part.key, filament, color: filament.colors[0] }] : [];
    });
    const model: UploadModel = { source: 'upload', fileId: '', fileName: '', format: 'stl', sizeBytes: 0, parts };
    return { unitPrice: parts.length > 0 ? priceEstimate(line.estimate, filamentSlots(model, pricing), pricing).unitPrice : 0, quantity: line.quantity };
  });
  if (problems.length > 0) throw new HttpError(400, t('printOptionsProblems'), problems);
  return {
    items: items.map(({ unitPrice }) => ({ unitPrice })),
    handlingFee: pricing.handlingFee,
    total: roundCents(pricing.handlingFee + items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)),
    currency: CURRENCY,
  };
}

/**
 * The customer's uploaded models as order items: every file must be an unclaimed upload whose key
 * matches; problems are reported per file with status 409, telling the client to upload those files
 * again. The order needs a quote; the customer's own slicing gives the estimate. Once stored, the
 * order claims its files atomically, so a file can't belong to two orders.
 */
export async function uploadDraft(db: Storage, lines: UploadItemInput[], now = new Date()): Promise<SourceDraft> {
  // Print options first (400): the customer must choose again, whereas file problems (409) mean uploading again.
  const settings = await db.printSettings.get();
  if (!settings) throw new HttpError(503, t('printSettingsMissing'));
  const optionProblems: string[] = [];
  const choices = lines.map((line, index) => snapshotChoices(settings, line, t('file', index + 1), optionProblems));
  if (optionProblems.length > 0) throw new HttpError(400, t('printOptionsProblems'), optionProblems);

  const pricing = await pricingSettings(db);
  const problems: string[] = [];
  const items: OrderItem<UploadModel>[] = [];
  for (const [index, line] of lines.entries()) {
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
      const model: UploadModel = {
        source: 'upload', fileId: stored.id, fileName: stored.fileName, format: stored.metadata.format === '3mf' ? '3mf' : 'stl',
        sizeBytes: stored.length, ...choices[index],
      };
      const estimate = line.estimate && { ...line.estimate, unitPrice: priceEstimate(line.estimate, filamentSlots(model, pricing), pricing).unitPrice };
      items.push({ model, quantity: line.quantity, unitPrice: null, lineTotal: null, ...(estimate && { estimate }) });
    }
  }
  if (problems.length > 0) throw new HttpError(409, t('uploadProblems'), problems);

  const draft: SourceDraft = {
    source: 'upload',
    items,
    price: { mode: 'quote', handlingFee: pricing.handlingFee, estimated: null, reviewed: null, total: null },
    async afterInsert(order) {
      // Claiming is atomic per file, so a double submission can't attach one upload to two orders.
      for (const item of items) {
        if (!(await db.customerFiles.claim(item.model.fileId, order.id))) {
          throw new HttpError(409, t('uploadProblems'), [`${item.model.fileName}: ${t('uploadClaimed')}`]);
        }
      }
    },
  };
  draft.price = withItemTotals(draft);
  return draft;
}

/** The private files of an order's uploaded models. */
export const uploadedFileIds = (items: OrderItem[]) => items.flatMap(({ model }) => (model.source === 'upload' ? [model.fileId] : []));

/**
 * Deletes uploads that never became part of an order (the customer left before confirming, or
 * confirming failed), once they are older than `ttlMs`. Returns how many were deleted.
 */
export async function pruneCustomerFiles(db: Storage, { now = Date.now(), ttlMs = UNCLAIMED_UPLOAD_TTL_MS } = {}): Promise<number> {
  let deleted = 0;
  for (const file of await db.customerFiles.list()) {
    const uploadedAt = Date.parse(String(file.metadata.uploadedAt));
    if (Number.isFinite(uploadedAt) && now - uploadedAt < ttlMs) continue;
    const orderId = file.metadata.orderId;
    if (typeof orderId === 'string' && (await db.orders.get(orderId))) continue;
    await db.customerFiles.delete(file.id);
    deleted++;
  }
  return deleted;
}
