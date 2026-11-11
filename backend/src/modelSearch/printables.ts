import type { ExternalProject, ProjectFile } from '../domain/types';
import {
  countOf, fetchBinary, fetchJson, firstString, hasMoreResults, idString, imageUrl, isNsfw, isRecord, onDomain, plainText, siteLink,
  UpstreamError,
} from './normalize';
import type { FetchFn, ModelSearchProvider, ModelSearchResult, ProjectDetails, ProviderPage, SourcePosition } from './types';

const GRAPHQL_URL = 'https://api.printables.com/graphql/';
const MEDIA_URL = 'https://media.printables.com/';

const MODEL_FIELDS = 'id name slug summary image { filePath } user { publicUsername }';

interface Variant {
  query: string;
  variables(position: SourcePosition | null): Record<string, unknown>;
  /** Raw items, the reported total and the opaque cursor of the next page, or null if the answer has no result list. */
  read(data: Record<string, unknown>): { items: unknown[]; total: number | null; cursor?: unknown } | null;
  /** Whether pagination uses the returned cursor rather than an offset. */
  cursor?: boolean;
}

/**
 * Printables has no documented public API; its website uses this GraphQL endpoint. Request forms
 * are tried in order (current search field with cursor or offset paging, then the older field), so a
 * schema change in one does not break search. Later pages reuse the form that answered.
 */
const VARIANTS: Variant[] = [
  {
    query: `query SearchModels($query: String!, $limit: Int, $cursor: String) {
  result: searchPrints2(query: $query, limit: $limit, cursor: $cursor) { items { ${MODEL_FIELDS} } cursor totalCount }
}`,
    variables: (position) => ({ cursor: position?.cursor ?? null }),
    read: (data) => isRecord(data.result) && Array.isArray(data.result.items)
      ? { items: data.result.items, total: countOf(data.result.totalCount), cursor: data.result.cursor }
      : null,
    cursor: true,
  },
  {
    query: `query SearchModels($query: String!, $limit: Int, $offset: Int) {
  result: searchPrints2(query: $query, limit: $limit, offset: $offset) { items { ${MODEL_FIELDS} } totalCount }
}`,
    variables: (position) => ({ offset: position?.offset ?? 0 }),
    read: (data) => isRecord(data.result) && Array.isArray(data.result.items)
      ? { items: data.result.items, total: countOf(data.result.totalCount) }
      : null,
  },
  {
    query: `query SearchModels($query: String!, $limit: Int, $offset: Int) {
  result: searchPrints(query: $query, limit: $limit, offset: $offset) { ${MODEL_FIELDS} }
}`,
    variables: (position) => ({ offset: position?.offset ?? 0 }),
    read: (data) => (Array.isArray(data.result) ? { items: data.result, total: null } : null),
  },
];

const DOMAINS = ['printables.com'];

/** Files are the `stls` list of a print; older and newer schemas may lack the license or the list. */
const PROJECT_QUERIES = [
  `query PrintDetails($id: ID!) { print(id: $id) { ${MODEL_FIELDS} description license { name } stls { id name fileSize filePreviewPath } } }`,
  `query PrintDetails($id: ID!) { print(id: $id) { ${MODEL_FIELDS} description stls { id name fileSize filePreviewPath } } }`,
  `query PrintDetails($id: ID!) { print(id: $id) { ${MODEL_FIELDS} description } }`,
];

/**
 * The website asks for a short-lived download link per file with this mutation (model files are of
 * type `stl`, which includes 3MF); the second form is for a schema without the download source.
 */
const DOWNLOAD_MUTATIONS = [
  `mutation GetDownloadLink($id: ID!, $printId: ID!, $fileType: DownloadFileTypeEnum!, $source: DownloadSourceEnum!) {
  getDownloadLink(id: $id, printId: $printId, fileType: $fileType, source: $source) { ok errors { field messages } output { link } }
}`,
  `mutation GetDownloadLink($id: ID!, $printId: ID!, $fileType: DownloadFileTypeEnum!) {
  getDownloadLink(id: $id, printId: $printId, fileType: $fileType) { ok errors { field messages } output { link } }
}`,
];

const mediaUrl = (filePath: string) =>
  (/^(https:)?\/\//.test(filePath) ? imageUrl(filePath) : imageUrl(new URL(filePath.replace(/^\/+/, ''), MEDIA_URL).href));

const modelUrl = (id: string, slug: unknown) => {
  const safeSlug = typeof slug === 'string' && /^[A-Za-z0-9-]{1,200}$/.test(slug) ? slug : '';
  return `https://www.printables.com/model/${safeSlug ? `${id}-${safeSlug}` : id}`;
};

function toResult(hit: unknown): ModelSearchResult | null {
  if (!isRecord(hit) || isNsfw(hit)) return null;
  const id = idString(hit.id);
  const title = firstString(hit.name);
  if (!id || !/^\d+$/.test(id) || !title) return null;
  const filePath = isRecord(hit.image) ? firstString(hit.image.filePath) : null;
  return {
    source: 'printables',
    id,
    title,
    description: plainText(hit.summary ?? hit.description),
    thumbnailUrl: filePath ? mediaUrl(filePath) : null,
    url: modelUrl(id, hit.slug),
    author: isRecord(hit.user) ? firstString(hit.user.publicUsername) : null,
  };
}

function toProject(id: string, print: Record<string, unknown>): ProjectDetails {
  const base = toResult({ ...print, id });
  if (!base) throw new UpstreamError('Unexpected Printables print response');
  const project: ExternalProject = {
    ...base,
    description: plainText(print.description) || base.description,
    license: isRecord(print.license) ? firstString(print.license.name) : firstString(print.license),
  };
  const files: ProjectFile[] = (Array.isArray(print.stls) ? print.stls : []).flatMap((file) => {
    if (!isRecord(file)) return [];
    const fileId = idString(file.id);
    const name = firstString(file.name);
    const preview = firstString(file.filePreviewPath);
    return fileId && name ? [{ id: fileId, name, sizeBytes: countOf(file.fileSize), thumbnailUrl: preview ? mediaUrl(preview) : null }] : [];
  });
  return { project, files, filesAvailable: Array.isArray(print.stls) };
}

export function printablesProvider({ fetch: fetchFn = fetch }: { fetch?: FetchFn } = {}): ModelSearchProvider {
  /** The request form that last answered; new searches start with it. */
  let preferred = 0;

  return {
    source: 'printables',
    label: 'Printables',
    configured: true,
    searchUrl: (query) => `https://www.printables.com/search/models?${new URLSearchParams({ q: query })}`,
    /** https://www.printables.com/model/12345-slug, also with a language prefix such as /pl/model/…. */
    projectId: (url) => (onDomain(url, DOMAINS) ? /^(?:\/[a-z]{2})?\/model\/(\d{1,12})(?:[-/]|$)/.exec(url.pathname)?.[1] ?? null : null),
    async project(id, { signal }) {
      let lastError: unknown = new UpstreamError('Unexpected Printables print response');
      for (const query of PROJECT_QUERIES) {
        try {
          const body = await fetchJson(fetchFn, GRAPHQL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operationName: 'PrintDetails', query, variables: { id } }),
            signal,
          });
          const print = isRecord(body) && isRecord(body.data) && isRecord(body.data.print) ? body.data.print : null;
          if (print) return toProject(id, print);
          const errors = isRecord(body) && Array.isArray(body.errors) ? body.errors : [];
          const message = errors.map((error) => (isRecord(error) ? error.message : '')).filter(Boolean).join('; ');
          lastError = new UpstreamError(`Printables GraphQL: ${message || 'no print in response'}`);
        } catch (error) {
          if (signal.aborted) throw error;
          lastError = error;
        }
      }
      throw lastError;
    },
    async downloadFile(projectId, file, { signal, maxBytes }) {
      let lastError: unknown = new UpstreamError('Printables gave no download link');
      for (const query of DOWNLOAD_MUTATIONS) {
        let body: unknown;
        try {
          body = await fetchJson(fetchFn, GRAPHQL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              operationName: 'GetDownloadLink', query,
              variables: { id: file.id, printId: projectId, fileType: 'stl', ...(query.includes('$source') && { source: 'model_detail' }) },
            }),
            signal,
          });
        } catch (error) {
          if (signal.aborted) throw error;
          lastError = error;
          continue;
        }
        const result = isRecord(body) && isRecord(body.data) && isRecord(body.data.getDownloadLink) ? body.data.getDownloadLink : null;
        const link = result && isRecord(result.output) ? siteLink(result.output.link, DOMAINS) : null;
        if (link) return fetchBinary(fetchFn, link, { signal, maxBytes });
        const errors = [
          ...(isRecord(body) && Array.isArray(body.errors) ? body.errors : []),
          ...(result && Array.isArray(result.errors) ? result.errors : []),
        ];
        const message = errors.map((error) => (isRecord(error) ? firstString(error.message, Array.isArray(error.messages) ? error.messages.join(' ') : null) : null))
          .filter(Boolean).join('; ');
        lastError = new UpstreamError(`Printables download link: ${message || 'none in the response'}`);
      }
      throw lastError;
    },
    async search(query, { limit, signal, position }) {
      // A later page must continue with the form that produced the first one.
      const order = position
        ? [position.variant ?? 0]
        : [preferred, ...VARIANTS.keys()].filter((index, i, all) => all.indexOf(index) === i);
      let lastError: unknown = new UpstreamError('Unexpected Printables search response');
      for (const index of order) {
        const variant = VARIANTS[index];
        if (!variant) break;
        let body: unknown;
        try {
          body = await fetchJson(fetchFn, GRAPHQL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              operationName: 'SearchModels', query: variant.query, variables: { query, limit, ...variant.variables(position) },
            }),
            signal,
          });
        } catch (error) {
          // GraphQL schema errors may arrive as HTTP 400; try the next form unless time ran out.
          if (signal.aborted) throw error;
          lastError = error;
          continue;
        }
        const page = isRecord(body) && isRecord(body.data) ? variant.read(body.data) : null;
        if (page) {
          preferred = index;
          return toPage(page, index, variant, position, limit);
        }
        const errors = isRecord(body) && Array.isArray(body.errors) ? body.errors : [];
        const message = errors.map((error) => (isRecord(error) ? error.message : '')).filter(Boolean).join('; ');
        lastError = new UpstreamError(`Printables GraphQL: ${message || 'no search results field'}`);
      }
      throw lastError;
    },
  };
}

function toPage(
  { items, total, cursor }: { items: unknown[]; total: number | null; cursor?: unknown },
  variant: number, form: Variant, position: SourcePosition | null, limit: number,
): ProviderPage {
  const loaded = (position?.offset ?? 0) + items.length;
  const results = items.map(toResult).filter((result): result is ModelSearchResult => result !== null).slice(0, limit);
  let next: SourcePosition | null = null;
  if (form.cursor) {
    const nextCursor = typeof cursor === 'string' && cursor && cursor.length <= 1000 ? cursor : null;
    if (nextCursor && hasMoreResults(loaded, items.length, limit, total)) next = { variant, cursor: nextCursor, offset: loaded };
  } else if (hasMoreResults(loaded, items.length, limit, total)) {
    next = { variant, offset: loaded };
  }
  return { results, total, next };
}
