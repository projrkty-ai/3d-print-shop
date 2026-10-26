import { t } from '../../i18n';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import { useAdminAuth } from '../../store/AdminAuthContext';

export type DataState<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

/**
 * Loads admin data and reloads when `deps` change. A 401 means the admin key stopped
 * working (e.g. ADMIN_TOKEN was changed), so the admin is signed out and asked again.
 */
export function useAdminData<T>(fetcher: () => Promise<T>, deps: unknown[]) {
  const { signOut } = useAdminAuth();
  const [state, setState] = useState<DataState<T>>({ status: 'loading' });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetcher()
      .then((data) => !cancelled && setState({ status: 'ready', data }))
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) signOut();
        setState({ status: 'error', message: err instanceof ApiError ? err.message : t("Could not load the data.") });
      });
    return () => {
      cancelled = true;
    };
    // `fetcher` is recreated every render; `deps` says when the request actually changes.
  }, [...deps, version, signOut]);

  const setData = useCallback((data: T) => setState({ status: 'ready', data }), []);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { state, setData, reload };
}
