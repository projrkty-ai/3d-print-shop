import { TtlCache } from './cache';
import { makerWorldProvider } from './makerworld';
import { printablesProvider } from './printables';
import { thingiverseProvider } from './thingiverse';
import {
  MODEL_SOURCES, type FetchFn, type ModelSearchPage, type ModelSearchProvider, type ModelSearchResult,
  type ModelSource, type ProjectDetails, type ProviderPage, type SearchCursor, type SourcePosition, type SourceSummary,
} from './types';

export const RESULTS_PER_SOURCE = 12;
const TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface ProjectRef {
  source: ModelSource;
  id: string;
}

/** Thrown by `project` for a source that is disabled or lacks credentials. */
export class SourceUnavailableError extends Error {
  constructor(readonly source: ModelSource) {
    super(`Model source ${source} is not available.`);
  }
}

export interface ModelSearch {
  /** First page without `cursor`; with it, the next page of every source named in it. */
  search(query: string, cursor?: SearchCursor): Promise<ModelSearchPage>;
  /** Which project a link to one of the sites' model pages refers to; null for any other link. */
  projectFromUrl(url: string): ProjectRef | null;
  /** A project page with its files; rejects with SourceUnavailableError or the site's error. */
  project(ref: ProjectRef): Promise<ProjectDetails>;
}

interface ModelSearchOptions {
  providers: ModelSearchProvider[];
  limit?: number;
  timeoutMs?: number;
  cacheTtlMs?: number;
  log?: (message: string) => void;
}

/** Cache key: source, case- and whitespace-insensitive query, and page position. */
const cacheKey = (source: ModelSource, query: string, position: SourcePosition | null) =>
  `${source}\n${query.trim().toLowerCase().replace(/\s+/g, ' ')}\n${JSON.stringify(position)}`;

/** Round-robin merge so every source is visible at the top of each page. */
function interleave(lists: ModelSearchResult[][]): ModelSearchResult[] {
  const merged: ModelSearchResult[] = [];
  const seen = new Set<string>();
  for (let index = 0; lists.some((list) => index < list.length); index++) {
    for (const list of lists) {
      const result = list[index];
      if (!result || seen.has(`${result.source}:${result.id}`)) continue;
      seen.add(`${result.source}:${result.id}`);
      merged.push(result);
    }
  }
  return merged;
}

type SourceAnswer = SourceSummary & { results: ModelSearchResult[]; next: SourcePosition | null };

/**
 * Searches every source in parallel. A source that fails or times out is reported in `sources`
 * while the others still return results; only successful answers are cached. A failed source is
 * left out of the next page (customers can follow `searchUrl` or search again).
 */
export function createModelSearch({
  providers, limit = RESULTS_PER_SOURCE, timeoutMs = TIMEOUT_MS, cacheTtlMs = CACHE_TTL_MS,
  log = (message) => console.warn(message),
}: ModelSearchOptions): ModelSearch {
  const cache = new TtlCache<ProviderPage>(500, cacheTtlMs);
  const projects = new TtlCache<ProjectDetails>(500, cacheTtlMs);

  async function searchSource(provider: ModelSearchProvider, query: string, position: SourcePosition | null): Promise<SourceAnswer> {
    const summary = { source: provider.source, label: provider.label, searchUrl: provider.searchUrl(query) };
    const nothing = { count: 0, total: null, hasMore: false, results: [], next: null };
    if (!provider.configured) return { ...summary, ...nothing, status: 'unconfigured' };
    const key = cacheKey(provider.source, query, position);
    let page = cache.get(key);
    if (!page) {
      try {
        const answer = await provider.search(query, { limit, signal: AbortSignal.timeout(timeoutMs), position });
        page = { ...answer, results: answer.results.slice(0, limit) };
      } catch (error) {
        const reason = error instanceof Error && error.name === 'TimeoutError' ? `timed out after ${timeoutMs} ms`
          : error instanceof Error ? error.message : String(error);
        log(`Model search: ${provider.label} failed for "${query}": ${reason}`);
        return { ...summary, ...nothing, status: 'error' };
      }
      cache.set(key, page);
    }
    return {
      ...summary, status: 'ok', count: page.results.length, total: page.total, hasMore: page.next !== null,
      results: page.results, next: page.next,
    };
  }

  return {
    async search(query, cursor) {
      const targets = cursor ? providers.filter((provider) => cursor[provider.source]) : providers;
      const answers = await Promise.all(targets.map((provider) => searchSource(provider, query, cursor?.[provider.source] ?? null)));
      const next: SearchCursor = {};
      for (const answer of answers) if (answer.next) next[answer.source] = answer.next;
      return {
        query,
        results: interleave(answers.map((answer) => answer.results)),
        sources: answers.map(({ results: _results, next: _next, ...summary }) => summary),
        next: Object.keys(next).length > 0 ? next : null,
      };
    },
    projectFromUrl(value) {
      let url: URL;
      try {
        url = new URL(value.trim());
      } catch {
        return null;
      }
      for (const provider of providers) {
        const id = provider.projectId(url);
        if (id) return { source: provider.source, id };
      }
      return null;
    },
    async project({ source, id }) {
      const provider = providers.find((candidate) => candidate.source === source);
      if (!provider?.configured) throw new SourceUnavailableError(source);
      const key = `${source}:${id}`;
      const cached = projects.get(key);
      if (cached) return cached;
      try {
        const details = await provider.project(id, { signal: AbortSignal.timeout(timeoutMs) });
        projects.set(key, details);
        return details;
      } catch (error) {
        log(`Model search: ${provider.label} project ${id} failed: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    },
  };
}

/** `MODEL_SEARCH_SOURCES`: comma-separated sources to search, default all; an empty value disables search. */
export function parseModelSources(value: string | undefined): ModelSource[] {
  if (value === undefined) return [...MODEL_SOURCES];
  const sources = value.split(',').map((source) => source.trim().toLowerCase()).filter(Boolean);
  for (const source of sources) {
    if (!(MODEL_SOURCES as readonly string[]).includes(source)) {
      throw new Error(`MODEL_SEARCH_SOURCES contains unknown source "${source}". Use: ${MODEL_SOURCES.join(', ')}.`);
    }
  }
  return [...new Set(sources)] as ModelSource[];
}

/** Builds the search from environment variables (`MODEL_SEARCH_SOURCES`, `THINGIVERSE_TOKEN`). */
export function modelSearchFromEnv(env: NodeJS.ProcessEnv = process.env, fetchFn?: FetchFn): ModelSearch {
  const factories: Record<ModelSource, () => ModelSearchProvider> = {
    thingiverse: () => thingiverseProvider({ token: env.THINGIVERSE_TOKEN?.trim(), fetch: fetchFn }),
    printables: () => printablesProvider({ fetch: fetchFn }),
    makerworld: () => makerWorldProvider({ fetch: fetchFn }),
  };
  return createModelSearch({ providers: parseModelSources(env.MODEL_SEARCH_SOURCES).map((source) => factories[source]()) });
}
