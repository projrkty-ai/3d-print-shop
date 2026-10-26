import { t } from '../i18n';
interface Props {
  load: { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' };
  onRetry?: () => void;
  loadingText?: string;
}

/** Placeholder while data loads, or an error with a retry button; renders nothing once ready. */
export function LoadState({ load, onRetry, loadingText = t("Loading…") }: Props) {
  if (load.status === 'ready') return null;
  if (load.status === 'loading') {
    return (
      <div className="empty-state" role="status">
        <p>{loadingText}</p>
      </div>
    );
  }
  return (
    <div className="empty-state" role="alert">
      <h1>{t("Something went wrong")}</h1>
      <p>{load.message}</p>
      {onRetry && (
        <button type="button" className="btn btn--primary" onClick={onRetry}>{t("Try again")}</button>
      )}
    </div>
  );
}
