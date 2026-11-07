import { t } from '../i18n';
import type { CustomOrder, CustomOrderStatus, EmailSentLogEntry, EmailImportedLogEntry, EmailTemplate, EmailTemplateKey, EmailTemplatesResponse, LogEntry, MailDelivery, Order, OrderKind, OrderStatus, PrintSettings, Product, StatusEmailPreview, PricingSettings, ProjectOrder, ProjectOrderStatus, ProjectProduct, ProjectReviewInput } from '../types';
import { API_BASE_URL, resolveAssetUrl } from './urls';
import type { CatalogPricing } from '../types';

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
const customOrderPath = (id: string) => `/custom-orders/${encodeURIComponent(id)}`;
const kindPath = (kind: OrderKind, id: string) => (kind === 'order' ? orderPath(id) : customOrderPath(id));

/** Status-change email options of an order update: send the status template, with an optional message ({{note}}). */
export interface Notification {
  notify?: boolean;
  note?: string;
}
const projectOrderPath = (id: string) => `/project-orders/${encodeURIComponent(id)}`;
const projectProductPath = (id: string) => `/project-products/${encodeURIComponent(id)}`;

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

  listOrders: (status?: OrderStatus) => request<Order[]>('GET', `/orders${status ? `?status=${status}` : ''}`),
  getOrder: (id: string) => request<Order>('GET', orderPath(id)),
  updateOrder: (id: string, changes: Partial<Pick<Order, 'status' | 'adminNote'>> & Notification) =>
    request<Order>('PATCH', orderPath(id), { json: changes }),
  deleteOrder: (id: string) => request<void>('DELETE', orderPath(id)),

  listCustomOrders: (status?: CustomOrderStatus) =>
    request<CustomOrder[]>('GET', `/custom-orders${status ? `?status=${status}` : ''}`),
  getCustomOrder: (id: string) => request<CustomOrder>('GET', customOrderPath(id)),
  updateCustomOrder: (id: string, changes: Partial<Pick<CustomOrder, 'status' | 'adminNote' | 'quotedPrice'>> & Notification) =>
    request<CustomOrder>('PATCH', customOrderPath(id), { json: changes }),
  deleteCustomOrder: (id: string) => request<void>('DELETE', customOrderPath(id)),
  getPrintSettings: () => request<PrintSettings>('GET', '/print-settings'),

  /** An order's log book, newest first. */
  getLog: (kind: OrderKind, id: string) => request<LogEntry[]>('GET', `${kindPath(kind, id)}/log`),
  /** The status email a (possibly unsaved) status change would send. */
  previewStatusEmail: (kind: OrderKind, id: string, input: { status: string; note?: string; quotedPrice?: number | null }) =>
    request<StatusEmailPreview>('POST', `${kindPath(kind, id)}/email-preview`, { json: input }),
  /** Sends the admin's own email; resolves with the log entry, which records a failed delivery too. */
  sendMessage: (kind: OrderKind, id: string, message: EmailTemplate) =>
    request<EmailSentLogEntry>('POST', `${kindPath(kind, id)}/messages`, { json: message }),
  importEml: (kind: OrderKind, id: string, file: File) =>
    request<EmailImportedLogEntry>('POST', `${kindPath(kind, id)}/log/eml`, {
      body: file, headers: { 'Content-Type': 'application/octet-stream' },
    }),
  async downloadEml(kind: OrderKind, id: string, entryId: string): Promise<Blob> {
    const response = await send('GET', `${kindPath(kind, id)}/log/${encodeURIComponent(entryId)}/eml`);
    return new Blob([await response.arrayBuffer()], { type: 'message/rfc822' });
  },
  getEmailTemplates: () => request<EmailTemplatesResponse>('GET', '/email-templates'),
  updateEmailTemplates: (templates: Record<EmailTemplateKey, EmailTemplate>) =>
    request<EmailTemplatesResponse>('PUT', '/email-templates', { json: { templates } }),
  getMailDelivery: () => request<MailDelivery>('GET', '/email-templates/delivery'),
  updatePrintSettings: (settings: Omit<PrintSettings, 'updatedAt'>) =>
    request<PrintSettings>('PUT', '/print-settings', { json: settings }),
  /** Customer files are private, so they are fetched with the admin key rather than linked directly. */
  async downloadCustomOrderFile(orderId: string, fileId: string): Promise<Blob> {
    const response = await send('GET', `${customOrderPath(orderId)}/files/${encodeURIComponent(fileId)}`);
    return new Blob([await response.arrayBuffer()], { type: 'application/octet-stream' });
  },
  listProjectOrders: (status?: ProjectOrderStatus) => request<ProjectOrder[]>('GET', `/project-orders${status ? `?status=${status}` : ''}`),
  getProjectOrder: (id: string) => request<ProjectOrder>('GET', projectOrderPath(id)),
  updateProjectOrder: (id: string, changes: Partial<Pick<ProjectOrder, 'status' | 'adminNote'>>) =>
    request<ProjectOrder>('PATCH', projectOrderPath(id), { json: changes }),
  deleteProjectOrder: (id: string) => request<void>('DELETE', projectOrderPath(id)),
  /** Prices the order with the shop's current rates and stores the review. */
  saveProjectReview: (id: string, review: ProjectReviewInput) => request<ProjectOrder>('PUT', `${projectOrderPath(id)}/review`, { json: review }),

  getPricing: () => request<PricingSettings>('GET', '/settings/pricing'),
  savePricing: (settings: Omit<PricingSettings, 'updatedAt'>) => request<PricingSettings>('PUT', '/settings/pricing', { json: settings }),

  listProjectProducts: () => request<ProjectProduct[]>('GET', '/project-products'),
  getProjectProduct: (id: string) => request<ProjectProduct>('GET', projectProductPath(id)),
  createProjectProduct: (body: { orderId: string; title: string; description: string; published: boolean }) =>
    request<ProjectProduct>('POST', '/project-products', { json: body }),
  updateProjectProduct: (id: string, changes: Partial<Pick<ProjectProduct, 'title' | 'description' | 'published' | 'measurements'>>) =>
    request<ProjectProduct>('PATCH', projectProductPath(id), { json: changes }),
  deleteProjectProduct: (id: string) => request<void>('DELETE', projectProductPath(id)),
};

/** Downloads an STL/3MF file for the preview (bundled demo files and uploads alike). */
export async function loadModelBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(resolveAssetUrl(url));
  // Single-page-app hosting answers unknown paths with index.html (200), so treat HTML as "not found".
  if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
    throw new Error(t("Model file not found at {0} (HTTP {1}).", url, response.status));
  }
  return response.arrayBuffer();
}
