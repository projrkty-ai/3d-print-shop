import { t } from '../i18n';
import type { Order, OrderStatus, Product } from '../types';
import { API_BASE_URL, resolveAssetUrl } from './urls';

/** What the admin sends when creating or updating a product; the server manages id and timestamps. */
export type ProductBody = Omit<Product, 'id' | 'createdAt' | 'updatedAt'>;

export function toProductBody({ id: _id, createdAt: _c, updatedAt: _u, ...body }: Product): ProductBody {
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

async function request<T>(method: string, path: string, { json, body, headers }: RequestOptions = {}): Promise<T> {
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
  return (response.status === 204 ? undefined : await response.json()) as T;
}

const productPath = (id: string) => `/products/${encodeURIComponent(id)}`;
const orderPath = (id: string) => `/orders/${encodeURIComponent(id)}`;

export const api = {
  /** Checks a token before it is stored. */
  async isValidAdminToken(token: string): Promise<boolean> {
    const response = await fetch(`${API_BASE_URL}/admin/session`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 401) return false;
    if (!response.ok) throw new ApiError(response.status, t("The server could not check the key (HTTP {0}).", response.status));
    return true;
  },

  listProducts: () => request<Product[]>('GET', '/products'),
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

  listOrders: (status?: OrderStatus) => request<Order[]>('GET', `/orders${status ? `?status=${status}` : ''}`),
  getOrder: (id: string) => request<Order>('GET', orderPath(id)),
  updateOrder: (id: string, changes: Partial<Pick<Order, 'status' | 'adminNote'>>) =>
    request<Order>('PATCH', orderPath(id), { json: changes }),
  deleteOrder: (id: string) => request<void>('DELETE', orderPath(id)),
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
