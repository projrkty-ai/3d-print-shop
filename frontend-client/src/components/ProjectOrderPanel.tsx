import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { t } from '../i18n';
import type { Customer, ModelSearchResult, ProjectDetails, ProjectOrder } from '../types';
import { resetOrder, sameRef, type ProjectOrderDraft } from '../utils/projectOrderDraft';
import { emptyCustomer, Field } from './CustomerFields';
import { MODEL_SOURCE_LABELS } from './ModelSearchCard';
import { ProjectOrderDialog } from './ProjectOrderDialog';

type Details = { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; details: ProjectDetails };

interface Props {
  draft: ProjectOrderDraft;
  onChange: (draft: ProjectOrderDraft) => void;
  /** The search result the draft refers to, shown while its project page loads. */
  hint?: ModelSearchResult;
}

/**
 * First step of ordering a project, beside the search results: a preview of the last clicked (or pasted)
 * project. "Order" opens the second step, a dialog with the models, print settings and delivery details.
 */
export function ProjectOrderPanel({ draft, onChange, hint }: Props) {
  const [details, setDetails] = useState<Details>({ status: 'idle' });
  const [url, setUrl] = useState('');
  const [ordering, setOrdering] = useState(false);
  /** The last order sent, shown until another project is chosen. */
  const [placed, setPlaced] = useState<ProjectOrder | null>(null);
  /** Kept while the dialog is closed and reopened during the visit (not stored in the browser). */
  const [customer, setCustomer] = useState<Customer>(emptyCustomer);
  const request = useRef<AbortController | null>(null);
  const orderButton = useRef<HTMLButtonElement>(null);
  const loaded = details.status === 'ready' ? details.details : null;
  const { ref } = draft;

  // Another project: forget the confirmation of the previous order and load the new project page
  // (a pasted link arrives already loaded).
  useEffect(() => {
    if (!ref) {
      setDetails({ status: 'idle' });
      return;
    }
    if (placed && !sameRef(placed.project, ref)) setPlaced(null);
    if (loaded && sameRef(loaded.project, ref)) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setDetails({ status: 'loading' });
    api.getProject(ref, controller.signal).then(
      (result) => setDetails({ status: 'ready', details: result }),
      (err: unknown) => {
        if (!controller.signal.aborted) setDetails({ status: 'error', message: err instanceof ApiError ? err.message : t('Could not load this project.') });
      },
    );
    return () => controller.abort();
  }, [ref?.source, ref?.id]);

  async function loadUrl(event: FormEvent) {
    event.preventDefault();
    const link = url.trim();
    if (!link) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setDetails({ status: 'loading' });
    try {
      const result = await api.getProject({ url: link }, controller.signal);
      setDetails({ status: 'ready', details: result });
      const next = { source: result.project.source, id: result.project.id };
      if (!sameRef(next, ref)) {
        setPlaced(null);
        onChange({ ...resetOrder(draft), ref: next });
      }
      setUrl('');
    } catch (err) {
      if (!controller.signal.aborted) setDetails({ status: 'error', message: err instanceof ApiError ? err.message : t('Could not load this project.') });
    }
  }

  const closeDialog = useCallback(() => {
    setOrdering(false);
    orderButton.current?.focus();
  }, []);

  function handlePlaced(order: ProjectOrder) {
    setPlaced(order);
    setOrdering(false);
    onChange(resetOrder(draft));
  }

  const project = loaded?.project ?? (hint && sameRef(hint, ref) ? hint : null);
  const site = project ? MODEL_SOURCE_LABELS[project.source] : '';
  const modelCount = loaded?.files.length ?? 0;

  return (
    <aside className="card project-order" aria-label={t('Order a project')}>
      <h2>{t('Order a project')}</h2>
      {placed ? (
        <div className="banner banner--success" role="status">
          <strong>{t('Order {number} received.', { number: placed.number })}</strong>
          <p>{t('We will review “{title}” and email a quote to {email}.', { title: placed.project.title, email: placed.customer.email })}</p>
        </div>
      ) : (
        <p className="muted">{t('Pick a model from the results or paste its link. We review every request and send you a quote — nothing is paid now.')}</p>
      )}

      {project ? (
        <div className="project-order__project">
          <div className="project-order__thumb">
            {project.thumbnailUrl ? <img src={project.thumbnailUrl} alt="" referrerPolicy="no-referrer" /> : <span aria-hidden="true">◆</span>}
          </div>
          <div>
            <span className={`source-badge source-badge--${project.source}`}>{site}</span>
            <h3 className="project-order__title">{project.title}</h3>
            {project.author && <p className="muted">{t('by {author}', { author: project.author })}</p>}
            {loaded?.project.license && <p className="muted">{t('License: {license}', { license: loaded.project.license })}</p>}
            {loaded && (
              <p className="muted">{modelCount > 0 ? t('Models in this project: {count}', { count: modelCount }) : t('Models are not listed separately')}</p>
            )}
            <a href={project.url} target="_blank" rel="noopener noreferrer">
              {t('View on {site}', { site })} <span aria-hidden="true">↗</span>
              <span className="visually-hidden"> {t('(opens in a new tab)')}</span>
            </a>
          </div>
        </div>
      ) : (
        <p className="project-order__empty">{t('No project selected yet. Click a result on the left, or paste a link below.')}</p>
      )}

      {details.status === 'loading' && <p className="muted" role="status">{t('Loading project…')}</p>}
      {details.status === 'error' && <p className="banner banner--error" role="alert">{details.message}</p>}

      {project && (
        <button ref={orderButton} type="button" className="btn btn--primary btn--large project-order__submit"
          disabled={!loaded} onClick={() => setOrdering(true)}>
          {placed ? t('Order this project again…') : t('Order this project…')}
        </button>
      )}

      <form className="project-order__url" onSubmit={(e) => void loadUrl(e)}>
        <Field label={t('Or paste a link from Thingiverse, Printables or MakerWorld')}>
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.printables.com/model/…"
            maxLength={2000} inputMode="url" />
        </Field>
        <button type="submit" className="btn btn--small" disabled={!url.trim() || details.status === 'loading'}>{t('Load project')}</button>
      </form>

      {ordering && loaded && (
        <ProjectOrderDialog details={loaded} draft={draft} onChange={onChange} customer={customer} onCustomerChange={setCustomer}
          onClose={closeDialog} onPlaced={handlePlaced} />
      )}
    </aside>
  );
}
