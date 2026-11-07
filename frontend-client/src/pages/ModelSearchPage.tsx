import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, ApiError } from '../api/client';
import { LoadState } from '../components/LoadState';
import { MODEL_SOURCE_LABELS, ModelSearchCard } from '../components/ModelSearchCard';
import { ProjectOrderPanel } from '../components/ProjectOrderPanel';
import { MODEL_SEARCH_QUERY } from '../config';
import { t } from '../i18n';
import { usePersistentState } from '../store/usePersistentState';
import type { ModelSearchResponse, ModelSearchResult, ModelSearchSource } from '../types';
import { emptyDraft, isDraftLike, normalizeDraft, resetOrder, sameRef, type ProjectOrderDraft } from '../utils/projectOrderDraft';

const DRAFT_KEY = 'printforge.projectOrder';
/** A source's progress across every loaded page. */
interface SourceProgress extends ModelSearchSource {
  /** Results loaded from this source so far. */
  loaded: number;
  /** A later page failed for this source; what was loaded stays. */
  moreFailed: boolean;
}

interface Results {
  results: ModelSearchResult[];
  sources: SourceProgress[];
  nextCursor: string | null;
  more: { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string };
}

type Search = { status: 'loading' } | { status: 'error'; message: string } | ({ status: 'ready' } & Results);

const resultKey = (model: ModelSearchResult) => `${model.source}:${model.id}`;
const errorMessage = (err: unknown) => (err instanceof ApiError ? err.message : t('Could not search for models.'));

function firstPage(response: ModelSearchResponse): Results {
  return {
    results: response.results,
    sources: response.sources.map((source) => ({ ...source, loaded: source.count, moreFailed: false })),
    nextCursor: response.nextCursor,
    more: { status: 'idle' },
  };
}

/** Appends a "load more" page: new results go last, and only the sources in the page change. */
function addPage(current: Results, page: ModelSearchResponse): Results {
  const seen = new Set(current.results.map(resultKey));
  return {
    results: [...current.results, ...page.results.filter((model) => !seen.has(resultKey(model)))],
    sources: current.sources.map((source) => {
      const update = page.sources.find((candidate) => candidate.source === source.source);
      if (!update) return source;
      if (update.status !== 'ok') return { ...source, hasMore: false, moreFailed: true };
      return { ...source, total: update.total ?? source.total, hasMore: update.hasMore, loaded: source.loaded + update.count };
    }),
    nextCursor: page.nextCursor,
    more: { status: 'idle' },
  };
}

function SourceStatus({ source }: { source: SourceProgress }) {
  const site = source.label || MODEL_SOURCE_LABELS[source.source];
  let state: string;
  if (source.status === 'unconfigured') state = t('not available');
  else if (source.status === 'error') state = t("couldn't be searched right now");
  else if (source.total !== null) state = t('{count} results', { count: source.total });
  else state = source.hasMore ? t('{count}+ results', { count: source.loaded }) : t('{count} results', { count: source.loaded });
  return (
    <li className={`model-sources__item model-sources__item--${source.status}`}>
      <span className={`source-badge source-badge--${source.source}`}>{site}</span>
      <span>{state}</span>
      {source.moreFailed && <span className="model-sources__warning">{t("couldn't load more")}</span>}
      <a href={source.searchUrl} target="_blank" rel="noopener noreferrer">
        {t('Search on {site}', { site })} <span aria-hidden="true">↗</span>
        <span className="visually-hidden"> {t('(opens in a new tab)')}</span>
      </a>
    </li>
  );
}

export function ModelSearchPage() {
  const [params] = useSearchParams();
  const query = (params.get('q') ?? '').trim().replace(/\s+/g, ' ');
  const valid = query.length >= MODEL_SEARCH_QUERY.min && query.length <= MODEL_SEARCH_QUERY.max;
  const [search, setSearch] = useState<Search>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = usePersistentState<ProjectOrderDraft>(DRAFT_KEY, emptyDraft, isDraftLike, normalizeDraft);
  const isChosen = (model: ModelSearchResult) => sameRef(draft.ref, model);
  /** The order box follows the last clicked result; a new project starts with fresh order settings. */
  const choose = (model: ModelSearchResult) => {
    if (!isChosen(model)) setDraft({ ...resetOrder(draft), ref: { source: model.source, id: model.id } });
  };
  const hint = search.status === 'ready' ? search.results.find(isChosen) : undefined;
  const panel = <ProjectOrderPanel draft={draft} onChange={setDraft} hint={hint} />;
  /** Cancels the running request when the query changes or the page closes. */
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!valid) return;
    request.current?.abort(); // including a "load more" of the previous query
    const controller = new AbortController();
    request.current = controller;
    setSearch({ status: 'loading' });
    api.searchModels(query, null, controller.signal).then(
      (response) => setSearch({ status: 'ready', ...firstPage(response) }),
      (err: unknown) => {
        if (!controller.signal.aborted) setSearch({ status: 'error', message: errorMessage(err) });
      },
    );
    return () => controller.abort();
  }, [query, valid, attempt]);

  const loadMore = () => {
    if (search.status !== 'ready' || !search.nextCursor || search.more.status === 'loading') return;
    const controller = new AbortController();
    request.current = controller;
    const cursor = search.nextCursor;
    setSearch({ ...search, more: { status: 'loading' } });
    api.searchModels(query, cursor, controller.signal).then(
      (page) => {
        if (!controller.signal.aborted) setSearch((current) => (current.status === 'ready' ? { status: 'ready', ...addPage(current, page) } : current));
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setSearch((current) => (current.status === 'ready' ? { ...current, more: { status: 'error', message: errorMessage(err) } } : current));
      },
    );
  };
  useEffect(() => () => request.current?.abort(), []);

  if (!valid) {
    return (
      <div className="model-search-page">
        <section className="hero">
          <h1>{t('Search 3D models')}</h1>
          <p>{t('Find designs on Thingiverse, Printables and MakerWorld using the search bar at the top of the page.')}</p>
          {query && <p className="banner banner--warning">{t('Enter {min} to {max} characters to search.', MODEL_SEARCH_QUERY)}</p>}
        </section>
        <div className="model-search-page__layout">
          <div />
          {panel}
        </div>
      </div>
    );
  }

  return (
    <div className="model-search-page">
      <section className="hero">
        <h1>{t('Models matching “{query}”', { query })}</h1>
        <p>{t('Designs from Thingiverse, Printables and MakerWorld. Each result opens the original page on its website.')}</p>
      </section>
      <div className="model-search-page__layout">
        <div className="model-search-page__results">
          {search.status !== 'ready' ? (
            <LoadState load={search} onRetry={() => setAttempt((n) => n + 1)} loadingText={t('Searching Thingiverse, Printables and MakerWorld…')} />
          ) : (
            <>
              {search.sources.length > 0 && (
                <ul className="model-sources" aria-label={t('Searched websites')}>
                  {search.sources.map((source) => <SourceStatus key={source.source} source={source} />)}
                </ul>
              )}
              {search.results.length === 0 ? (
                <div className="empty-state">
                  <p>{search.sources.length === 0 ? t('Model search is not available right now.') : t('No models found for “{query}”.', { query })}</p>
                </div>
              ) : (
                <>
                  <p className="muted model-search-page__note">
                    {t('These models are published by their designers on other websites. Check each model’s license there.')}
                  </p>
                  <div className="catalog-grid model-results">
                    {search.results.map((model) => (
                      <ModelSearchCard key={resultKey(model)} model={model} selected={isChosen(model)} onSelect={choose} />
                    ))}
                  </div>
                  <div className="model-search-page__more">
                    <p className="muted" aria-live="polite">{t('Showing {count} models', { count: search.results.length })}</p>
                    {search.more.status === 'error' && <p className="banner banner--error" role="alert">{search.more.message}</p>}
                    {search.nextCursor && (
                      <button type="button" className="btn btn--large" onClick={loadMore}
                        disabled={search.more.status === 'loading'} aria-busy={search.more.status === 'loading'}>
                        {search.more.status === 'loading' ? t('Loading more models…') : t('Load more results')}
                      </button>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
        {panel}
      </div>
    </div>
  );
}
