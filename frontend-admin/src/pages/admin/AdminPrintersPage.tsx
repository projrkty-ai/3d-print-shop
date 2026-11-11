import { formatCount, formatNumber, t } from '../../i18n';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '../../api/client';
import { LoadState } from '../../components/LoadState';
import type { Printer, PrinterInput, PrinterModelWithPrinters } from '../../types';
import { PRINTER_LIMITS, validatePrinter } from '../../utils/printers';
import { formatDimensions } from '../../utils/sizing';
import { Field } from './formFields';
import { formatDateTime } from './orderDisplay';
import { downloadProfiles, modelLabel, PrintersNav, ProfilesCell, presetSummary } from './printerDisplay';
import { useAdminData } from './useAdminData';

interface Warehouse {
  printers: Printer[];
  models: PrinterModelWithPrinters[];
}

type Banner = { kind: 'success' | 'error'; text: string; details?: string[] };

const modelPath = (id: string) => `/admin/printer-models/${encodeURIComponent(id)}`;
const queuePath = (id: string) => `/admin/printers/${encodeURIComponent(id)}`;

/**
 * The printers warehouse: every printer in the workshop with its unique name, model and place. Plate
 * size, colors and slicer profiles come from the printer's model and are edited there.
 */
export function AdminPrintersPage() {
  const { state, setData, reload } = useAdminData<Warehouse>(
    async () => {
      const [printers, models] = await Promise.all([api.listPrinters(), api.listPrinterModels()]);
      return { printers, models };
    },
    [],
  );
  /** `null`: the list; `'new'`: adding; otherwise the printer being edited. */
  const [editing, setEditing] = useState<Printer | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);

  if (state.status !== 'ready') {
    return (
      <div className="admin">
        <PrintersNav />
        <h1>{t("Printers")}</h1>
        <LoadState load={state} onRetry={reload} loadingText={t("Loading printers…")} />
      </div>
    );
  }
  const { printers, models } = state.data;

  function saved(printer: Printer, text: string) {
    const sorted = [...printers.filter((p) => p.id !== printer.id), printer].sort((a, b) => a.name.localeCompare(b.name));
    // The models list their printers: keep that in step without another request.
    const withPrinter = models.map((model) => {
      const others = model.printers.filter((p) => p.id !== printer.id);
      const printersOfModel = model.id === printer.modelId ? [...others, { id: printer.id, name: printer.name }].sort((a, b) => a.name.localeCompare(b.name)) : others;
      return { ...model, printers: printersOfModel };
    });
    setData({ printers: sorted, models: withPrinter });
    setEditing(null);
    setBanner({ kind: 'success', text });
  }

  async function remove(printer: Printer) {
    if (!window.confirm(t("Delete printer \"{0}\"? This cannot be undone.", printer.name))) return;
    setBusyId(printer.id);
    setBanner(null);
    try {
      await api.deletePrinter(printer.id);
      setData({
        printers: printers.filter((p) => p.id !== printer.id),
        models: models.map((model) => ({ ...model, printers: model.printers.filter((p) => p.id !== printer.id) })),
      });
      if (editing !== 'new' && editing?.id === printer.id) setEditing(null);
      setBanner({ kind: 'success', text: t("Deleted printer \"{0}\".", printer.name) });
    } catch (err) {
      setBanner(err instanceof ApiError
        ? { kind: 'error', text: `${printer.name}: ${err.message}`, details: err.details }
        : { kind: 'error', text: `${printer.name}: ${t("Something went wrong.")}` });
    } finally {
      setBusyId(null);
    }
  }

  async function download(printer: Printer) {
    if (!printer.model) return;
    const error = await downloadProfiles(printer.model);
    if (error) setBanner({ kind: 'error', text: error });
  }

  return (
    <div className="admin printers">
      <PrintersNav />
      <div className="admin__header">
        <div>
          <h1>{t("Printers")}</h1>
          <p className="muted">{t("The printers in your workshop: their unique names, models and where each one stands. Print plate size, colors and slicer profiles belong to the printer model and apply to all its printers.")}</p>
        </div>
        <div className="admin__header-actions">
          <button type="button" className="btn btn--ghost" onClick={reload}>{t("Refresh")}</button>
          <button type="button" className="btn btn--primary" disabled={editing === 'new' || models.length === 0}
            onClick={() => { setBanner(null); setEditing('new'); }}>
            {t("Add printer")}
          </button>
        </div>
      </div>

      {banner && (
        <div className={`banner banner--${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}>
          {banner.details?.length ? <strong>{banner.text}</strong> : banner.text}
          {banner.details && banner.details.length > 0 && <ul>{banner.details.map((d) => <li key={d}>{d}</li>)}</ul>}
        </div>
      )}
      {models.length === 0 && (
        <p className="banner banner--info">
          {t("Printers need a model first: it holds the print plate size, colors and profiles.")}{' '}
          <Link to="/admin/printer-models/new">{t("Add a printer model")}</Link>
        </p>
      )}

      {editing && (
        <PrinterEditor
          key={editing === 'new' ? 'new' : editing.id}
          printer={editing === 'new' ? null : editing}
          models={models}
          others={printers.filter((p) => editing === 'new' || p.id !== editing.id)}
          onSaved={saved}
          onCancel={() => setEditing(null)}
        />
      )}

      <p className="muted printers__count">{formatCount('printer', printers.length)}</p>
      <div className="table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t("Name")}</th>
              <th>{t("Model")}</th>
              <th>{t("Print plate (W × D × H)")}</th>
              <th>{t("Max colors")}</th>
              <th>{t("Location")}</th>
              <th>{t("Profiles")}</th>
              <th>{t("Queue")}</th>
              <th aria-label={t("Actions")} />
            </tr>
          </thead>
          <tbody>
            {printers.map((printer) => (
              <tr key={printer.id}>
                <td>
                  <Link to={queuePath(printer.id)} className="admin-table__name">{printer.name}</Link>
                  {printer.notes && <div className="muted printers__notes">{printer.notes}</div>}
                </td>
                <td>{printer.model ? <Link to={modelPath(printer.model.id)}>{printer.model.name}</Link> : <span className="muted">{t("Missing model")}</span>}</td>
                <td>{printer.model ? formatDimensions(printer.model.plate) : '—'}</td>
                <td>{printer.model ? formatNumber(printer.model.maxColors) : '—'}</td>
                <td>{printer.location || <span className="muted">{t("Not set")}</span>}</td>
                <td>{printer.model ? <ProfilesCell model={printer.model} onDownload={() => void download(printer)} /> : '—'}</td>
                <td>
                  <Link to={queuePath(printer.id)}>{printer.queue.length === 0 ? t("Empty") : formatCount('order', printer.queue.length)}</Link>
                  {printer.queue.length > 0 && <div className="muted">{t("next start {0}", formatDateTime(printer.queue.nextStart))}</div>}
                </td>
                <td>
                  <div className="admin-table__actions">
                    <button type="button" className="btn btn--small" disabled={busyId === printer.id}
                      onClick={() => { setBanner(null); setEditing(printer); }}>{t("Edit")}</button>
                    <button type="button" className="btn btn--small btn--ghost btn--danger" disabled={busyId === printer.id}
                      onClick={() => void remove(printer)}>{t("Delete")}</button>
                  </div>
                </td>
              </tr>
            ))}
            {printers.length === 0 && (
              <tr>
                <td colSpan={8} className="muted admin-table__empty">{t("No printers yet. Add the printers that stand in your workshop.")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface EditorProps {
  /** Null when adding a printer. */
  printer: Printer | null;
  models: PrinterModelWithPrinters[];
  /** The other printers, whose names this one may not repeat. */
  others: Printer[];
  onSaved: (printer: Printer, message: string) => void;
  onCancel: () => void;
}

function PrinterEditor({ printer, models, others, onSaved, onCancel }: EditorProps) {
  const [draft, setDraft] = useState<PrinterInput>(() => printer
    ? { name: printer.name, modelId: printer.modelId, location: printer.location, notes: printer.notes }
    : { name: '', modelId: models.length === 1 ? models[0].id : '', location: '', notes: '' });
  const [showProblems, setShowProblems] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Banner | null>(null);

  const problems = validatePrinter(draft, others);
  const model = models.find((m) => m.id === draft.modelId);
  const update = (patch: Partial<PrinterInput>) => setDraft((d) => ({ ...d, ...patch }));

  async function save(event: FormEvent) {
    event.preventDefault();
    setShowProblems(true);
    if (problems.length > 0) return;
    setBusy(true);
    setError(null);
    const input: PrinterInput = { ...draft, name: draft.name.trim(), location: draft.location.trim(), notes: draft.notes.trim() };
    try {
      const saved = printer ? await api.updatePrinter(printer.id, input) : await api.createPrinter(input);
      onSaved(saved, printer ? t("Saved printer \"{0}\".", saved.name) : t("Added printer \"{0}\".", saved.name));
    } catch (err) {
      setError(err instanceof ApiError ? { kind: 'error', text: err.message, details: err.details } : { kind: 'error', text: t("Could not save the printer.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card printer-editor" onSubmit={(e) => void save(e)} aria-label={printer ? t("Edit printer") : t("Add printer")}>
      <div className="card__header">
        <h2>{printer ? t("Edit printer: {0}", printer.name) : t("Add printer")}</h2>
      </div>
      {error && (
        <div className="banner banner--error" role="alert">
          {error.details?.length ? <strong>{error.text}</strong> : error.text}
          {error.details && error.details.length > 0 && <ul>{error.details.map((d) => <li key={d}>{d}</li>)}</ul>}
        </div>
      )}
      <div className="printer-editor__grid">
        <Field label={t("Unique name")} hint={t("Identifies this machine in the workshop, e.g. U1-01.")}>
          <input value={draft.name} maxLength={PRINTER_LIMITS.name} required autoFocus disabled={busy} onChange={(e) => update({ name: e.target.value })} />
        </Field>
        <Field label={t("Model")}>
          <select value={draft.modelId} disabled={busy} onChange={(e) => update({ modelId: e.target.value })} aria-label={t("Printer model")}>
            <option value="">{t("Choose a model…")}</option>
            {models.map((m) => <option key={m.id} value={m.id}>{modelLabel(m)}</option>)}
          </select>
        </Field>
      </div>
      {model && (
        <div className="printer-editor__model" data-testid="model-facts">
          <dl>
            <div><dt>{t("Print plate size")}</dt><dd>{formatDimensions(model.plate)}</dd></div>
            <div><dt>{t("Max colors")}</dt><dd>{formatNumber(model.maxColors)}</dd></div>
            <div><dt>{t("Profiles")}</dt><dd>{model.profiles ? `${model.profiles.fileName} (${presetSummary(model.profiles)})` : t("None")}</dd></div>
          </dl>
          <p className="muted">
            {t("These come from the model and apply to all its printers.")}{' '}
            <Link to={modelPath(model.id)}>{t("Edit model “{0}”", model.name)}</Link>
          </p>
        </div>
      )}
      <div className="printer-editor__grid">
        <Field label={t("Location")} hint={t("Where the printer stands, e.g. Room 2, rack B, shelf 3.")}>
          <input value={draft.location} maxLength={PRINTER_LIMITS.location} disabled={busy} onChange={(e) => update({ location: e.target.value })} />
        </Field>
      </div>
      <Field label={t("Notes")}>
        <textarea rows={2} value={draft.notes} maxLength={PRINTER_LIMITS.notes} disabled={busy} onChange={(e) => update({ notes: e.target.value })} />
      </Field>

      {showProblems && problems.length > 0 && (
        <ul className="printer-editor__problems" role="alert">
          {problems.map((problem) => <li key={problem}>{problem}</li>)}
        </ul>
      )}
      <div className="printer-editor__actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? t("Saving…") : printer ? t("Save printer") : t("Add printer")}
        </button>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={onCancel}>{t("Cancel")}</button>
        <Link to="/admin/printer-models" className="printer-editor__manage">{t("Manage printer models")}</Link>
      </div>
    </form>
  );
}
