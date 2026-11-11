import { formatNumber, t } from '../../i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, loadModelBuffer } from '../../api/client';
import { createSlicerClient, SliceCancelledError, type SlicerClient } from '../../slicer/client';
import { useProducts } from '../../store/ProductsContext';
import {
  PRINT_MATERIALS, type CatalogModel, type FilamentChoice, type ItemModel, type MeasurementsInput, type Order, type OrderItem, type PricingSettings,
  type PrintVariantSummary, type ProjectFile, type ProjectProduct, type SlicerPresets,
} from '../../types';
import { measurementsByMaterial, measurementsByParts, sliceRuns, type SlicedCopy, type SliceRun } from '../../utils/customSlicing';
import { copyPrice, filamentSlots, measuredByParts, type FilamentSlot } from '../../utils/orderPricing';
import type { ModelPart, UploadFile } from '../../utils/printEstimate';
import { readFileBytes } from '../../utils/files';
import { formatPrice } from '../../utils/pricing';
import { formatDuration } from '../../utils/projectPricing';
import { presetMaterial, slicerCatalog } from '../../utils/printVariantMatrix';
import { formatDateTime, SOURCE_LABELS } from './orderDisplay';
import { durationUnits } from './PricingBreakdown';
import type { CustomerModel } from './useCustomerModels';
import type { ProjectFiles } from './useProjectFiles';

type Sliced = MeasurementsInput & { slicedAt: string };

interface Props {
  order: Order;
  /** The shop's current rates (for previews); null while loading. */
  pricing: PricingSettings | null;
  /** The shop's reading of uploaded files and their object URLs (uploads only). */
  modelOf: (file: Pick<UploadFile, 'fileId'>) => CustomerModel;
  fileUrl: (file: Pick<UploadFile, 'fileId'>) => Promise<string>;
  /** The shop's copies of the order's external project files (project and Print on Demand orders). */
  projectFiles: ProjectFiles;
  /** The ordered Print on Demand product (its print file); undefined while loading. */
  product?: ProjectProduct | null;
  onSaved: (order: Order) => void;
  /** Injectable for tests; defaults to the slicing Web Worker. */
  createClient?: () => SlicerClient;
}

const minutesText = (minutes: number) => formatDuration(Math.round(minutes), durationUnits());
const gramsText = (grams: number) => `${formatNumber(grams, { maximumFractionDigits: 2 })} g`;

/**
 * The shop's measurements of every item — print time and filament of one copy, sliced or entered by
 * hand — the same for every order. Only how an item is sliced depends on where its model comes
 * from. The saved measurements price the order with the current rates; orders that need a quote
 * use that price, fixed-price orders only plan with it.
 */
export function OrderMeasurements({ order, pricing, modelOf, fileUrl, projectFiles, product, onSaved, createClient = createSlicerClient }: Props) {
  const clientRef = useRef<SlicerClient | null>(null);
  const getClient = () => (clientRef.current ??= createClient());
  useEffect(() => () => clientRef.current?.dispose(), []);
  const quote = order.price.mode === 'quote';
  return (
    <section className="card custom-slicing order-measurements" aria-labelledby="order-measurements-title">
      <h2 id="order-measurements-title">{quote ? t("Measurements and price") : t("Measurements")}</h2>
      <p className="muted card__intro">
        {quote
          ? t("Slice every model with what the customer chose, or enter its print time and filament. The saved measurements price the order with the current rates (print time × hourly rate + grams × price per kilogram, plus handling); quote that price below.")
          : t("The price was fixed when the customer ordered. Measuring the models is optional, e.g. to plan printing, and doesn't change the price.")}
      </p>
      {order.items.map((item, index) => (
        <ItemMeasurements key={index} order={order} item={item} index={index} pricing={pricing} modelOf={modelOf} fileUrl={fileUrl}
          projectFiles={projectFiles} product={product} getClient={getClient} onSaved={onSaved} />
      ))}
      <p className="custom-slicing__total">
        {order.price.reviewed !== null ? (
          <>
            <strong>{t("Price from the shop's measurements: {0}", formatPrice(order.price.reviewed))}</strong>
            <span className="muted"> {t("(handling {0} included)", formatPrice(order.price.handlingFee))}</span>
          </>
        ) : <span className="muted">{t("Measure every item to get the order's price from its measurements.")}</span>}
      </p>
    </section>
  );
}

/** Name of an item in the list, by source. */
export function itemLabel(model: ItemModel, order: Pick<Order, 'project'>): string {
  switch (model.source) {
    case 'catalog': return model.productName;
    case 'upload': return model.fileName;
    case 'project': return model.file?.name ?? order.project?.title ?? t("Whole project");
    case 'printOnDemand': return model.title;
  }
}

/** Where one model file to slice comes from. */
type PlanFile =
  | {
    kind: 'load';
    label: string;
    load: () => Promise<ArrayBuffer>;
    /** The admin may choose the file instead, e.g. when fetching it from the project's site failed. */
    pickable?: boolean;
  }
  | { kind: 'pick'; hint: ReactNode }
  | { kind: 'none'; reason: string; pickable?: boolean };

/** One model file of an item, sliced and added up with the others. */
interface SliceJob {
  key: string;
  label: string;
  file: PlanFile;
  /** Runs fixed by the order (the customer's profile, the ordered print variants); null: the admin's presets. */
  runs: SliceRun[] | null;
  /** Plates to slice with the admin's presets; null: read from the file (all of a slicer project's plates). */
  plates: number[] | null;
  scale: number;
  /** Copies of this model in one copy of the item (the models of a Print on Demand set). */
  copies: number;
  /** The customer's material, preferred for the admin's filament preset. */
  material?: string;
  /** Where the file is (e.g. being fetched from the project's site). */
  status?: ReactNode;
}

/** How an item is sliced: adapted to its model source. */
interface SlicingPlan {
  jobs: SliceJob[];
  /** Explains where the files and settings come from. */
  note: string;
  /** The model's color parts (uploads): grams are split by them instead of by material. */
  parts?: ModelPart[];
  /** Why the item can't be sliced here (its measurements are entered by hand). */
  reason?: string;
}

const variantRun = (plate: number, variant: PrintVariantSummary | undefined): SliceRun | null =>
  variant?.presets ? { plate, presets: variant.presets, support: variant.support ?? false, overrides: variant.overrides ?? {}, material: variant.material } : null;

/** The presets of every plate the customer chose, or null when any is missing (products priced by volume). */
function orderedRuns(runs: (SliceRun | null)[]): SliceRun[] | null {
  return runs.length > 0 && runs.every((run) => run !== null) ? runs as SliceRun[] : null;
}

/** The customer's first named material, e.g. PETG of "PETG black + TPU red". */
const wishedMaterial = (filaments: FilamentChoice[]) => filaments.find((filament) => filament.material !== 'any')?.material;

/** A catalog product: its 3D model with the chosen print variants, at the ordered size. */
function catalogPlan(model: CatalogModel, getProduct: ReturnType<typeof useProducts>['getProduct']): SlicingPlan {
  const product = getProduct(model.productId);
  const mesh = product?.mesh;
  const plates = model.plates?.map((plate) => plate.id) ?? mesh?.selectedPlates ?? (mesh?.plate ? [mesh.plate] : [1]);
  const runs = orderedRuns(model.plates
    ? model.plates.map((plate) => variantRun(plate.id, plate.appearance?.printVariant))
    : [variantRun(plates[0], model.printVariant)]);
  const original = product?.model.heightMm;
  const scale = original ? Math.round((model.customization.dimensions.heightMm / original) * 10_000) / 10_000 : 1;
  if (!mesh) return { jobs: [], note: '', reason: t("The product has no 3D model file: enter the measurements by hand.") };
  return {
    jobs: [{ key: 'model', label: mesh.fileName, file: { kind: 'load', label: mesh.fileName, load: () => loadModelBuffer(mesh.url) }, runs, plates, scale, copies: 1 }],
    note: runs ? t("Sliced with the print variants the customer chose, at the ordered size.") : t("The product is priced by volume: choose the slicer settings."),
  };
}

function ItemMeasurements({ order, item, index, pricing, modelOf, fileUrl, projectFiles, product, getClient, onSaved }: {
  order: Order;
  item: OrderItem;
  index: number;
  pricing: PricingSettings | null;
  modelOf: Props['modelOf'];
  fileUrl: Props['fileUrl'];
  projectFiles: ProjectFiles;
  product: ProjectProduct | null | undefined;
  getClient: () => SlicerClient;
  onSaved: (order: Order) => void;
}) {
  const { getProduct } = useProducts();
  const { model, estimate, review } = item;
  const label = itemLabel(model, order);
  const saved = review ? { printMinutes: review.printMinutes, filaments: review.filaments.map(({ key, grams }) => ({ key, grams })) } : null;
  const [draft, setDraft] = useState<MeasurementsInput | null>(saved);
  const [sliced, setSliced] = useState<Sliced | undefined>(review?.sliced);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  /** Files the admin chose instead (whole projects, failed fetches), with their plates once read; by job. */
  const [picked, setPicked] = useState<Record<string, { bytes: ArrayBuffer; name: string; plates: number[] }>>({});

  const slots: FilamentSlot[] = filamentSlots(model, pricing ?? { filamentPricePerKg: Object.fromEntries(PRINT_MATERIALS.map((m) => [m, 0])) as PricingSettings['filamentPricePerKg'] });
  const plan = slicingPlan();
  const chosen = plan.jobs.filter((job) => job.runs === null);
  const [presets, setPresets] = useState<SlicerPresets & { support: boolean }>(() => defaultPresets(chosen[0]?.material));
  /** Filament preset per model when several models are sliced with the admin's presets. */
  const [jobFilaments, setJobFilaments] = useState<Record<string, string>>({});
  const filamentFor = (job: SliceJob) =>
    (chosen.length > 1 ? jobFilaments[job.key] ?? defaultFilament(presets.printer, job.material) : presets.filament);

  /** One of the external project's files, downloaded from the project's site when it is sliced. */
  function projectJob(file: ProjectFile, key: string, copies: number, scale: number, material?: string): SliceJob {
    const status = projectFiles.statusOf(file.id);
    const site = order.project ? SOURCE_LABELS[order.project.source] : '';
    const base = { key, label: file.name, runs: null, plates: null, scale, copies, material };
    const notSliceable = (name: string) =>
      t("{0} is not an STL or 3MF file, which the slicer reads: choose an STL or 3MF export of it, or enter the measurements by hand.", name);
    if (status.status === 'ready' && !status.file.format) {
      return { ...base, file: { kind: 'none', pickable: true, reason: notSliceable(status.file.fileName) } };
    }
    return {
      ...base,
      file: {
        kind: 'load',
        label: file.name,
        load: async () => {
          const downloaded = await projectFiles.download(file.id);
          if (!downloaded.format) throw new Error(notSliceable(downloaded.fileName));
          return readFileBytes(downloaded.blob);
        },
        pickable: status.status === 'error',
      },
      status: status.status === 'ready' ? t("Downloaded from {0}.", site)
        : status.status === 'downloading' ? t("Downloading from {0}…", site)
          : status.status === 'error' ? <span className="print-files__error">{status.message}</span>
            : t("Downloaded from {0} when you slice.", site),
    };
  }

  /** How this item is sliced, by source. */
  function slicingPlan(): SlicingPlan {
    switch (model.source) {
      case 'upload': {
        const file = modelOf(model);
        const plates = file.status === 'ready' && file.result.plates?.length ? file.result.plates : [1];
        const parts: ModelPart[] | undefined = !model.parts?.length ? undefined : file.status === 'ready'
          ? file.result.parts
          : model.parts.map((part) => ({ key: part.key, name: part.name, fileColor: part.color.hex, share: 1 / model.parts!.length }));
        const profile = model.profile;
        return {
          jobs: [{
            key: 'model', label: model.fileName, plates, scale: profile?.scale ?? 1, copies: 1,
            file: { kind: 'load', label: model.fileName, load: async () => loadModelBuffer(await fileUrl(model)) },
            runs: profile ? plates.map((plate) => ({
              plate, presets: { printer: profile.printer, process: profile.process, filament: profile.filament }, support: profile.support, overrides: {},
              material: presetMaterial(profile.filament),
            })) : null,
          }],
          parts,
          note: profile
            ? t("Sliced with the customer's profile and scale only, as their browser did for the estimate.")
            : t("Ordered before slicing profiles: choose the slicer settings."),
        };
      }
      case 'catalog':
        return catalogPlan(model, getProduct);
      case 'printOnDemand': {
        if (product === undefined) return { jobs: [], note: '', reason: t("Loading the product…") };
        const mesh = product?.mesh;
        if (mesh) {
          // The shop's print file holds the whole set: sliced with the ordered variants at the ordered scale.
          const plates = model.print?.plates.map(({ plateId }) => plateId ?? 1) ?? mesh.selectedPlates ?? [1];
          const runs = model.print ? orderedRuns(model.print.plates.map(({ plateId, variant }) => variantRun(plateId ?? 1, variant))) : null;
          return {
            jobs: [{ key: 'print-file', label: mesh.fileName, file: { kind: 'load', label: mesh.fileName, load: () => loadModelBuffer(mesh.url) }, runs, plates, scale: model.print?.scale ?? 1, copies: 1 }],
            note: runs ? t("Sliced with the print variants the customer chose, at the ordered scale.") : t("Choose the slicer settings for the customer's materials."),
          };
        }
        // Without a print file: every model of the set, with its copies per set and scale.
        return {
          jobs: model.models.map(({ file, settings }, i) => (file
            ? projectJob(file, `${i}:${file.id}`, settings.quantity, settings.scalePercent / 100, wishedMaterial(settings.filaments))
            : { key: `${i}:whole`, label: order.project?.title ?? t("Whole project"), file: { kind: 'pick', hint: t("Choose the model file.") }, runs: null, plates: null, scale: settings.scalePercent / 100, copies: settings.quantity, material: wishedMaterial(settings.filaments) })),
          note: t("Every model of one set, with its copies and scale, sliced with the settings you choose for the customer's materials."),
        };
      }
      case 'project': {
        const site = order.project ? SOURCE_LABELS[order.project.source] : '';
        const material = wishedMaterial(model.filaments);
        if (model.file) {
          return {
            jobs: [projectJob(model.file, model.file.id, 1, model.scalePercent / 100, material)],
            note: t("The model from {0}, at the customer's scale, sliced with the settings you choose for the customer's wishes.", site),
          };
        }
        return {
          jobs: [{
            key: 'whole', label: order.project?.title ?? t("Whole project"), runs: null, plates: null, scale: model.scalePercent / 100, copies: 1, material,
            file: {
              kind: 'pick',
              hint: order.project
                ? <>{t("The site lists no separate files: download the model from {0} and choose it here.", site)} <a href={order.project.url} target="_blank" rel="noopener noreferrer">{t("Open on {0}", site)} ↗</a></>
                : t("Choose the model file."),
            },
          }],
          note: t("Choose the slicer settings for the customer's wishes."),
        };
      }
    }
  }

  const jobReady = (job: SliceJob) => Boolean(picked[job.key]) || job.file.kind === 'load';
  const presetsReady = chosen.every((job) => presets.printer && presets.process && filamentFor(job));
  const canSlice = plan.jobs.length > 0 && plan.jobs.every(jobReady) && presetsReady && progress === null && !busy;

  async function pick(job: SliceJob, file: File | null) {
    if (!file) return;
    setMessage(null);
    const bytes = await readFileBytes(file);
    const plates = await readPlates(getClient(), bytes, file.name);
    setPicked((prev) => ({ ...prev, [job.key]: { bytes, name: file.name, plates } }));
  }

  async function slice() {
    setMessage(null);
    setProgress(0);
    try {
      const runs: SliceRun[] = [];
      const total: SlicedCopy = { seconds: 0, grams: 0, perRun: [], perExtruder: [] };
      const extruders = new Map<number, number>();
      for (const [i, job] of plan.jobs.entries()) {
        const own = picked[job.key];
        if (!own && job.file.kind !== 'load') continue;
        const file = own ?? { bytes: await (job.file as Extract<PlanFile, { kind: 'load' }>).load(), name: job.label };
        const plates = own?.plates ?? job.plates ?? await readPlates(getClient(), file.bytes, file.name);
        const filament = filamentFor(job);
        const jobRuns = (!own && job.runs) || plates.map((plate): SliceRun => ({
          plate, presets: { printer: presets.printer, process: presets.process, filament }, support: presets.support, overrides: {},
          material: presetMaterial(filament),
        }));
        const copy = await sliceRuns(getClient(), file, jobRuns, job.scale, (fraction) => setProgress((i + fraction) / plan.jobs.length));
        total.seconds += copy.seconds * job.copies;
        total.grams += copy.grams * job.copies;
        runs.push(...jobRuns);
        total.perRun.push(...copy.perRun.map((grams) => grams * job.copies));
        for (const { extruder, weight_g } of copy.perExtruder) extruders.set(extruder, (extruders.get(extruder) ?? 0) + weight_g * job.copies);
      }
      total.perExtruder = [...extruders].map(([extruder, weight_g]) => ({ extruder, weight_g, length_m: 0 }));
      const result = plan.parts ? measurementsByParts(total, plan.parts) : measurementsByMaterial(total, runs);
      setSliced({ ...result, slicedAt: new Date().toISOString() });
      setDraft(structuredClone(result));
    } catch (err) {
      if (!(err instanceof SliceCancelledError)) {
        const reason = err instanceof ApiError ? [err.message, ...err.details].join(' ') : err instanceof Error ? err.message : String(err);
        setMessage({ kind: 'error', text: t("Could not slice {0}: {1}", label, reason) });
      }
    } finally {
      setProgress(null);
    }
  }

  const valid = draft !== null && Number.isFinite(draft.printMinutes) && draft.printMinutes >= 0 && draft.filaments.length > 0
    && draft.filaments.every((row) => Number.isFinite(row.grams) && row.grams >= 0 && slots.some((slot) => slot.key === row.key))
    && draft.filaments.some((row) => row.grams > 0);
  const changed = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  const preview = valid && pricing ? copyPrice(draft!, slots, pricing.hourlyRate) : null;

  async function save() {
    if (!draft || !valid) return;
    setBusy(true);
    setMessage(null);
    try {
      onSaved(await api.reviewOrderItem(order.id, index, { ...draft, ...(sliced && { sliced }) }));
      setMessage({ kind: 'success', text: t("Measurements saved.") });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? [err.message, ...err.details].join(' ') : t("Could not save the measurements.") });
    } finally {
      setBusy(false);
    }
  }

  const slotLabel = (key: string) => slots.find((slot) => slot.key === key)?.label ?? key;
  const summary = (value: MeasurementsInput) =>
    `${minutesText(value.printMinutes)} · ${value.filaments.map((row) => `${value.filaments.length > 1 || measuredByParts(model) ? `${slotLabel(row.key)}: ` : `${row.key} `}${gramsText(row.grams)}`).join(', ')}`;
  const severalModels = plan.jobs.length > 1 || plan.jobs.some((job) => job.copies > 1);

  return (
    <article className="custom-slicing__file" aria-label={t("Measurements of {0}", label)}>
      <h3>{label} <span className="muted">× {item.quantity}</span></h3>
      <dl className="config-details">
        {estimate && (
          <>
            <dt>{t("Customer's estimate")}</dt>
            <dd>{summary(estimate)} · {t("{0} a copy", formatPrice(estimate.unitPrice))}</dd>
          </>
        )}
        <dt>{t("Saved measurements")}</dt>
        <dd>
          {review
            ? <>{summary(review)} · {t("{0} a copy", formatPrice(review.unitPrice))} <span className="muted">({formatDateTime(review.reviewedAt)})</span></>
            : <span className="muted">{t("Not measured yet.")}</span>}
        </dd>
      </dl>

      <div className="item-slicing">
        {plan.note && <p className="muted">{plan.note}</p>}
        {plan.reason && <p className="muted">{plan.reason}</p>}
        {plan.jobs.length > 0 && (
          <ul className="item-slicing__jobs">
            {plan.jobs.map((job) => {
              const own = picked[job.key];
              const showPick = job.file.kind === 'pick' || ((job.file.kind === 'none' || job.file.kind === 'load') && job.file.pickable);
              return (
                <li key={job.key} className="item-slicing__job">
                  <div>
                    <strong>{own ? own.name : job.label}</strong>
                    {severalModels && <span className="muted"> × {job.copies}</span>}
                    {(job.runs === null || severalModels) && <small className="muted"> · {t("Scale {0}%", formatNumber(job.scale * 100, { maximumFractionDigits: 1 }))}</small>}
                    {!own && job.status && <div><small className="muted">{job.status}</small></div>}
                    {own && <div><small className="muted">{t("{0}: plates {1}", own.name, own.plates.join(', '))}</small></div>}
                    {job.file.kind === 'none' && !own && <p className="muted">{job.file.reason}</p>}
                  </div>
                  {!own && job.runs && (
                    <ul className="item-slicing__runs">
                      {job.runs.map((run) => (
                        <li key={run.plate}>
                          {job.runs!.length > 1 && <strong>{t("Plate {0}", run.plate)}: </strong>}
                          {run.presets.printer} · {run.presets.process} · {run.presets.filament}
                          <small className="muted"> · {run.support ? t("With supports") : t("Without supports")} · {t("Scale {0}%", formatNumber(job.scale * 100, { maximumFractionDigits: 1 }))}</small>
                        </li>
                      ))}
                    </ul>
                  )}
                  {chosen.length > 1 && job.runs === null && (
                    <label className="field">
                      <span>{t("Filament for {0}", job.label)}</span>
                      <select value={filamentFor(job)} disabled={progress !== null}
                        onChange={(e) => setJobFilaments((prev) => ({ ...prev, [job.key]: e.target.value }))}>
                        {slicerCatalog.filamentsFor(presets.printer).map((filament) => <option key={filament} value={filament}>{filament}</option>)}
                      </select>
                    </label>
                  )}
                  {showPick && (
                    <label className="field">
                      <span>{job.file.kind === 'pick' ? t("Model file (.3mf or .stl)") : t("Or choose the file yourself (.3mf or .stl)")}</span>
                      <input type="file" accept=".3mf,.stl" disabled={progress !== null} onChange={(e) => void pick(job, e.target.files?.[0] ?? null)}
                        aria-label={t("Model file of {0}", job.label)} />
                      {job.file.kind === 'pick' && !own && <small className="field__help">{job.file.hint}</small>}
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {chosen.length > 0 && (
          <PresetChooser value={presets} onChange={(next) => {
            if (next.printer !== presets.printer) setJobFilaments({});
            setPresets(next);
          }} filament={chosen.length === 1} disabled={progress !== null} />
        )}
        {plan.jobs.length > 0 && (
          <div className="custom-slicing__actions">
            <button type="button" className="btn btn--small" disabled={!canSlice} onClick={() => void slice()}>
              {draft && sliced ? t("Slice again") : t("Slice")}
            </button>
            {progress !== null && (
              <span className="slicer__progress" role="status">
                <progress max={1} value={progress} /> {t("Slicing… {0}%", Math.round(progress * 100))}
              </span>
            )}
          </div>
        )}
      </div>

      {draft ? (
        <MeasurementsEditor label={label} draft={draft} slots={slots} fixedRows={measuredByParts(model)} onChange={setDraft} />
      ) : (
        <button type="button" className="btn btn--small btn--ghost"
          onClick={() => setDraft({ printMinutes: NaN, filaments: measuredByParts(model) ? slots.map((slot) => ({ key: slot.key, grams: NaN })) : [{ key: plan.jobs[0]?.runs?.[0]?.material ?? plan.jobs[0]?.material ?? 'PLA', grams: NaN }] })}>
          {t("Enter by hand")}
        </button>
      )}
      {draft && sliced && (
        <p className="muted">
          {t("Sliced: {0}", summary(sliced))}
          {JSON.stringify({ printMinutes: sliced.printMinutes, filaments: sliced.filaments }) !== JSON.stringify(draft) && (
            <> <button type="button" className="btn btn--small btn--ghost" onClick={() => setDraft({ printMinutes: sliced.printMinutes, filaments: structuredClone(sliced.filaments) })}>
              {t("Use sliced values")}
            </button></>
          )}
        </p>
      )}
      {draft && (
        <div className="custom-slicing__actions">
          {preview !== null && (
            <span>
              {t("{0} a copy", formatPrice(preview))}
              {item.quantity > 1 && <span className="muted"> · {t("{0} for {1} copies", formatPrice(Math.round(preview * item.quantity * 100) / 100), item.quantity)}</span>}
            </span>
          )}
          <button type="button" className="btn btn--primary btn--small" disabled={!valid || !changed || busy} onClick={() => void save()}>
            {busy ? t("Saving…") : t("Save measurements")}
          </button>
        </div>
      )}
      {message && <p className={`banner banner--${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
    </article>
  );
}

/** Plates of a slicer project (all are sliced and added up), as the slicer reads the file; [1] for single models. */
async function readPlates(client: SlicerClient, bytes: ArrayBuffer, name: string): Promise<number[]> {
  try {
    const { plates } = await client.inspect(bytes, name, 1);
    return plates.length > 0 ? plates.map((_, i) => i + 1) : [1];
  } catch {
    // Slicing reports the problem.
    return [1];
  }
}

/** The printer's filament preset of the material, or its default. */
function defaultFilament(printer: string, material?: string): string {
  return slicerCatalog.filamentsFor(printer).find((filament) => material && presetMaterial(filament) === material) ?? slicerCatalog.defaultFilament(printer) ?? '';
}

/** A 0.4 mm nozzle printer (as on the Slicer test tab) with its default process, and a filament of the wished material when there is one. */
function defaultPresets(material?: string): SlicerPresets & { support: boolean } {
  const printer = slicerCatalog.printers.find((name) => name.includes('(0.4 nozzle)')) ?? slicerCatalog.printers[0] ?? '';
  return { printer, process: slicerCatalog.defaultProcess(printer) ?? '', filament: defaultFilament(printer, material), support: false };
}

/**
 * Printer, process and filament presets (only compatible ones) and supports, for items the order
 * doesn't settle. With several models the filament is chosen per model instead.
 */
function PresetChooser({ value, filament, onChange, disabled }: {
  value: SlicerPresets & { support: boolean };
  filament: boolean;
  onChange: (value: SlicerPresets & { support: boolean }) => void;
  disabled: boolean;
}) {
  const choosePrinter = (printer: string) => onChange({
    ...value, printer, process: slicerCatalog.defaultProcess(printer) ?? '', filament: slicerCatalog.defaultFilament(printer) ?? '',
  });
  return (
    <div className="item-slicing__presets">
      <label className="field">
        <span>{t("Printer")}</span>
        <select value={value.printer} disabled={disabled} onChange={(e) => choosePrinter(e.target.value)}>
          {slicerCatalog.printers.map((printer) => <option key={printer} value={printer}>{printer}</option>)}
        </select>
      </label>
      <label className="field">
        <span>{t("Process")}</span>
        <select value={value.process} disabled={disabled} onChange={(e) => onChange({ ...value, process: e.target.value })}>
          {slicerCatalog.processesFor(value.printer).map((process) => <option key={process} value={process}>{process}</option>)}
        </select>
      </label>
      {filament && (
        <label className="field">
          <span>{t("Filament")}</span>
          <select value={value.filament} disabled={disabled} onChange={(e) => onChange({ ...value, filament: e.target.value })}>
            {slicerCatalog.filamentsFor(value.printer).map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      )}
      <label className="checkbox">
        <input type="checkbox" checked={value.support} disabled={disabled} onChange={(e) => onChange({ ...value, support: e.target.checked })} />
        {t("Supports")}
      </label>
    </div>
  );
}

/** Print time and grams of one copy: one row per color part of an uploaded model, otherwise per material. */
function MeasurementsEditor({ label, draft, slots, fixedRows, onChange }: {
  label: string;
  draft: MeasurementsInput;
  slots: FilamentSlot[];
  /** Rows are the model's color parts: not added, removed or renamed. */
  fixedRows: boolean;
  onChange: (draft: MeasurementsInput) => void;
}) {
  const setRow = (index: number, patch: Partial<MeasurementsInput['filaments'][number]>) =>
    onChange({ ...draft, filaments: draft.filaments.map((row, i) => (i === index ? { ...row, ...patch } : row)) });
  const slotLabel = (key: string) => slots.find((slot) => slot.key === key)?.label ?? key;
  return (
    <div className="custom-slicing__result">
      <label className="field">
        <span>{t("Print time of one copy (min)")}</span>
        <input type="number" min={0} step={0.1} value={Number.isNaN(draft.printMinutes) ? '' : draft.printMinutes}
          onChange={(e) => onChange({ ...draft, printMinutes: e.target.valueAsNumber })} aria-label={t("Print time of {0} in minutes", label)} />
        {Number.isFinite(draft.printMinutes) && <small className="field__help">{minutesText(draft.printMinutes)}</small>}
      </label>
      {draft.filaments.map((row, index) => (
        <div key={fixedRows ? row.key : index} className="field item-slicing__row">
          {fixedRows ? <span>{t("{0} (g)", slotLabel(row.key))}</span> : (
            <select value={row.key} onChange={(e) => setRow(index, { key: e.target.value })} aria-label={t("Material {0}", index + 1)}>
              {slots.map((slot) => <option key={slot.key} value={slot.key}>{slot.label}</option>)}
            </select>
          )}
          <span className="input-unit">
            <input type="number" min={0} step={0.01} value={Number.isNaN(row.grams) ? '' : row.grams}
              onChange={(e) => setRow(index, { grams: e.target.valueAsNumber })} aria-label={t("Grams of {0} for {1}", slotLabel(row.key), label)} />
            <span className="muted">g</span>
          </span>
          {!fixedRows && (
            <button type="button" className="icon-btn" aria-label={t("Remove {0}", slotLabel(row.key))} disabled={draft.filaments.length === 1}
              onClick={() => onChange({ ...draft, filaments: draft.filaments.filter((_, i) => i !== index) })}>×</button>
          )}
        </div>
      ))}
      {!fixedRows && (
        <p>
          <button type="button" className="btn btn--small btn--ghost"
            onClick={() => onChange({ ...draft, filaments: [...draft.filaments, { key: slots.find((slot) => !draft.filaments.some((row) => row.key === slot.key))?.key ?? slots[0].key, grams: NaN }] })}>
            {t("+ Add material")}
          </button>
        </p>
      )}
    </div>
  );
}
