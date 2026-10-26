export const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');

export function resolveAssetUrl(url: string, apiBase = API_BASE_URL): string {
  if (!/^https?:\/\//i.test(apiBase) || /^(?:https?:|data:|blob:|\/\/)/i.test(url)) return url;
  return new URL(url, new URL(apiBase).origin).href;
}
