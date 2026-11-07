import sanitizeHtml from 'sanitize-html';
import type { FetchFn } from './types';

export const USER_AGENT = 'PrintForge-ModelSearch/1.0';
export const DESCRIPTION_MAX_LENGTH = 280;

/** A problem talking to a source site. The message is logged, never sent to customers. */
export class UpstreamError extends Error {}

export async function fetchJson(fetchFn: FetchFn, url: string, init: RequestInit): Promise<unknown> {
  const response = await fetchFn(url, {
    ...init,
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...init.headers },
  });
  if (!response.ok) throw new UpstreamError(`HTTP ${response.status} from ${new URL(url).host}`);
  try {
    return await response.json();
  } catch {
    throw new UpstreamError(`Response from ${new URL(url).host} is not JSON`);
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** First non-empty string among the candidates. */
export function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** A result count reported by a source (number or numeric string), else null. */
export function countOf(...values: unknown[]): number | null {
  for (const value of values) {
    const number = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
    if (typeof number === 'number' && Number.isSafeInteger(number) && number >= 0) return number;
  }
  return null;
}

/**
 * Whether a source has more after `loaded` raw items: by its total when known, otherwise by
 * whether the last page was full.
 */
export function hasMoreResults(loaded: number, pageSize: number, limit: number, total: number | null): boolean {
  if (pageSize === 0) return false;
  return total !== null ? loaded < total : pageSize >= limit;
}

/** Ids arrive as numbers or strings; only plain identifiers are accepted (they are used in URLs). */
export function idString(value: unknown): string | null {
  const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Turns a source description (HTML and/or Markdown) into short plain text. Section headings are
 * left out of the preview unless there is nothing else. The storefront renders the result as
 * text, so nothing here is ever interpreted as markup.
 */
export function plainText(value: unknown, maxLength = DESCRIPTION_MAX_LENGTH): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const text = flatten(withoutHeadings(value)) || flatten(value);
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength - 1);
  const wordEnd = cut.lastIndexOf(' ');
  return `${(wordEnd > maxLength * 0.6 ? cut.slice(0, wordEnd) : cut).replace(/[\s.,;:!?-]+$/, '')}…`;
}

const withoutHeadings = (value: string) => value
  .replace(/<h([1-6])\b[^>]*>[\s\S]*?<\/h\1\s*>/gi, ' ')
  .replace(/^\s{0,3}#{1,6}\s.*$/gm, ' ');

function flatten(value: string): string {
  // Keep words from adjacent blocks apart once the tags are gone.
  const spaced = value.replace(/<(?:br|hr|\/p|\/div|\/li|\/h[1-6]|\/tr|\/td|\/th)\b[^>]*>/gi, '$& ');
  return decodeEntities(sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} }))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // Markdown images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // Markdown links keep their text
    .replace(/^\s{0,3}(?:#{1,6}|[-*+]|>)\s+/gm, '') // heading marks, bullets, quotes
    .replace(/(\*\*|__|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseHttps(value: unknown): URL | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim().startsWith('//') ? `https:${value.trim()}` : value.trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

/** An HTTPS link on one of the source's own domains (or a subdomain), else null. */
export function siteLink(value: unknown, domains: readonly string[]): string | null {
  const url = parseHttps(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`)) ? url.href : null;
}

/** Thumbnails are shown by customers' browsers, so only HTTPS images are passed on. */
export function imageUrl(value: unknown): string | null {
  return parseHttps(value)?.href ?? null;
}

/** Whether a link is HTTPS/HTTP on one of the domains (or a subdomain). */
export function onDomain(url: URL, domains: readonly string[]): boolean {
  if (!['https:', 'http:'].includes(url.protocol)) return false;
  const host = url.hostname.toLowerCase();
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

const MODEL_EXTENSIONS = /\.(stl|3mf|obj|step|stp|amf|scad|ply|f3d|gcode|bgcode)$/i;

/** Project pages also list images and PDFs; only printable model files are offered for ordering. */
export const isModelFileName = (name: string) => MODEL_EXTENSIONS.test(name.trim());

/** Sites flag adult content in various ways; flagged models never reach the storefront. */
export function isNsfw(hit: Record<string, unknown>): boolean {
  return [hit.is_nsfw, hit.isNsfw, hit.nsfw].some((flag) => flag === true || flag === 1 || flag === '1');
}
