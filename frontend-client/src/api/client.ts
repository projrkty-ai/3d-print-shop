import { t } from '../i18n';
import type {
  CustomerUpload, CustomEstimate, CustomOrderInput, CustomPrintMeasurements, Order, OrderInput, PrintSettings, Product, ModelSearchResponse,
  ProjectDetails, ProjectOrderInput, ProjectRef, ReadyPrintChoice, ReadyProduct, ReadyProductOrderInput, ReadyQuote,
} from '../types';
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

/** Print time and grams of one copy as the API takes them (per color part). */
const measurements = ({ parts, ...rest }: CustomPrintMeasurements) => ({ ...rest, filaments: parts });
/** The customer's note, left out when empty. */
const note = (text: string) => (text.trim() ? { customerNote: text } : {});

/** Every order is placed with `POST /orders`: the customer, a note, and the models of one source. */
export const api = {
  listProducts: (signal?: AbortSignal) => request<Product[]>('GET', '/products', undefined, signal),
  /** Catalog products from the cart. */
  createOrder: (order: OrderInput) => request<Order>('POST', '/orders', { source: 'catalog', ...order }),
  /** Sends one model file as-is; the returned key is needed to include it in the order. */
  uploadCustomModel: (file: File) => send<CustomerUpload>('/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  }),
  /** The customer's own uploaded models; the shop reviews them and quotes a price. */
  createCustomOrder: ({ files, ...order }: CustomOrderInput) => request<Order>('POST', '/orders', {
    source: 'upload', ...order,
    items: files.map(({ estimate, ...file }) => ({ ...file, ...(estimate && { estimate: measurements(estimate) }) })),
  }),
  getPrintSettings: () => request<PrintSettings>('GET', '/print-settings'),
  /** Prices the browser's slicing of the models (print time and grams per color part of one copy). */
  estimateCustomPrint: (
    files: { quantity: number; parts: { key: string; filamentId: string }[]; estimate: CustomPrintMeasurements }[], signal?: AbortSignal,
  ) => request<CustomEstimate>('POST', '/uploads/estimate', { items: files.map((file) => ({ ...file, estimate: measurements(file.estimate) })) }, signal),
  /** Searches Thingiverse, Printables and MakerWorld through the shop's server. */
  searchModels: (query: string, cursor?: string | null, signal?: AbortSignal) =>
    request<ModelSearchResponse>('GET', `/model-search?${new URLSearchParams({ q: query, ...(cursor && { cursor }) })}`, undefined, signal),
  /** A project with its files, by a link to its model page or by source and id. */
  getProject: (ref: ProjectRef | { url: string }, signal?: AbortSignal) =>
    request<ProjectDetails>('GET', `/model-search/project?${new URLSearchParams('url' in ref ? { url: ref.url } : { source: ref.source, id: ref.id })}`, undefined, signal),
  /** Asks the shop to print an external project; the shop reviews it and quotes a price. */
  createProjectOrder: ({ notes, ...order }: ProjectOrderInput) => request<Order>('POST', '/orders', { source: 'project', ...order, ...note(notes) }),
  /** Print on Demand products: reviewed projects at a fixed price. */
  listReadyProducts: () => request<ReadyProduct[]>('GET', '/project-products'),
  /** The price of `sets` sets with the chosen print variants and scale. */
  quoteReadyProduct: (id: string, body: { sets: number; print?: ReadyPrintChoice }, signal?: AbortSignal) =>
    request<ReadyQuote>('POST', `/project-products/${encodeURIComponent(id)}/quote`, body, signal),
  /** Sets of a Print on Demand product: at its price, or as a quote request when a material changed. */
  orderReadyProduct: (id: string, { notes, ...order }: ReadyProductOrderInput) =>
    request<Order>('POST', '/orders', { source: 'printOnDemand', productId: id, ...order, ...note(notes) }),
};

export async function loadModelBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(resolveAssetUrl(url));
  if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
    throw new Error(t("Model file not found at {value0} (HTTP {value1}).", { value0: url, value1: response.status }));
  }
  return response.arrayBuffer();
}
