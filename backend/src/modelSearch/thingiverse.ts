import { TtlCache } from './cache';
import type { ProjectFile } from '../domain/types';
import {
  countOf, fetchJson, firstString, hasMoreResults, idString, imageUrl, isModelFileName, isNsfw, isRecord, onDomain, plainText,
  siteLink, UpstreamError,
} from './normalize';
import type { FetchFn, ModelSearchProvider, ModelSearchResult } from './types';

const API = 'https://api.thingiverse.com';
const DOMAINS = ['thingiverse.com'];
/** Search hits carry no description, so it is read from each thing, a few at a time and cached. */
const DETAIL_CONCURRENCY = 4;
const DETAIL_TIMEOUT_MS = 5_000;

interface Options {
  /** App token from https://www.thingiverse.com/developers; without it the source is "unconfigured". */
  token: string | undefined;
  fetch?: FetchFn;
}

/** Thingiverse's official REST API (`GET /search/{term}/?type=things`, Bearer app token). */
export function thingiverseProvider({ token, fetch: fetchFn = fetch }: Options): ModelSearchProvider {
  const descriptions = new TtlCache<string>(2_000, 24 * 60 * 60 * 1000);
  const headers = { Authorization: `Bearer ${token}` };

  async function description(id: string, signal: AbortSignal): Promise<string> {
    const cached = descriptions.get(id);
    if (cached !== undefined) return cached;
    try {
      const thing = await fetchJson(fetchFn, `${API}/things/${id}`, {
        headers, signal: AbortSignal.any([signal, AbortSignal.timeout(DETAIL_TIMEOUT_MS)]),
      });
      const text = isRecord(thing) ? plainText(thing.description ?? thing.description_html) : '';
      descriptions.set(id, text);
      return text;
    } catch {
      return ''; // A missing description should not hide the model.
    }
  }

  return {
    source: 'thingiverse',
    label: 'Thingiverse',
    configured: Boolean(token),
    searchUrl: (query) => `https://www.thingiverse.com/search?${new URLSearchParams({ q: query, type: 'things' })}`,
    /** https://www.thingiverse.com/thing:12345 (optionally /files etc.). */
    projectId: (url) => (onDomain(url, DOMAINS) ? /^\/thing:(\d{1,12})(?:\/|$)/.exec(url.pathname)?.[1] ?? null : null),
    async project(id, { signal }) {
      const [thing, files] = await Promise.all([
        fetchJson(fetchFn, `${API}/things/${id}`, { headers, signal }),
        fetchJson(fetchFn, `${API}/things/${id}/files`, { headers, signal }).catch(() => null),
      ]);
      if (!isRecord(thing) || !firstString(thing.name)) throw new UpstreamError('Unexpected Thingiverse thing response');
      const description = plainText(thing.description ?? thing.description_html);
      descriptions.set(id, description);
      const listed: ProjectFile[] = (Array.isArray(files) ? files : []).flatMap((file) => {
        if (!isRecord(file)) return [];
        const fileId = idString(file.id);
        const name = firstString(file.name);
        return fileId && name ? [{ id: fileId, name, sizeBytes: countOf(file.size), thumbnailUrl: imageUrl(file.thumbnail) }] : [];
      });
      const models = listed.filter((file) => isModelFileName(file.name));
      return {
        project: {
          source: 'thingiverse',
          id,
          title: firstString(thing.name)!,
          description,
          thumbnailUrl: imageUrl(thing.thumbnail),
          url: siteLink(thing.public_url, DOMAINS) ?? `https://www.thingiverse.com/thing:${id}`,
          author: isRecord(thing.creator) ? firstString(thing.creator.name) : null,
          license: firstString(thing.license),
        },
        files: models.length > 0 ? models : listed,
        filesAvailable: Array.isArray(files),
      };
    },
    async search(query, { limit, signal, position }) {
      const page = position?.page ?? 1;
      const params = new URLSearchParams({ type: 'things', per_page: String(limit), page: String(page), sort: 'relevant' });
      const data = await fetchJson(fetchFn, `${API}/search/${encodeURIComponent(query)}/?${params}`, { headers, signal });
      const hits = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.hits) ? data.hits : null;
      if (!hits) throw new UpstreamError('Unexpected Thingiverse search response');
      const total = isRecord(data) ? countOf(data.total) : null;
      const next = hasMoreResults((page - 1) * limit + hits.length, hits.length, limit, total) ? { page: page + 1 } : null;

      const models: (ModelSearchResult & { rawDescription: unknown })[] = [];
      for (const hit of hits) {
        if (!isRecord(hit) || isNsfw(hit)) continue;
        const id = idString(hit.id);
        const title = firstString(hit.name);
        if (!id || !title) continue;
        models.push({
          source: 'thingiverse',
          id,
          title,
          description: '',
          rawDescription: hit.description,
          thumbnailUrl: imageUrl(hit.preview_image) ?? imageUrl(hit.thumbnail),
          url: siteLink(hit.public_url, DOMAINS) ?? `https://www.thingiverse.com/thing:${id}`,
          author: isRecord(hit.creator) ? firstString(hit.creator.name) : null,
        });
      }
      const selected = models.slice(0, limit);

      let cursor = 0;
      const worker = async () => {
        while (cursor < selected.length) {
          const model = selected[cursor++];
          model.description = plainText(model.rawDescription) || await description(model.id, signal);
        }
      };
      await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, selected.length) }, worker));
      return { results: selected.map(({ rawDescription: _raw, ...model }) => model), total, next };
    },
  };
}
