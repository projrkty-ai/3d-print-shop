import { t } from '../i18n';
import { useEffect, useState } from 'react';

/**
 * useState that mirrors its value to localStorage. `isValid` guards against
 * stale or hand-edited data; invalid stored values fall back to `initial`.
 * `migrate` upgrades valid data saved by an older version of the app.
 */
export function usePersistentState<T>(
  key: string,
  initial: () => T,
  isValid: (value: unknown) => value is T,
  migrate: (value: T) => T = (value) => value,
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (isValid(parsed)) return migrate(parsed);
        console.warn(`Ignoring invalid data saved under "${key}".`);
      }
    } catch (err) {
      console.warn(`Could not restore "${key}" from localStorage`, err);
    }
    return initial();
  });
  const [persistenceError, setPersistenceError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      setPersistenceError(null);
    } catch (err) {
      console.warn(`Could not persist "${key}" to localStorage`, err);
      setPersistenceError(t("Your changes could not be saved in this browser. Storage may be full or blocked. Keep this page open to avoid losing your configuration."));
    }
  }, [key, value]);

  return [value, setValue, persistenceError] as const;
}
