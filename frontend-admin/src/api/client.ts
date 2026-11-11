import { t } from '../i18n';
import type { EmailSentLogEntry, EmailImportedLogEntry, EmailTemplate, EmailTemplatesResponse, ItemReview, LogEntry, MailDelivery, MeasurementsInput, Order, OrderSource, OrderStatus, Printer, PrinterInput, PrinterModelInput, PrinterModelTemplate, PrinterModelWithPrinters, PrinterQueue, PrintSettings, Product, StatusEmailPreview, PricingSettings, ProjectProduct } from '../types';
import { API_BASE_URL, resolveAssetUrl } from './urls';
import type { CatalogPricing, MeshFormat } from '../types';

/** What the admin sends when creating or updating a product; the server manages id and timestamps. */
export type ProductBody = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'catalogPricing'>;

export function toProductBody({ id: _id, createdAt: _c, updatedAt: _u, catalogPricing: _pricing, ...body }: Product): ProductBody {
  return body;
}

/** An error response from the API: `message` is safe to show, `details` lists specific problems. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'printforge.adminToken';

/** Kept for the browser tab's lifetime only, so a shared computer doesn't stay signed in. */
export function getAdminToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable: the token lasts until the page is reloaded.
  }
}

interface RequestOptions {
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(method, path, options);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

/** Sends an authenticated request and turns error responses into `ApiError`s. */
async function send(method: string, path: string, { json, body, headers }: RequestOptions = {}): Promise<Response> {
  const token = getAdminToken();
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        ...(json !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : body,
    });
  } catch {
    throw new ApiError(0, t("Can't reach the shop server. Check your connection and try again."));
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string; details?: string[] } | null;
    throw new ApiError(response.status, payload?.error ?? t("Request failed (HTTP {0}).", response.status), payload?.details);
  }
  return response;
}

const productPath = (id: string) => `/products/${encodeURIComponent(id)}`;
const orderPath = (id: string) => `/orders/${encodeURIComponent(id)}`;

/** The printer whose queue an order joins (status `queued`), and how long it prints (omitted: measured). */
export interface QueueInput {
  printerId: string;
  printMinutes?: number;
}

/** Status-change email options of an order update: send the status template, with an optional message ({{note}}). */
export interface Notification {
  notify?: boolean;
  note?: string;
}
const projectProductPath = (id: string) => `/project-products/${encodeURIComponent(id)}`;
const printerPath = (id: string) => `/printers/${encodeURIComponent(id)}`;
const printerModelPath = (id: string) => `/printer-models/${encodeURIComponent(id)}`;

export const api = {
  /** Checks a token before it is stored. */
  async isValidAdminToken(token: string): Promise<boolean> {
    const response = await fetch(`${API_BASE_URL}/admin/session`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 401) return false;
    if (!response.ok) throw new ApiError(response.status, t("The server could not check the key (HTTP {0}).", response.status));
    return true;
  },

  listProducts: () => request<Product[]>('GET', '/products'),
  getCatalogPricing: () => request<CatalogPricing>('GET', '/settings/catalog-pricing'),
  createProduct: (product: ProductBody) => request<Product>('POST', '/products', { json: product }),
  updateProduct: (id: string, product: ProductBody) => request<Product>('PUT', productPath(id), { json: product }),
  deleteProduct: (id: string) => request<void>('DELETE', productPath(id)),

  uploadModelFile: (file: File) =>
    request<{ url: string }>('POST', '/model-files', {
      body: file,
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    }),
  uploadDescriptionImage: (file: File) =>
    request<{ url: string }>('POST', '/media-files', {
      body: file, headers: { 'Content-Type': 'application/octet-stream' },
    }),
  /** Shop texture images are public media files too; the original is kept at full resolution for printing. */
  uploadTextureImage: (file: File) =>
    request<{ url: string }>('POST', '/media-files', {
      body: file, headers: { 'Content-Type': 'application/octet-stream' },
    }),

  /** Every order, newest first, optionally of one status and one model source. */
  listOrders: ({ status, source }: { status?: OrderStatus; source?: OrderSource } = {}) => {
    const query = new URLSearchParams({ ...(status && { status }), ...(source && { source }) }).toString();
    return request<Order[]>('GET', `/orders${query ? `?${query}` : ''}`);
  },
  getOrder: (id: string) => request<Order>('GET', orderPath(id)),
  /** The same processing for every order: status, internal note and — for orders that need a quote — the price. */
  updateOrder: (id: string, changes: Partial<Pick<Order, 'status' | 'adminNote'>> & { price?: number | null; queue?: QueueInput } & Notification) =>
    request<Order>('PATCH', orderPath(id), { json: changes }),
  /** Takes the order out of its printer's queue, back to its status before queueing. */
  removeFromQueue: (id: string, { notify = false }: { notify?: boolean } = {}) =>
    request<Order>('DELETE', `${orderPath(id)}/print-job${notify ? '?notify=true' : ''}`),
  deleteOrder: (id: string) => request<void>('DELETE', orderPath(id)),
  /** Stores the shop's measurements of one copy of an item (sliced or entered), priced by the server. */
  reviewOrderItem: (id: string, index: number, review: MeasurementsInput & { sliced?: ItemReview['sliced'] }) =>
    request<Order>('PUT', `${orderPath(id)}/items/${index}/review`, { json: review }),
  /**
   * One of the order's external project files (by its id on the project's site), which the server
   * downloads from the site right now; the shop keeps no copy. `format` is null for files other than
   * STL and 3MF.
   */
  async downloadProjectFile(orderId: string, sourceFileId: string): Promise<ProjectFileDownload> {
    const response = await send('GET', `${orderPath(orderId)}/project-files/${encodeURIComponent(sourceFileId)}`);
    const format = response.headers.get('x-model-format');
    return {
      blob: new Blob([await response.arrayBuffer()], { type: 'application/octet-stream' }),
      fileName: dispositionFileName(response.headers.get('content-disposition')),
      format: format === 'stl' || format === '3mf' ? format : null,
    };
  },
  /** Customer files are private, so they are fetched with the admin key rather than linked directly. */
  async downloadOrderFile(orderId: string, fileId: string): Promise<Blob> {
    const response = await send('GET', `${orderPath(orderId)}/files/${encodeURIComponent(fileId)}`);
    return new Blob([await response.arrayBuffer()], { type: 'application/octet-stream' });
  },
  getPrintSettings: () => request<PrintSettings>('GET', '/print-settings'),

  /** An order's log book, newest first. */
  getLog: (id: string) => request<LogEntry[]>('GET', `${orderPath(id)}/log`),
  /** The status email a (possibly unsaved) status change would send. */
  previewStatusEmail: (id: string, input: { status: OrderStatus; note?: string; price?: number | null; queue?: QueueInput }) =>
    request<StatusEmailPreview>('POST', `${orderPath(id)}/email-preview`, { json: input }),
  /** Sends the admin's own email; resolves with the log entry, which records a failed delivery too. */
  sendMessage: (id: string, message: EmailTemplate) =>
    request<EmailSentLogEntry>('POST', `${orderPath(id)}/messages`, { json: message }),
  importEml: (id: string, file: File) =>
    request<EmailImportedLogEntry>('POST', `${orderPath(id)}/log/eml`, {
      body: file, headers: { 'Content-Type': 'application/octet-stream' },
    }),
  async downloadEml(id: string, entryId: string): Promise<Blob> {
    const response = await send('GET', `${orderPath(id)}/log/${encodeURIComponent(entryId)}/eml`);
    return new Blob([await response.arrayBuffer()], { type: 'message/rfc822' });
  },
  getEmailTemplates: () => request<EmailTemplatesResponse>('GET', '/email-templates'),
  updateEmailTemplates: (templates: Record<OrderStatus, EmailTemplate>) =>
    request<EmailTemplatesResponse>('PUT', '/email-templates', { json: { templates } }),
  getMailDelivery: () => request<MailDelivery>('GET', '/email-templates/delivery'),
  updatePrintSettings: (settings: Omit<PrintSettings, 'updatedAt'>) =>
    request<PrintSettings>('PUT', '/print-settings', { json: settings }),
  getPricing: () => request<PricingSettings>('GET', '/settings/pricing'),
  savePricing: (settings: Omit<PricingSettings, 'updatedAt'>) => request<PricingSettings>('PUT', '/settings/pricing', { json: settings }),

  listProjectProducts: () => request<ProjectProduct[]>('GET', '/project-products'),
  getProjectProduct: (id: string) => request<ProjectProduct>('GET', projectProductPath(id)),
  createProjectProduct: (body: { orderId: string; title: string; description: string; published: boolean }) =>
    request<ProjectProduct>('POST', '/project-products', { json: body }),
  updateProjectProduct: (
    id: string,
    changes: Partial<Pick<ProjectProduct, 'title' | 'description' | 'published' | 'measurements' | 'mesh' | 'model' | 'slicing' | 'scaling'>>,
  ) =>
    request<ProjectProduct>('PATCH', projectProductPath(id), { json: changes }),
  deleteProjectProduct: (id: string) => request<void>('DELETE', projectProductPath(id)),

  /** The printers warehouse: the shop's printers, sorted by name, each with its model. */
  listPrinters: () => request<Printer[]>('GET', '/printers'),
  /** The printer's queue with estimated times. */
  getPrinterQueue: (id: string) => request<PrinterQueue>('GET', `${printerPath(id)}/queue`),
  createPrinter: (printer: PrinterInput) => request<Printer>('POST', '/printers', { json: printer }),
  updatePrinter: (id: string, printer: PrinterInput) => request<Printer>('PUT', printerPath(id), { json: printer }),
  deletePrinter: (id: string) => request<void>('DELETE', printerPath(id)),

  /** Printer models, sorted by name, each with its printers. */
  listPrinterModels: () => request<PrinterModelWithPrinters[]>('GET', '/printer-models'),
  /** Known printers a new model can start from. */
  listPrinterModelTemplates: () => request<PrinterModelTemplate[]>('GET', '/printer-models/templates'),
  createPrinterModel: (model: PrinterModelInput) => request<PrinterModelWithPrinters>('POST', '/printer-models', { json: model }),
  /** Changes the model for every printer of it. */
  updatePrinterModel: (id: string, model: PrinterModelInput) => request<PrinterModelWithPrinters>('PUT', printerModelPath(id), { json: model }),
  /** Refused (409) while printers use the model. */
  deletePrinterModel: (id: string) => request<void>('DELETE', printerModelPath(id)),
  /** Stores the model's slicer profiles (a ZIP), replacing any previous archive; resolves with the updated model. */
  uploadPrinterModelProfiles: (id: string, file: File) =>
    request<PrinterModelWithPrinters>('POST', `${printerModelPath(id)}/profiles`, {
      body: file,
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    }),
  /** Profile archives are private, so they are fetched with the admin key rather than linked directly. */
  async downloadPrinterModelProfiles(id: string): Promise<Blob> {
    const response = await send('GET', `${printerModelPath(id)}/profiles`);
    return new Blob([await response.arrayBuffer()], { type: 'application/zip' });
  },
  removePrinterModelProfiles: (id: string) => request<PrinterModelWithPrinters>('DELETE', `${printerModelPath(id)}/profiles`),
};

/** A model file of an external project, downloaded from its site through the server. */
export interface ProjectFileDownload {
  blob: Blob;
  /** The name the server sent, or null. */
  fileName: string | null;
  format: MeshFormat | null;
}

/** File name of a Content-Disposition header (`filename*=UTF-8''…` preferred). */
export function dispositionFileName(header: string | null): string | null {
  if (!header) return null;
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim()) || null;
    } catch {
      // fall back to the plain name
    }
  }
  return /filename\s*=\s*"?([^";]+)"?/i.exec(header)?.[1]?.trim() || null;
}

/** Downloads an STL/3MF file for the preview (bundled demo files and uploads alike). */
export async function loadModelBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(resolveAssetUrl(url));
  // Single-page-app hosting answers unknown paths with index.html (200), so treat HTML as "not found".
  if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
    throw new Error(t("Model file not found at {0} (HTTP {1}).", url, response.status));
  }
  return response.arrayBuffer();
}
