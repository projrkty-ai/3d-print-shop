import { useId, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { LOCALE, t } from '../i18n';
import type { Customer, Order, ProjectDetails, ProjectFile, ProjectPrintSettings } from '../types';
import type { ProjectOrderDraft } from '../utils/projectOrderDraft';
import { CustomerFields, customerForApi, Field } from './CustomerFields';
import { Dialog } from './Dialog';
import { MODEL_SOURCE_LABELS } from './ModelSearchCard';
import { PrintSettingsEditor } from './PrintSettingsEditor';

export function formatFileSize(bytes: number | null): string | null {
  if (bytes === null) return null;
  const number = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
  return bytes >= 1_048_576 ? `${number.format(bytes / 1_048_576)} MB` : `${number.format(Math.max(1, bytes / 1024))} kB`;
}

const cleanSettings = (settings: ProjectPrintSettings): ProjectPrintSettings => ({
  ...settings, filaments: settings.filaments.map((filament) => ({ ...filament, color: filament.color.trim() })),
});

interface Props {
  details: ProjectDetails;
  draft: ProjectOrderDraft;
  onChange: (draft: ProjectOrderDraft) => void;
  customer: Customer;
  onCustomerChange: (customer: Customer) => void;
  onClose: () => void;
  onPlaced: (order: Order) => void;
}

/** Second step of ordering a project: which models, how to print each one, and where to send it. */
export function ProjectOrderDialog({ details, draft, onChange, customer, onCustomerChange, onClose, onPlaced }: Props) {
  const titleId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const { project, files } = details;
  const site = MODEL_SOURCE_LABELS[project.source];
  const listed = files.length > 0;
  const chosenIds = new Set(draft.fileIds ?? files.map((file) => file.id));
  const chosen = files.filter((file) => chosenIds.has(file.id));
  const sameForAll = draft.sameForAll || files.length <= 1;
  const settingsFor = (file: ProjectFile) => (sameForAll ? draft.shared : draft.perModel[file.id] ?? draft.shared);

  const setChosen = (ids: string[]) => onChange({ ...draft, fileIds: ids });
  const setModelSettings = (file: ProjectFile, settings: ProjectPrintSettings) =>
    onChange({ ...draft, perModel: { ...draft.perModel, [file.id]: settings } });
  function setSameForAll(same: boolean) {
    // Separate settings start from the shared selection, so nothing has to be entered twice.
    const perModel = same ? draft.perModel : Object.fromEntries(files.map((file) => [file.id, draft.perModel[file.id] ?? draft.shared]));
    onChange({ ...draft, sameForAll: same, perModel });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (listed && chosen.length === 0) {
      setError(new ApiError(0, t('Select at least one model to print.')));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const order = await api.createProjectOrder({
        customer: customerForApi(customer),
        project: { source: project.source, id: project.id, title: project.title, url: project.url, thumbnailUrl: project.thumbnailUrl, author: project.author },
        items: listed
          ? chosen.map((file) => ({ file: { id: file.id, name: file.name }, settings: cleanSettings(settingsFor(file)) }))
          : [{ file: null, settings: cleanSettings(draft.shared) }],
        sameSettingsForAll: sameForAll,
        notes: draft.notes.trim(),
      });
      onPlaced(order);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, t('Could not send the order.')));
      setSubmitting(false);
    }
  }

  return (
    <Dialog labelledBy={titleId} onClose={onClose} canClose={!submitting} initialFocus={closeButton} className="project-dialog">
      <header className="dialog__header">
        <div className="project-dialog__project">
          <div className="project-order__thumb">
            {project.thumbnailUrl ? <img src={project.thumbnailUrl} alt="" referrerPolicy="no-referrer" /> : <span aria-hidden="true">◆</span>}
          </div>
          <div>
            <span className={`source-badge source-badge--${project.source}`}>{site}</span>
            <h2 id={titleId}>{t('Order “{title}”', { title: project.title })}</h2>
            {project.author && <p className="muted">{t('by {author}', { author: project.author })}</p>}
          </div>
        </div>
        <button ref={closeButton} type="button" className="btn btn--ghost" onClick={onClose} disabled={submitting}>{t('Close')}</button>
      </header>

      <form onSubmit={(e) => void submit(e)}>
        <section className="project-dialog__section">
          <h3>{t('Models and print settings')}</h3>
          {listed ? (
            <>
              {files.length > 1 && (
                <div className="project-dialog__toolbar">
                  <label className="project-dialog__same">
                    <input type="checkbox" checked={sameForAll} onChange={(e) => setSameForAll(e.target.checked)} />
                    {t('Use one selection for all models')}
                  </label>
                  <span>
                    <button type="button" className="btn btn--small btn--ghost" onClick={() => setChosen(files.map((file) => file.id))}>{t('Select all')}</button>
                    <button type="button" className="btn btn--small btn--ghost" onClick={() => setChosen([])}>{t('Select none')}</button>
                  </span>
                </div>
              )}
              <ul className={`project-models${sameForAll ? ' project-models--compact' : ''}`}>
                {files.map((file) => {
                  const included = chosenIds.has(file.id);
                  return (
                    <li key={file.id} className={`project-model${included ? '' : ' is-excluded'}`}>
                      <label className="project-model__head">
                        <input type="checkbox" checked={included}
                          onChange={(e) => setChosen(e.target.checked ? [...chosenIds, file.id] : [...chosenIds].filter((id) => id !== file.id))} />
                        {file.thumbnailUrl && <img src={file.thumbnailUrl} alt="" referrerPolicy="no-referrer" />}
                        <span className="project-model__name">{file.name}</span>
                        {formatFileSize(file.sizeBytes) && <span className="muted">{formatFileSize(file.sizeBytes)}</span>}
                      </label>
                      {!sameForAll && included && (
                        <PrintSettingsEditor subject={file.name} settings={settingsFor(file)} onChange={(settings) => setModelSettings(file, settings)} />
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="muted">{t('Models selected: {count} of {total}', { count: chosen.length, total: files.length })}</p>
              {sameForAll && chosen.length > 0 && (
                <div className="project-dialog__shared">
                  <h4>{files.length > 1 ? t('Settings for all selected models') : t('Print settings')}</h4>
                  <PrintSettingsEditor subject={files.length > 1 ? t('all selected models') : files[0].name} settings={draft.shared}
                    onChange={(shared) => onChange({ ...draft, shared })} />
                </div>
              )}
            </>
          ) : (
            <>
              <p className="muted">{t('This site does not list the models separately, so we will print the whole project. Describe any parts you want left out in the notes.')}</p>
              <div className="project-dialog__shared">
                <h4>{t('Print settings')}</h4>
                <PrintSettingsEditor subject={t('the whole project')} settings={draft.shared} onChange={(shared) => onChange({ ...draft, shared })} />
              </div>
            </>
          )}
          <Field label={t('Notes for the workshop')}>
            <textarea rows={3} value={draft.notes} maxLength={2000} placeholder={t('Layer height, supports, deadline…')}
              onChange={(e) => onChange({ ...draft, notes: e.target.value })} />
          </Field>
        </section>

        <section className="project-dialog__section">
          <h3>{t('Contact and delivery')}</h3>
          <div className="checkout__grid">
            <CustomerFields customer={customer} onChange={(update) => onCustomerChange(update(customer))} />
          </div>
        </section>

        {error && (
          <div className="banner banner--error" role="alert">
            <strong>{error.message}</strong>
            {error.details.length > 0 && <ul>{error.details.map((d) => <li key={d}>{d}</li>)}</ul>}
          </div>
        )}
        <p className="muted">{t('No payment is taken now — we review every request and email you a quote.')}</p>
        <footer className="dialog__footer">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={submitting}>{t('Cancel')}</button>
          <button type="submit" className="btn btn--primary btn--large" disabled={submitting}>
            {submitting ? t('Sending…') : t('Send order request')}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
