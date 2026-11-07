import type { ProjectFile } from '../domain/types';
import {
  countOf, fetchJson, firstString, hasMoreResults, idString, imageUrl, isNsfw, isRecord, onDomain, plainText, UpstreamError,
} from './normalize';
import type { FetchFn, ModelSearchProvider, ModelSearchResult } from './types';

/**
 * MakerWorld has no documented public API; these are the JSON search endpoints used by its website,
 * tried in order. Field names vary between them, so several spellings are accepted.
 */
const ENDPOINTS = [
  'https://makerworld.com/api/v1/search-service/select/design2',
  'https://makerworld.com/api/v1/search-service/select/design',
];

/** The hit list and the reported total, wherever this endpoint puts them. */
function pageOf(body: unknown): { hits: unknown[]; total: number | null } | null {
  if (!isRecord(body)) return null;
  for (const container of [body, body.data]) {
    if (!isRecord(container)) continue;
    for (const key of ['hits', 'items', 'list']) {
      if (Array.isArray(container[key])) {
        return { hits: container[key] as unknown[], total: countOf(container.total, container.totalCount, container.count) };
      }
    }
  }
  return null;
}

const DOMAINS = ['makerworld.com'];
const DESIGN_URL = 'https://makerworld.com/api/v1/design-service/design/';

/**
 * A design's selectable items: its model files when listed, otherwise its print profiles
 * ("instances"), which is how MakerWorld groups what can be printed.
 */
function designFiles(design: Record<string, unknown>): { files: ProjectFile[]; available: boolean } {
  const model = isRecord(design.model) ? design.model : {};
  for (const list of [design.modelFiles, design.files, model.files, design.instances]) {
    if (!Array.isArray(list)) continue;
    return {
      available: true,
      files: list.flatMap((item): ProjectFile[] => {
        if (!isRecord(item)) return [];
        const id = idString(item.id ?? item.fileId);
        const name = firstString(item.name, item.fileName, item.title);
        return id && name ? [{ id, name, sizeBytes: countOf(item.size, item.fileSize), thumbnailUrl: imageUrl(firstString(item.cover, item.thumbnail)) }] : [];
      }),
    };
  }
  return { files: [], available: false };
}

function toResult(hit: unknown): ModelSearchResult | null {
  if (!isRecord(hit) || isNsfw(hit)) return null;
  const id = idString(hit.id ?? hit.designId);
  const title = firstString(hit.title, hit.name);
  if (!id || !/^\d+$/.test(id) || !title) return null;
  const creator = [hit.designCreator, hit.creator, hit.user].find(isRecord);
  return {
    source: 'makerworld',
    id,
    title,
    description: plainText(firstString(hit.summary, hit.description, hit.details)),
    thumbnailUrl: imageUrl(firstString(hit.cover, hit.coverUrl, hit.thumbnail)),
    url: `https://makerworld.com/en/models/${id}`,
    author: creator ? firstString(creator.name, creator.handle) : null,
  };
}

export function makerWorldProvider({ fetch: fetchFn = fetch }: { fetch?: FetchFn } = {}): ModelSearchProvider {
  /** The endpoint that last answered; new searches start with it. */
  let preferred = 0;
  return {
    source: 'makerworld',
    label: 'MakerWorld',
    configured: true,
    searchUrl: (query) => `https://makerworld.com/en/search/models?${new URLSearchParams({ keyword: query })}`,
    /** https://makerworld.com/en/models/12345-slug (the language segment is optional). */
    projectId: (url) => (onDomain(url, DOMAINS) ? /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/models\/(\d{1,12})(?:[-/]|$)/.exec(url.pathname)?.[1] ?? null : null),
    async project(id, { signal }) {
      const body = await fetchJson(fetchFn, `${DESIGN_URL}${id}`, { signal });
      const design = isRecord(body) && isRecord(body.data) && !firstString(body.title) ? body.data : body;
      const base = toResult(isRecord(design) ? { ...design, id } : null);
      if (!base || !isRecord(design)) throw new UpstreamError('Unexpected MakerWorld design response');
      const { files, available } = designFiles(design);
      return {
        project: { ...base, license: firstString(design.license, isRecord(design.license) ? design.license.name : null) },
        files,
        filesAvailable: available,
      };
    },
    async search(query, { limit, signal, position }) {
      const offset = position?.offset ?? 0;
      const params = new URLSearchParams({ keyword: query, limit: String(limit), offset: String(offset) });
      // Later pages continue with the endpoint that answered the first one.
      const order = position ? [position.variant ?? 0] : [preferred, ...ENDPOINTS.keys()].filter((index, i, all) => all.indexOf(index) === i);
      let lastError: unknown = new UpstreamError('Unexpected MakerWorld search response');
      for (const index of order) {
        const endpoint = ENDPOINTS[index];
        if (!endpoint) break;
        try {
          const page = pageOf(await fetchJson(fetchFn, `${endpoint}?${params}`, { signal }));
          if (page) {
            preferred = index;
            const loaded = offset + page.hits.length;
            return {
              results: page.hits.map(toResult).filter((result): result is ModelSearchResult => result !== null).slice(0, limit),
              total: page.total,
              next: hasMoreResults(loaded, page.hits.length, limit, page.total) ? { variant: index, offset: loaded } : null,
            };
          }
          lastError = new UpstreamError(`Unexpected MakerWorld search response from ${endpoint}`);
        } catch (error) {
          if (signal.aborted) throw error;
          lastError = error;
        }
      }
      throw lastError;
    },
  };
}
