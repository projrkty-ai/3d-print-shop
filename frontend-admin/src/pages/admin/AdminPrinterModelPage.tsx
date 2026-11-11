import { formatCount, t } from '../../i18n';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../../api/client';
import { LoadState } from '../../components/LoadState';
import type { PrinterModelInput, PrinterModelTemplate, PrinterModelWithPrinters } from '../../types';
import {
  emptyPlate, isZipFile, PRINTER_LIMITS, PRINTER_PROFILES_ACCEPT, PRINTER_PROFILES_MAX_UPLOAD_BYTES, validatePrinterModel,
} from '../../utils/printers';
import { Field, NumberInput } from './formFields';
import { modelPath } from './AdminPrinterModelsPage';
import { formatBytes, formatDateTime } from './orderDisplay';
import { downloadProfiles, modelLabel, PrintersNav, presetSummary, ProfileContents } from './printerDisplay';
import { useAdminData } from './useAdminData';

type Banner = { kind: 'success' | 'error'; text: string; details?: string[] };

interface Loaded {
  /** Every model: the edited one and the names the edited one may not repeat. */
  models: PrinterModelWithPrinters[];
  /** Known printers to start a new model from (only loaded for new models). */
  templates: PrinterModelTemplate[];
}

/** Adds a printer model, or edits one for all its printers: name, manufacturer, plate size, colors and profiles. */
export function AdminPrinterModelPage() {
  const { modelId } = useParams();
  const { state, reload } = useAdminData<Loaded>(
    async () => {
      const [models, templates] = await Promise.all([api.listPrinterModels(), modelId ? Promise.resolve([]) : api.listPrinterModelTemplates()]);
      return { models, templates };
    },
    [modelId],
  );
  const title = modelId ? t("Edit printer model") : t("Add printer model");
  if (state.status !== 'ready') {
    return (
      <div className="admin">
        <PrintersNav />
        <h1>{title}</h1>
        <LoadState load={state} onRetry={reload} loadingText={t("Loading printer models…")} />
      </div>
    );
  }
  const model = modelId ? state.data.models.find((m) => m.id === modelId) : undefined;
  if (modelId && !model) {
    return (
      <div className="admin">
        <PrintersNav />
        <div className="empty-state" role="alert">
          <h1>{t("Printer model not found")}</h1>
          <p>{t("It may have been deleted.")}</p>
          <Link to="/admin/printer-models" className="btn btn--primary">{t("All printer models")}</Link>
        </div>
      </div>
    );
  }
  return (
    <PrinterModelEditor
      key={modelId ?? 'new'}
      model={model ?? null}
      others={state.data.models.filter((m) => m.id !== modelId)}
      templates={state.data.templates}
    />
  );
}

interface EditorProps {
  /** Null when adding a model. */
  model: PrinterModelWithPrinters | null;
  others: PrinterModelWithPrinters[];
  templates: PrinterModelTemplate[];
}

const toInput = (model: PrinterModelInput): PrinterModelInput =>
  ({ name: model.name, manufacturer: model.manufacturer, plate: { ...model.plate }, maxColors: model.maxColors });

function PrinterModelEditor({ model, others, templates }: EditorProps) {
  const navigate = useNavigate();
  const location = useLocation();
  /** The model as last saved (updated after each save without leaving the page). */
  const [saved, setSaved] = useState(model);
  const [draft, setDraft] = useState<PrinterModelInput>(() => model
    ? toInput(model)
    : { name: '', manufacturer: '', plate: emptyPlate(), maxColors: 1 });
  const [template, setTemplate] = useState('');
  /** A chosen archive is uploaded when the model is saved (a new model must exist first). */
  const [profileFile, setProfileFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [fileError, setFileError] = useState<string | null>(null);
  const [removeProfiles, setRemoveProfiles] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  const [busy, setBusy] = useState(false);
  // A message carried over from creating this model (the page opens its edit address then).
  const [banner, setBanner] = useState<Banner | null>((location.state as { banner?: Banner } | null)?.banner ?? null);

  const problems = validatePrinterModel(draft, others);
  const printers = saved?.printers ?? [];
  const update = (patch: Partial<PrinterModelInput>) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = !saved || JSON.stringify(toInput(saved)) !== JSON.stringify(draft) || profileFile !== null || removeProfiles;

  function chooseTemplate(name: string) {
    setTemplate(name);
    const known = templates.find((candidate) => candidate.name === name);
    if (known) setDraft(toInput(known));
  }

  function chooseFile(file: File | null) {
    setFileError(null);
    setProfileFile(null);
    if (!file) return;
    if (!isZipFile(file)) {
      setFileError(t("Choose a ZIP archive with the printer's profiles (.zip or .orca_printer)."));
      return;
    }
    if (file.size > PRINTER_PROFILES_MAX_UPLOAD_BYTES) {
      setFileError(t("The profiles archive can be at most {0} MB.", PRINTER_PROFILES_MAX_UPLOAD_BYTES / 1024 / 1024));
      return;
    }
    setProfileFile(file);
    setRemoveProfiles(false);
  }

  /** After saving: a new model opens its edit address; an existing one stays, with its new values. */
  function done(result: PrinterModelWithPrinters, message: Banner) {
    if (!saved) {
      navigate(modelPath(result.id), { replace: true, state: { banner: message } });
      return;
    }
    setSaved(result);
    setDraft(toInput(result));
    setProfileFile(null);
    setRemoveProfiles(false);
    setFileInputKey((k) => k + 1);
    setShowProblems(false);
    setBanner(message);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setShowProblems(true);
    if (problems.length > 0 || fileError) return;
    setBusy(true);
    setBanner(null);
    const input: PrinterModelInput = { ...draft, name: draft.name.trim(), manufacturer: draft.manufacturer.trim() };
    let result: PrinterModelWithPrinters | null = null;
    try {
      result = saved ? await api.updatePrinterModel(saved.id, input) : await api.createPrinterModel(input);
      if (profileFile) result = await api.uploadPrinterModelProfiles(result.id, profileFile);
      else if (removeProfiles && result.profiles) result = await api.removePrinterModelProfiles(result.id);
      done(result, {
        kind: 'success',
        text: saved
          ? (result.printers.length > 0 ? t("Saved printer model \"{0}\" for {1}.", result.name, formatCount('printer', result.printers.length)) : t("Saved printer model \"{0}\".", result.name))
          : t("Added printer model \"{0}\".", result.name),
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("Could not save the printer model.");
      const details = err instanceof ApiError ? err.details : [];
      // The model itself was saved: show it as saved and say what is missing.
      if (result) done(result, { kind: 'error', text: t("The printer model was saved, but its profiles could not be updated: {0}", message), details });
      else setBanner({ kind: 'error', text: message, details });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!saved || !window.confirm(t("Delete printer model \"{0}\"? Its uploaded profiles are deleted too. This cannot be undone.", saved.name))) return;
    setBusy(true);
    setBanner(null);
    try {
      await api.deletePrinterModel(saved.id);
      navigate('/admin/printer-models', { state: { banner: { kind: 'success', text: t("Deleted printer model \"{0}\".", saved.name) } } });
    } catch (err) {
      setBanner({ kind: 'error', text: err instanceof ApiError ? err.message : t("Something went wrong.") });
      setBusy(false);
    }
  }

  async function download() {
    if (!saved) return;
    const error = await downloadProfiles(saved);
    if (error) setBanner({ kind: 'error', text: error });
  }

  const currentProfiles = saved?.profiles && !removeProfiles ? saved.profiles : null;
  const mm = (axis: keyof PrinterModelInput['plate'], label: string) => (
    <Field label={label}>
      <span className="input-unit">
        <NumberInput value={draft.plate[axis]} min={PRINTER_LIMITS.plateMm.min} max={PRINTER_LIMITS.plateMm.max} step="0.01" required
          onChange={(value) => update({ plate: { ...draft.plate, [axis]: value } })} disabled={busy} />
        <span className="muted">mm</span>
      </span>
    </Field>
  );

  return (
    <div className="admin printers printer-model-page">
      <PrintersNav />
      <Link to="/admin/printer-models" className="muted">{t("← All printer models")}</Link>
      <form onSubmit={(e) => void save(e)} aria-label={saved ? t("Edit printer model") : t("Add printer model")}>
        <div className="admin__header">
          <div>
            <h1>{saved ? t("Edit printer model: {0}", saved.name) : t("Add printer model")}</h1>
            <p className="muted">
              {saved && printers.length > 0
                ? t("Changes apply to all {0} of this model.", formatCount('printer', printers.length))
                : t("The print plate size, colors and profiles of a model apply to every printer of it.")}
            </p>
          </div>
          <div className="admin__header-actions">
            {saved && (
              <button type="button" className="btn btn--ghost btn--danger" disabled={busy || printers.length > 0}
                title={printers.length > 0 ? t("Printers use this model. Delete them or give them another model first.") : undefined}
                onClick={() => void remove()}>{t("Delete model")}</button>
            )}
            <button type="submit" className="btn btn--primary" disabled={busy || !dirty}>
              {busy ? t("Saving…") : saved ? t("Save model") : t("Add printer model")}
            </button>
          </div>
        </div>

        {banner && (
          <div className={`banner banner--${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}>
            {banner.details?.length ? <strong>{banner.text}</strong> : banner.text}
            {banner.details && banner.details.length > 0 && <ul>{banner.details.map((d) => <li key={d}>{d}</li>)}</ul>}
          </div>
        )}

        {showProblems && problems.length > 0 && (
          <ul className="printer-editor__problems" role="alert">
            {problems.map((problem) => <li key={problem}>{problem}</li>)}
          </ul>
        )}

        <section className="card printer-editor">
          <h2>{t("Model")}</h2>
          {!saved && templates.length > 0 && (
            <Field label={t("Start from a known printer")} hint={t("Fills in the name, manufacturer, print plate size and colors; you can change them.")}>
              <select value={template} disabled={busy} onChange={(e) => chooseTemplate(e.target.value)}>
                <option value="">{t("Enter the values myself")}</option>
                {templates.map((known) => <option key={known.name} value={known.name}>{modelLabel(known)}</option>)}
              </select>
            </Field>
          )}
          <div className="printer-editor__grid">
            <Field label={t("Model name")} hint={t("Unique, e.g. Snapmaker U1.")}>
              <input value={draft.name} maxLength={PRINTER_LIMITS.model} required autoFocus disabled={busy} onChange={(e) => update({ name: e.target.value })} />
            </Field>
            <Field label={t("Manufacturer")}>
              <input value={draft.manufacturer} maxLength={PRINTER_LIMITS.manufacturer} disabled={busy} onChange={(e) => update({ manufacturer: e.target.value })} />
            </Field>
          </div>
          <fieldset className="printer-editor__plate">
            <legend>{t("Print plate size")}</legend>
            <div className="printer-editor__grid">
              {mm('widthMm', t("Width (X)"))}
              {mm('depthMm', t("Depth (Y)"))}
              {mm('heightMm', t("Max height (Z)"))}
            </div>
          </fieldset>
          <div className="printer-editor__grid">
            <Field label={t("Max colors")} hint={t("Filaments one print job can use, e.g. with a multi-material unit.")}>
              <NumberInput value={draft.maxColors} min={1} max={PRINTER_LIMITS.maxColors} step={1} required disabled={busy} onChange={(maxColors) => update({ maxColors })} />
            </Field>
          </div>
        </section>

        <section className="card printer-editor__profiles" aria-label={t("Printer profiles")}>
          <h2>{t("Printer profiles")}</h2>
          <p className="muted">{t("One ZIP archive of slicer profiles for this model, shared by all its printers.")}</p>
          {currentProfiles && !profileFile && (
            <div className="printer-editor__current">
              <div>
                <strong>{currentProfiles.fileName}</strong>
                <span className="muted"> · {formatBytes(currentProfiles.sizeBytes)} · {t("uploaded {0}", formatDateTime(currentProfiles.uploadedAt))}</span>
                <div className="muted">{presetSummary(currentProfiles)}</div>
                <ProfileContents profiles={currentProfiles} />
              </div>
              <div className="admin-table__actions">
                <button type="button" className="btn btn--small" disabled={busy} onClick={() => void download()}>{t("Download")}</button>
                <button type="button" className="btn btn--small btn--ghost btn--danger" disabled={busy} onClick={() => setRemoveProfiles(true)}>{t("Remove")}</button>
              </div>
            </div>
          )}
          {removeProfiles && saved?.profiles && !profileFile && (
            <p className="muted">
              {t("The profiles will be removed when you save.")}{' '}
              <button type="button" className="link-button" onClick={() => setRemoveProfiles(false)}>{t("Keep them")}</button>
            </p>
          )}
          <label className="field">
            <span>{currentProfiles ? t("Replace with another ZIP archive") : t("Upload a ZIP archive (e.g. an OrcaSlicer printer export)")}</span>
            <input key={fileInputKey} type="file" accept={PRINTER_PROFILES_ACCEPT} disabled={busy} onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} />
            {profileFile && <small className="field__help">{t("{0} ({1}) will be uploaded when you save.", profileFile.name, formatBytes(profileFile.size))}</small>}
            {fileError && <small className="field__help is-error" role="alert">{fileError}</small>}
          </label>
        </section>

        {saved && (
          <section className="card" aria-label={t("Printers of this model")}>
            <h2>{t("Printers of this model")}</h2>
            {printers.length > 0
              ? <ul className="printer-model-page__printers">{printers.map((p) => <li key={p.id}>{p.name}</li>)}</ul>
              : <p className="muted">{t("No printers of this model yet.")}</p>}
            <Link to="/admin/printers">{t("Manage printers")}</Link>
          </section>
        )}

      </form>
    </div>
  );
}
