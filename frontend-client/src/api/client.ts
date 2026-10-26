import { t } from '../i18n';
import type { Order, OrderInput, Product } from '../types';
import { API_BASE_URL, resolveAssetUrl } from './urls';

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly details: string[] = []) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      ...(body !== undefined && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, t("Can't reach the shop server. Check your connection and try again."));
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string; details?: string[] } | null;
    throw new ApiError(response.status, payload?.error ?? t("Request failed (HTTP {value0}).", { value0: response.status }), payload?.details);
  }
  return await response.json() as T;
}

export const api = {
  listProducts: () => request<Product[]>('GET', '/products'),
  createOrder: (order: OrderInput) => request<Order>('POST', '/orders', order),
};

export async function loadModelBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(resolveAssetUrl(url));
  if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
    throw new Error(t("Model file not found at {value0} (HTTP {value1}).", { value0: url, value1: response.status }));
  }
  return response.arrayBuffer();
}
