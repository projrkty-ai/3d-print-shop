import type { ExternalProject, ModelSource, ProjectFile } from '../domain/types';

export { MODEL_SOURCES, type ModelSource } from '../domain/types';

/** One model from any repository, normalized to the same shape. */
export interface ModelSearchResult {
  source: ModelSource;
  /** Id on the source site (unique per source). */
  id: string;
  title: string;
  /** Plain text (no markup), possibly shortened; empty when the site provides none. */
  description: string;
  /** HTTPS image URL on the source's CDN, or null. */
  thumbnailUrl: string | null;
  /** HTTPS URL of the original posting on the source site. */
  url: string;
  author: string | null;
}

export type SourceStatus = 'ok' | 'error' | 'unconfigured';

export interface SourceSummary {
  source: ModelSource;
  label: string;
  status: SourceStatus;
  /** Results from this source in this response (one page). */
  count: number;
  /** All matches the source reports for the query, or null when it does not say. */
  total: number | null;
  /** Whether the next page (`nextCursor`) continues this source. */
  hasMore: boolean;
  /** The same search on the source's own website. */
  searchUrl: string;
}

/**
 * Where the next page of one source starts. Sources paginate differently (page numbers, offsets,
 * opaque cursors); `variant` remembers which of a provider's request forms answered.
 */
export interface SourcePosition {
  page?: number;
  offset?: number;
  cursor?: string;
  variant?: number;
}

/** Next page of a combined search: one position per source that has more results. */
export type SearchCursor = Partial<Record<ModelSource, SourcePosition>>;

export interface ModelSearchPage {
  query: string;
  results: ModelSearchResult[];
  sources: SourceSummary[];
  /** Null when no source has more results. */
  next: SearchCursor | null;
}

export interface ProviderSearchOptions {
  limit: number;
  signal: AbortSignal;
  /** Null for the first page. */
  position: SourcePosition | null;
}

export interface ProviderPage {
  results: ModelSearchResult[];
  total: number | null;
  next: SourcePosition | null;
}

/** A project page with the files a customer can choose from. */
export interface ProjectDetails {
  project: ExternalProject;
  files: ProjectFile[];
  /** False when the site did not list files (the customer then describes what to print). */
  filesAvailable: boolean;
}

export interface ModelSearchProvider {
  source: ModelSource;
  label: string;
  /** False when required credentials are missing; the provider is then reported but never called. */
  configured: boolean;
  searchUrl(query: string): string;
  search(query: string, options: ProviderSearchOptions): Promise<ProviderPage>;
  /** The project id in a link to this site's model page, or null when the link is not one. */
  projectId(url: URL): string | null;
  project(id: string, options: { signal: AbortSignal }): Promise<ProjectDetails>;
}

export type FetchFn = typeof fetch;
