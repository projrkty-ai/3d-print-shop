import { t } from '../i18n';
import type { CustomerUpload, CustomOrder, CustomOrderInput, Order, OrderInput, PrintSettings, Product, ModelSearchResponse, ProjectDetails, ProjectOrder, ProjectOrderInput, ProjectRef, ReadyProduct, ReadyProductOrderInput } from '../types';
import { API_BASE_URL, resolveAssetUrl } from './urls';

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly details: string[] = []) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return send<T>(path, {
    method,
    ...(signal && { signal }),
    ...(body !== undefined && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

async function send<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, init);
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError(0, t("Can't reach the shop server. Check your connection and try again."));
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string; details?: string[] } | null;
    throw new ApiError(response.status, payload?.error ?? t("Request failed (HTTP {value0}).", { value0: response.status }), payload?.details);
  }
  return await response.json() as T;
}

export const api = {
  listProducts: (signal?: AbortSignal) => request<Product[]>('GET', '/products', undefined, signal),
  createOrder: (order: OrderInput) => request<Order>('POST', '/orders', order),
  /** Sends one model file as-is; the returned key is needed to include it in the print request. */
  uploadCustomModel: (file: File) => send<CustomerUpload>('/custom-orders/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  }),
  createCustomOrder: (order: CustomOrderInput) => request<CustomOrder>('POST', '/custom-orders', order),
  getPrintSettings: () => request<PrintSettings>('GET', '/print-settings'),
  /** Searches Thingiverse, Printables and MakerWorld through the shop's server. */
  searchModels: (query: string, cursor?: string | null, signal?: AbortSignal) =>
    request<ModelSearchResponse>('GET', `/model-search?${new URLSearchParams({ q: query, ...(cursor && { cursor }) })}`, undefined, signal),
  /** A project with its files, by a link to its model page or by source and id. */
  getProject: (ref: ProjectRef | { url: string }, signal?: AbortSignal) =>
    request<ProjectDetails>('GET', `/model-search/project?${new URLSearchParams('url' in ref ? { url: ref.url } : { source: ref.source, id: ref.id })}`, undefined, signal),
  /** Asks the shop to print an external project; the shop reviews it and quotes a price. */
  createProjectOrder: (order: ProjectOrderInput) => request<ProjectOrder>('POST', '/project-orders', order),
  /** Ready-to-print products: reviewed projects at a fixed price. */
  listReadyProducts: () => request<ReadyProduct[]>('GET', '/project-products'),
  orderReadyProduct: (id: string, order: ReadyProductOrderInput) =>
    request<ProjectOrder>('POST', `/project-products/${encodeURIComponent(id)}/orders`, order),
};

export async function loadModelBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(resolveAssetUrl(url));
  if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
    throw new Error(t("Model file not found at {value0} (HTTP {value1}).", { value0: url, value1: response.status }));
  }
  return response.arrayBuffer();
}
