import { t } from '../i18n';
import { useEffect, useId, useRef, useState, type DragEvent, type FormEvent, type RefObject } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '../api/client';
import { CustomerFields, customerForSubmission, ErrorBanner } from '../components/CustomerFields';
import { ModelPreviewDialog } from '../components/ModelPreviewDialog';
import { PrintOptionsEditor, PrintOptionsSummary } from '../components/PrintOptions';
import { CUSTOM_ORDER_MAX_FILES, MAX_QUANTITY, MODEL_MAX_UPLOAD_BYTES, PRINT_MAX_MM, RECOLOR_MAX_BYTES } from '../config';
import { useCustomPrint, type DraftModel } from '../store/CustomPrintContext';
import type { CustomerUpload, CustomOrder, PrintSettings } from '../types';
import type { CustomModelInfo } from '../utils/customModel';
import { formatBytes } from '../utils/format';
import { formatPrice } from '../utils/pricing';
import { chosenColors, estimateOptions, resolveOptions, type Estimate, type ModelOptions } from '../utils/printOptions';
import { formatDimensions, formatVolume } from '../utils/sizing';

type Step = 'files' | 'summary';

const totalCopies = (models: { quantity: number }[]) => models.reduce((sum, model) => sum + model.quantity, 0);
const exceedsBuildVolume = (info: CustomModelInfo) => Math.max(info.widthMm, info.depthMm, info.heightMm) > PRINT_MAX_MM;

/** The model's choices, valid for the shop's current offer; null until both the file and the offer are read. */
function choicesOf(model: DraftModel, settings: PrintSettings | null): { options: ModelOptions; estimate: Estimate } | null {
  if (!model.info || !settings) return null;
  const options = resolveOptions(model.info.parts, model.options, settings);
  return { options, estimate: estimateOptions(model.info.volumeCm3, model.info.parts, options, settings) };
}

/** Total estimated price of all copies of all models. */
function totals(models: DraftModel[], settings: PrintSettings | null) {
  let price = 0;
  for (const model of models) {
    const estimate = choicesOf(model, settings)?.estimate;
    if (estimate) price += estimate.unitPrice * model.quantity;
  }
  return { price: Math.round(price * 100) / 100 };
}

/**
 * Print request for the customer's own models: upload STL/3MF files, then review the summary,
 * add contact details and confirm. The shop reviews the files and quotes a price afterwards.
 */
export function CustomPrintPage() {
  const { models, reset, settings, loadSettings } = useCustomPrint();
  const [step, setStep] = useState<Step>('files');
  const [placed, setPlaced] = useState<CustomOrder | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  // The summary needs files; e.g. after starting over, show the first step.
  const current: Step = models.length === 0 ? 'files' : step;

  useEffect(() => {
    // Nozzles, layer heights, filaments and prices are loaded once per visit to the shop.
    if (settings.status !== 'ready') loadSettings();
    // Only on arriving at the page (not on every status change); a failed load offers its own retry.
  }, [loadSettings]);

  useEffect(() => {
    // Moving focus to the new step's heading also brings it into view.
    if (firstRender.current) firstRender.current = false;
    else headingRef.current?.focus();
  }, [current, placed]);

  if (placed) {
    return (
      <RequestConfirmation
        order={placed}
        headingRef={headingRef}
        onNew={() => {
          setPlaced(null);
          setStep('files');
        }}
      />
    );
  }

  return (
    <div className="custom-print">
      <div className="custom-print__intro">
        <h1>{t("Print your own model")}</h1>
        <p className="muted">
          {t("Send us your STL or 3MF files. We check every model and reply with a price before anything is printed — nothing is charged now.")}
        </p>
      </div>
      <ol className="steps" aria-label={t("Order steps")}>
        <li className={current === 'files' ? 'is-current' : 'is-done'} aria-current={current === 'files' ? 'step' : undefined}>
          <span className="steps__number" aria-hidden="true">1</span> {t("Upload files")}
        </li>
        <li className={current === 'summary' ? 'is-current' : ''} aria-current={current === 'summary' ? 'step' : undefined}>
          <span className="steps__number" aria-hidden="true">2</span> {t("Summary and confirmation")}
        </li>
      </ol>
      {current === 'files' ? (
        <FilesStep headingRef={headingRef} onContinue={() => setStep('summary')} />
      ) : (
        <SummaryStep
          headingRef={headingRef}
          onBack={() => setStep('files')}
          onPlaced={(order) => {
            setPlaced(order);
            reset();
          }}
        />
      )}
    </div>
  );
}

interface StepProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
}

function FilesStep({ headingRef, onContinue }: StepProps & { onContinue: () => void }) {
  const {
    models, rejected, reading, note, settings, loadSettings, addFiles, setOptions, setRecolored, setQuantity, removeModel, setNote,
  } = useCustomPrint();
  const offer = settings.status === 'ready' ? settings.settings : null;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const noteId = useId();
  const full = models.length >= CUSTOM_ORDER_MAX_FILES;

  const pick = (files: FileList | null | undefined) => {
    if (files && files.length > 0) void addFiles([...files]);
    if (inputRef.current) inputRef.current.value = '';
  };
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files);
  };

  return (
    <section className="card custom-print__step">
      <h2 ref={headingRef} tabIndex={-1}>{t("1. Upload your 3D models")}</h2>
      <div
        className={`dropzone custom-print__dropzone ${dragging ? 'is-dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-disabled={full || undefined}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <span>{t("Drop STL or 3MF files here or")} <u>{t("browse")}</u></span>
        <small>
          {t("Up to {value0} files, {value1} each. Slicer projects (3MF) are printed with all their plates.", {
            value0: CUSTOM_ORDER_MAX_FILES, value1: formatBytes(MODEL_MAX_UPLOAD_BYTES),
          })}
        </small>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".stl,.3mf,model/stl,model/3mf"
        multiple
        hidden
        data-testid="model-files"
        onChange={(e) => pick(e.target.files)}
      />

      {rejected.length > 0 && (
        <div className="banner banner--error" role="alert">
          <strong>{t("Some files were not added:")}</strong>
          <ul>
            {rejected.map((problem) => <li key={problem}>{problem}</li>)}
          </ul>
        </div>
      )}

      {settings.status === 'error' && (
        <div className="banner banner--error" role="alert">
          <strong>{t("The print options could not be loaded.")}</strong> {settings.message}{' '}
          <button type="button" className="btn btn--small" onClick={loadSettings}>{t("Try again")}</button>
        </div>
      )}

      {models.length > 0 && (
        <ul className="model-list" aria-label={t("Your models")}>
          {models.map((model) => (
            <ModelRow
              key={model.key}
              model={model}
              settings={offer}
              onOptions={(options) => setOptions(model.key, options)}
              onRecolored={(recolored) => setRecolored(model.key, recolored)}
              onQuantity={(quantity) => setQuantity(model.key, quantity)}
              onRemove={() => removeModel(model.key)}
            />
          ))}
        </ul>
      )}

      <div className="field custom-print__note">
        <label htmlFor={noteId}>{t("Printing instructions (optional)")}</label>
        <textarea id={noteId} rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)}
          placeholder={t("Material, color, infill, size… anything we should know.")} />
      </div>

      <div className="custom-print__actions">
        <span className="muted">
          {models.length === 0
            ? t("Add at least one model to continue.")
            : reading ? t("Reading your models…") : t("{value0} of {value1} files", { value0: models.length, value1: CUSTOM_ORDER_MAX_FILES })}
          {offer && !reading && models.length > 0 && (
            <> · {t("Estimated price ≈ {value0}", { value0: formatPrice(totals(models, offer).price) })}</>
          )}
        </span>
        <button type="button" className="btn btn--primary btn--large" disabled={models.length === 0 || reading || !offer} onClick={onContinue}>
          {t("Continue to summary")}
        </button>
      </div>
    </section>
  );
}

interface SummaryProps extends StepProps {
  onBack: () => void;
  onPlaced: (order: CustomOrder) => void;
}

function SummaryStep({ headingRef, onBack, onPlaced }: SummaryProps) {
  const { models, note, customer, settings, loadSettings, setCustomer, markUploaded, forgetUploads } = useCustomPrint();
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const busy = progress !== null;
  const copies = totalCopies(models);
  const offer = settings.status === 'ready' ? settings.settings : null;
  const total = totals(models, offer);

  /** Sends the files one at a time; files already accepted by the shop are reused unless `again`. */
  async function uploadFiles(again: boolean): Promise<CustomerUpload[]> {
    const uploads: CustomerUpload[] = [];
    for (const [index, model] of models.entries()) {
      if (model.upload && !again) {
        uploads.push(model.upload);
        continue;
      }
      setProgress(t("Uploading file {value0} of {value1}: {value2}…", { value0: index + 1, value1: models.length, value2: model.file.name }));
      try {
        const upload = await api.uploadCustomModel(model.file);
        markUploaded(model.key, upload);
        uploads.push(upload);
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        throw new ApiError(err.status, t("{value0} could not be uploaded: {value1}", { value0: model.file.name, value1: err.message }), err.details);
      }
    }
    return uploads;
  }

  async function send(uploads: CustomerUpload[]) {
    setProgress(t("Sending your request…"));
    return api.createCustomOrder({
      customer: customerForSubmission(customer),
      files: uploads.map(({ fileId, uploadKey }, index) => {
        const model = models[index];
        const { options } = choicesOf(model, offer)!;
        return {
          fileId, uploadKey, quantity: model.quantity, nozzleId: options.nozzleId, layerHeightId: options.layerHeightId,
          parts: model.info!.parts.map((part) => ({ key: part.key, name: part.name, ...options.parts[part.key] })),
        };
      }),
      customerNote: note.trim() || undefined,
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      let order: CustomOrder;
      try {
        order = await send(await uploadFiles(false));
      } catch (err) {
        // 409: an earlier upload expired or was already used; send the files once more.
        if (!(err instanceof ApiError && err.status === 409)) throw err;
        forgetUploads();
        order = await send(await uploadFiles(true));
      }
      onPlaced(order);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, t("Could not send the print request.")));
      setProgress(null);
      // E.g. an option the shop withdrew meanwhile: show the current offer, where such choices fall back to defaults.
      if (err instanceof ApiError && err.status === 400) loadSettings();
    }
  }

  return (
    <>
      <section className="card custom-print__step">
        <div className="card__header">
          <h2 ref={headingRef} tabIndex={-1}>{t("2. Summary")}</h2>
          <button type="button" className="btn btn--small btn--ghost" onClick={onBack} disabled={busy}>{t("Change files")}</button>
        </div>
        <ul className="model-list" aria-label={t("Your models")}>
          {models.map((model) => <ModelRow key={model.key} model={model} settings={offer} />)}
        </ul>
        <dl className="custom-print__summary">
          <dt>{t("Files")}</dt>
          <dd>{models.length}</dd>
          <dt>{t("Prints in total")}</dt>
          <dd>{copies}</dd>
          <dt>{t("Printing instructions")}</dt>
          <dd className="custom-print__instructions">{note.trim() || t("None")}</dd>
          <dt>{t("Estimated price")}</dt>
          <dd>
            <strong>≈ {formatPrice(total.price)}</strong>
            <small className="custom-print__price-note">
              {t("Estimated from your models and the chosen print options. The shop confirms the final price after reviewing your files.")}
            </small>
          </dd>
        </dl>
      </section>

      <form className="card checkout custom-print__step" onSubmit={(e) => void handleSubmit(e)}>
        <h2>{t("Contact and delivery")}</h2>
        <fieldset className="plain-fieldset" disabled={busy}>
          <div className="checkout__grid">
            <CustomerFields customer={customer} onChange={setCustomer} />
          </div>
        </fieldset>

        {error && <ErrorBanner message={error.message} details={error.details} />}
        {progress && <p className="banner banner--info" role="status">{progress}</p>}

        <p className="muted">
          {t("Nothing is charged now. After you confirm, the shop reviews your files and contacts you with a price before printing.")}
        </p>
        <div className="checkout__actions">
          <button type="button" className="btn btn--ghost" onClick={onBack} disabled={busy}>{t("Back")}</button>
          <button type="submit" className="btn btn--primary btn--large" disabled={busy || !offer}>
            {busy ? t("Sending…") : t("Confirm order")}
          </button>
        </div>
      </form>
    </>
  );
}

interface RowProps {
  model: DraftModel;
  /** The shop's offer; null while it loads. */
  settings: PrintSettings | null;
  /** Editable rows (first step) have print options, quantity and remove controls; summary rows are read-only. */
  onOptions?: (options: ModelOptions) => void;
  /** Receives the miniature redrawn in the chosen colors (editable rows redraw it). */
  onRecolored?: (recolored: { colors: string; image: string }) => void;
  onQuantity?: (quantity: number) => void;
  onRemove?: () => void;
}

/** Waits for the customer to settle on colors before reading the file again. */
const RECOLOR_DELAY_MS = 400;

/**
 * Redraws the miniature in the chosen filament colors after they change, reading the file again;
 * large files keep the first miniature. Only rows that report the result (the first step) redraw.
 */
function useRecoloredThumbnail(model: DraftModel, colors: string | null, onRecolored?: RowProps['onRecolored']) {
  const { file, info } = model;
  const current = model.recolored?.colors;
  useEffect(() => {
    if (!onRecolored || !info || !colors || colors === current || file.size > RECOLOR_MAX_BYTES) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void import('../utils/customModel')
        .then(({ coloredThumbnail }) => coloredThumbnail(file, info, JSON.parse(colors)))
        .then((image) => {
          if (!cancelled && image) onRecolored({ colors, image });
        })
        .catch((err: unknown) => console.warn('Could not redraw the model in the chosen colors', err));
    }, RECOLOR_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `onRecolored` is recreated on every render; the colors decide when to redraw.
  }, [colors, current, file, info]);
}

function ModelRow({ model, settings, onOptions, onRecolored, onQuantity, onRemove }: RowProps) {
  const { file, info, quantity } = model;
  const [previewing, setPreviewing] = useState(false);
  const choices = choicesOf(model, settings);
  const colors = info && choices && settings ? JSON.stringify(chosenColors(info.parts, choices.options, settings)) : null;
  useRecoloredThumbnail(model, colors, onRecolored);
  const thumbnail = model.recolored?.image ?? info?.thumbnail;
  const editable = onOptions && onQuantity && onRemove;
  const format = (info?.format ?? (/\.3mf$/i.test(file.name) ? '3mf' : 'stl')).toUpperCase();
  return (
    <li className="model-row">
      {/* The miniature and description open the 3D preview once the model has been read. */}
      <button
        type="button"
        className="model-row__open"
        disabled={!info}
        aria-label={t("Preview {value0} in 3D", { value0: file.name })}
        title={info ? t("Preview in 3D") : undefined}
        onClick={() => setPreviewing(true)}
      >
        <span className="model-row__thumb">
          {thumbnail ? <img src={thumbnail} alt="" /> : <span className="model-row__badge">{format}</span>}
          {info && <span className="model-row__hint" aria-hidden="true">3D</span>}
        </span>
        <span className="model-row__info">
          <strong className="model-row__name">{file.name}</strong>
          <span className="muted">{format} · {formatBytes(file.size)}</span>
          {info ? (
            <span className="muted">
              {formatDimensions(info)} · {formatVolume(info.volumeCm3)}
              {info.plateCount > 1 && <> · {t("{count} plates", { count: info.plateCount })}</>}
            </span>
          ) : (
            <span className="muted" role="status">{t("Reading model…")}</span>
          )}
          {info && exceedsBuildVolume(info) && (
            <span className="model-row__warning">
              {t("Larger than our {value0} mm build volume — we'll suggest scaling or splitting it.", { value0: PRINT_MAX_MM })}
            </span>
          )}
        </span>
      </button>
      {previewing && info && (
        <ModelPreviewDialog
          file={file}
          info={info}
          quantity={quantity}
          settings={settings}
          options={choices?.options ?? null}
          estimate={choices?.estimate ?? null}
          onClose={() => setPreviewing(false)}
        />
      )}
      {editable ? (
        <div className="model-row__controls">
          <label className="model-row__quantity">
            <span>{t("Copies")}</span>
            <input
              type="number"
              min={1}
              max={MAX_QUANTITY}
              value={quantity}
              aria-label={t("Copies of {value0}", { value0: file.name })}
              onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onQuantity(e.target.valueAsNumber)}
            />
          </label>
          <button type="button" className="btn btn--ghost btn--danger btn--small" onClick={onRemove}
            aria-label={t("Remove {value0}", { value0: file.name })}>
            {t("Remove")}
          </button>
        </div>
      ) : (
        <div className="model-row__copies">{t("{count} copies", { count: quantity })}</div>
      )}
      {info && choices && settings && (
        <div className="model-row__options">
          {editable ? (
            <PrintOptionsEditor
              fileName={file.name}
              parts={info.parts}
              options={choices.options}
              settings={settings}
              onChange={onOptions}
            />
          ) : (
            <PrintOptionsSummary parts={info.parts} options={choices.options} settings={settings} />
          )}
          <p className="model-row__estimate">
            {t("Estimated price ≈ {value0} each", { value0: formatPrice(choices.estimate.unitPrice) })}
            {quantity > 1 && <strong> · {t("≈ {value0} for {count} copies", {
              value0: formatPrice(Math.round(choices.estimate.unitPrice * quantity * 100) / 100), count: quantity,
            })}</strong>}
          </p>
        </div>
      )}
    </li>
  );
}

function RequestConfirmation({ order, headingRef, onNew }: StepProps & { order: CustomOrder; onNew: () => void }) {
  return (
    <div className="card order-confirmation" role="status">
      <h1 ref={headingRef} tabIndex={-1}>{t("Thank you — we received your print request!")}</h1>
      <p>
        {t("Your request number is")} <strong className="mono">{order.number}</strong>{t(". Keep it for any questions about your order.")}
      </p>
      <p>
        {t("{count} files", { count: order.files.length })} · {t("{count} prints in total", { count: totalCopies(order.files) })}
      </p>
      <p className="muted">
        {t("We'll review your models and contact you at {value0} with a price before anything is printed.", { value0: order.customer.email })}
      </p>
      <div className="order-confirmation__actions">
        <button type="button" className="btn" onClick={onNew}>{t("Send another model")}</button>
        <Link to="/" className="btn btn--primary">{t("Continue shopping")}</Link>
      </div>
    </div>
  );
}
