import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { MODEL_SEARCH_QUERY } from '../config';
import { t } from '../i18n';

/** Header search across Thingiverse, Printables and MakerWorld; results open on `/search?q=…`. */
export function ModelSearchForm() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const current = pathname === '/search' ? params.get('q') ?? '' : null;
  const [query, setQuery] = useState(current ?? '');

  // Show the searched text while on the results page, e.g. after back/forward navigation.
  useEffect(() => {
    if (current !== null) setQuery(current);
  }, [current]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = query.trim().replace(/\s+/g, ' ');
    if (text.length < MODEL_SEARCH_QUERY.min) return;
    navigate(`/search?${new URLSearchParams({ q: text })}`);
  };

  return (
    <form className="model-search" role="search" onSubmit={submit}>
      <input
        type="search"
        name="q"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('Search Thingiverse, Printables & MakerWorld…')}
        aria-label={t('Search 3D models on Thingiverse, Printables and MakerWorld')}
        minLength={MODEL_SEARCH_QUERY.min}
        maxLength={MODEL_SEARCH_QUERY.max}
        required
        autoComplete="off"
      />
      <button type="submit" className="btn btn--primary">{t('Search')}</button>
    </form>
  );
}
