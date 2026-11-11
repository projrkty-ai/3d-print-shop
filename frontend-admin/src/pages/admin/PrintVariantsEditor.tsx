import { formatCount, formatNumber, t } from '../../i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { loadModelBuffer } from '../../api/client';
import { createSlicerClient, SliceCancelledError, type SlicerClient } from '../../slicer/client';
import { parseOverrides } from '../../slicer/overrides';
import { stageLabel } from '../../slicer/stages';
import type { CatalogPricing, PlateSlicing, PrintMeasurements, PrintVariant, Product, SlicerPresets } from '../../types';
import { includedProductPlates } from '../../utils/meshPlates';
import { formatPrice } from '../../utils/pricing';
import { measurementsPrice, offeredVariants, usesVariantPricing } from '../../utils/printVariants';
import {
  emptySlicing, formatOverrides, matrixCombinations, measurementsEdited, mergeSliced, sameScale, slicerCatalog, unmatchedPrinters,
  type SlicingMatrix,
} from '../../utils/printVariantMatrix';
import { formatScale, slicedScales } from '../../utils/scaling';
import { formatDuration } from '../../utils/projectPricing';
import { durationUnits } from './PricingBreakdown';
import { MATERIAL_LABELS } from './orderDisplay';

type SlicingUpdate = (update: (slicing: PlateSlicing[]) => PlateSlicing[]) => void;

interface Props {
  product: Product;
  /** Functional, because slicing results arrive while the admin keeps editing. */
  onChange: SlicingUpdate;
  /** Injectable for tests; defaults to the slicing Web Worker. */
  createClient?: () => SlicerClient;
  /** Injectable for tests; downloads the product's model file. */
  loadModel?: (url: string) => Promise<ArrayBuffer>;
  disabled?: boolean;
}

interface Run {
  plateId: number | null;
  index: number;
  total: number;
  label: string;
  stage: string;
  fraction: number;
}

const presetsText = (presets: SlicerPresets) => `${presets.printer} · ${presets.process} · ${presets.filament}`;
const union = (lists: string[][]) => [...new Set(lists.flat())];
const toggled = (list: string[], value: string, on: boolean) => (on ? (list.includes(value) ? list : [...list, value]) : list.filter((item) => item !== value));

/**
 * Print variants of a product: every included plate (or the whole model) is sliced with the
 * chosen printer × process × filament presets in the browser; the resulting print times and
 * filament weights (editable) price the variants customers choose from.
 */
export function PrintVariantsEditor({ product, onChange, createClient = createSlicerClient, loadModel = loadModelBuffer, disabled = false }: Props) {
  const clientRef = useRef<SlicerClient | null>(null);
  const getClient = () => (clientRef.current ??= createClient());
  useEffect(() => () => clientRef.current?.dispose(), []);
  const [run, setRun] = useState<Run | null>(null);
  const [runErrors, setRunErrors] = useState<string[]>([]);
  const [surfaceId, setSurfaceId] = useState<number | null>(null);

  const mesh = product.mesh;
  const plates = includedProductPlates(product);
  if (!mesh) {
    return (
      <section className="card">
        <h2>{t("Print variants (slicing)")}</h2>
        <p className="muted">{t("Add a 3D model file to slice print variants.")}</p>
      </section>
    );
  }
  const surface = plates.find((plate) => plate.id === surfaceId) ?? plates[0] ?? null;
  const plateId = surface?.id ?? null;
  const slicing = product.slicing?.find((entry) => entry.plateId === plateId) ?? emptySlicing(plateId);
  const surfaceName = (id: number | null) => (id === null ? t("Whole model") : plates.find((plate) => plate.id === id)?.name ?? t("Plate {0}", id));

  const update = (id: number | null, change: (current: PlateSlicing) => PlateSlicing) => onChange((list) => {
    const index = list.findIndex((entry) => entry.plateId === id);
    const next = change(index >= 0 ? list[index] : emptySlicing(id));
    return index >= 0 ? list.map((entry, i) => (i === index ? next : entry)) : [...list, next];
  });
  const updateVariant = (variantId: string, change: (variant: PrintVariant) => PrintVariant) =>
    update(plateId, (current) => ({ ...current, variants: current.variants.map((variant) => (variant.id === variantId ? change(variant) : variant)) }));

  /** The original size first: results at other scales belong to the variant it creates. */
  const scales = [1, ...slicedScales(product)];

  async function sliceAll(target: PlateSlicing) {
    if (!mesh || run) return;
    const combos = matrixCombinations(target.matrix);
    const settings = { support: target.support, overrides: { ...target.overrides } };
    const runScales = [...scales];
    const total = combos.length * runScales.length;
    setRunErrors([]);
    setRun({ plateId: target.plateId, index: 0, total, label: '', stage: 'loading', fraction: 0 });
    const problems: string[] = [];
    try {
      const bytes = await loadModel(mesh.url);
      combos: for (const [comboIndex, presets] of combos.entries()) {
        for (const [scaleIndex, scale] of runScales.entries()) {
          const label = `${presetsText(presets)} · ${formatScale(scale)}`;
          setRun({ plateId: target.plateId, index: comboIndex * runScales.length + scaleIndex, total, label, stage: 'slicing', fraction: 0 });
          try {
            const { result } = await getClient().slice(bytes, mesh.fileName, {
              useProjectSettings: false, ...presets, support: settings.support ? 'on' : 'off', plate: target.plateId ?? 1,
              copies: 1, scale, calibration: true, overrides: settings.overrides, gcode: false,
            }, (stage, fraction) => setRun((current) => current && { ...current, stage, fraction }));
            update(target.plateId, (current) => mergeSliced(current, [{ presets, scale, result }], undefined, undefined, runScales));
          } catch (err) {
            if (err instanceof SliceCancelledError) break combos;
            problems.push(t("{0}: {1}", label, err instanceof Error ? err.message : String(err)));
            // Without the original size there is no variant to add the other scales to.
            if (scaleIndex === 0) continue combos;
          }
        }
      }
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    } finally {
      setRun(null);
      setRunErrors(problems);
    }
  }

  const rates = product.catalogPricing?.hourlyRate !== undefined && product.catalogPricing.filamentPricePerKg
    ? { hourlyRate: product.catalogPricing.hourlyRate, filamentPricePerKg: product.catalogPricing.filamentPricePerKg }
    : null;
  const anyOffered = (product.slicing ?? []).some((entry) => offeredVariants(entry).length > 0);
  const busy = disabled || run !== null;

  return (
    <section className="card print-variants">
      <h2>{t("Print variants (slicing)")}</h2>
      <p className="muted card__intro">
        {t("Slice every plate with the printers, processes and filaments you offer. Customers choose one of the offered variants for each plate; its print time and filament, priced with the Pricing rates, give the price at the original size, scaled with the volume for other sizes. Without variants, the volume estimate is used.")}
      </p>
      <p className={`banner ${usesVariantPricing(product) ? 'banner--success' : 'banner--info'}`}>
        {usesVariantPricing(product)
          ? t("Prices come from the print variants customers choose.")
          : anyOffered
            ? t("Offer at least one variant on every included plate to price the product with them.")
            : t("No variants are offered: prices come from the volume estimate.")}
      </p>

      {plates.length > 1 && (
        <label className="field print-variants__plate">
          <span>{t("Plate")}</span>
          <select value={plateId ?? ''} onChange={(event) => setSurfaceId(Number(event.target.value))} disabled={run !== null}>
            {plates.map((plate) => {
              const offered = offeredVariants(product.slicing?.find((entry) => entry.plateId === plate.id)).length;
              return <option key={plate.id} value={plate.id}>{t("{0} ({1} offered)", plate.name, offered)}</option>;
            })}
          </select>
        </label>
      )}
      {plates.length === 1 && <p className="muted">{t("Plate:")} {surfaceName(plateId)}</p>}

      <PlateSetup key={String(plateId)} slicing={slicing} disabled={busy} scales={scales}
        onChange={(change) => update(plateId, change)} onSlice={() => void sliceAll(slicing)} />

      {run && (
        <div className="slicer__progress" role="status">
          <progress max={1} value={(run.index + run.fraction) / Math.max(1, run.total)} />
          <span>
            {t("Slicing {0} of {1}: {2}", run.index + 1, run.total, run.label)}
            {run.stage !== 'loading' && ` · ${stageLabel(run.stage)} ${Math.round(run.fraction * 100)}%`}
          </span>
          <button type="button" className="btn btn--small btn--ghost" onClick={() => clientRef.current?.cancel()}>{t("Cancel")}</button>
        </div>
      )}
      {runErrors.length > 0 && (
        <div className="banner banner--error" role="alert">
          <strong>{t("Some variants could not be sliced:")}</strong>
          <ul>{runErrors.map((message) => <li key={message}>{message}</li>)}</ul>
        </div>
      )}

      {slicing.variants.length > 0 ? (
        <div className="table-wrap">
          <table className="option-table print-variants__table">
            <caption>{t("Variants of {0}", surfaceName(plateId))}</caption>
            <thead>
              <tr>
                <th>{t("Offered")}</th>
                <th>{t("Default")}</th>
                <th>{t("Name shown to customers")}</th>
                <th>{t("Scale")}</th>
                <th>{t("Print time (min)")}</th>
                <th>{t("Filament (g)")}</th>
                <th>{t("Price")}</th>
                <th aria-label={t("Remove")} />
              </tr>
            </thead>
            {slicing.variants.map((variant) => (
              <VariantRows key={variant.id} variant={variant} plateId={plateId} isDefault={slicing.defaultVariantId === variant.id}
                rates={rates} scales={scales} disabled={busy}
                onChange={(change) => updateVariant(variant.id, change)}
                onDefault={() => update(plateId, (current) => ({ ...current, defaultVariantId: variant.id }))}
                onToggle={(enabled) => update(plateId, (current) => {
                  const variants = current.variants.map((v) => (v.id === variant.id ? { ...v, enabled } : v));
                  const offered = variants.filter((v) => v.enabled);
                  const defaultVariantId = offered.some((v) => v.id === current.defaultVariantId) ? current.defaultVariantId : offered[0]?.id ?? null;
                  return { ...current, variants, defaultVariantId };
                })}
                onRemove={() => update(plateId, (current) => {
                  const variants = current.variants.filter((v) => v.id !== variant.id);
                  const offered = variants.filter((v) => v.enabled);
                  const defaultVariantId = offered.some((v) => v.id === current.defaultVariantId) ? current.defaultVariantId : offered[0]?.id ?? null;
                  return { ...current, variants, defaultVariantId };
                })} />
            ))}
          </table>
        </div>
      ) : (
        <p className="muted">{t("No variants sliced for {0} yet.", surfaceName(plateId))}</p>
      )}
      {!rates && slicing.variants.length > 0 && <p className="muted">{t("Prices appear once the Pricing rates are loaded.")}</p>}
    </section>
  );
}

/** Matrix of presets, supports and option overrides of one plate, and the slice button. */
function PlateSetup({ slicing, disabled, scales, onChange, onSlice }: {
  slicing: PlateSlicing;
  scales: number[];
  disabled: boolean;
  onChange: (change: (current: PlateSlicing) => PlateSlicing) => void;
  onSlice: () => void;
}) {
  const [overridesText, setOverridesText] = useState(() => formatOverrides(slicing.overrides));
  const parsed = parseOverrides(overridesText);
  const { matrix } = slicing;
  const processes = union(matrix.printers.map((printer) => slicerCatalog.processesFor(printer)));
  const filaments = union(matrix.printers.map((printer) => slicerCatalog.filamentsFor(printer)));
  const combos = matrixCombinations(matrix);
  const unmatched = unmatchedPrinters(matrix);

  const setMatrix = (change: (current: SlicingMatrix) => SlicingMatrix) => onChange((current) => ({ ...current, matrix: change(current.matrix) }));
  function togglePrinter(printer: string, on: boolean) {
    setMatrix((current) => {
      const printers = toggled(current.printers, printer, on);
      const fits = (list: string[], options: string[]) => list.filter((item) => options.includes(item));
      const defaults = on ? { process: slicerCatalog.defaultProcess(printer), filament: slicerCatalog.defaultFilament(printer) } : {};
      const hasProcess = slicerCatalog.processesFor(printer).some((p) => current.processes.includes(p));
      const hasFilament = slicerCatalog.filamentsFor(printer).some((f) => current.filaments.includes(f));
      return {
        printers,
        // A newly chosen printer starts with its default process and filament.
        processes: fits([...current.processes, ...(defaults.process && !hasProcess ? [defaults.process] : [])], union(printers.map((p) => slicerCatalog.processesFor(p)))),
        filaments: fits([...current.filaments, ...(defaults.filament && !hasFilament ? [defaults.filament] : [])], union(printers.map((p) => slicerCatalog.filamentsFor(p)))),
      };
    });
  }
  function changeOverrides(text: string) {
    setOverridesText(text);
    const next = parseOverrides(text);
    if (next.invalidLines.length === 0) onChange((current) => ({ ...current, overrides: next.overrides }));
  }

  const group = (legend: string, options: string[], selected: string[], onToggle: (value: string, on: boolean) => void, empty: ReactNode) => (
    <fieldset className="print-variants__group">
      <legend>{legend}</legend>
      {options.length === 0 ? <p className="muted">{empty}</p> : options.map((option) => (
        <label key={option} className="checkbox">
          <input type="checkbox" checked={selected.includes(option)} disabled={disabled} onChange={(event) => onToggle(option, event.target.checked)} />
          {option}
        </label>
      ))}
    </fieldset>
  );

  return (
    <div className="print-variants__setup">
      <div className="print-variants__matrix">
        {group(t("Printers"), slicerCatalog.printers, matrix.printers, togglePrinter, null)}
        {group(t("Processes"), processes, matrix.processes,
          (value, on) => setMatrix((current) => ({ ...current, processes: toggled(current.processes, value, on) })), t("Choose a printer first."))}
        {group(t("Filaments"), filaments, matrix.filaments,
          (value, on) => setMatrix((current) => ({ ...current, filaments: toggled(current.filaments, value, on) })), t("Choose a printer first."))}
      </div>
      {unmatched.length > 0 && <p className="field__help is-error">{t("No chosen process or filament fits: {0}.", unmatched.join(', '))}</p>}
      <label className="checkbox">
        <input type="checkbox" checked={slicing.support} disabled={disabled} onChange={(event) => onChange((current) => ({ ...current, support: event.target.checked }))} />
        {t("Generate supports (every variant of this plate)")}
      </label>
      <label className="field">
        <span>{t("OrcaSlicer options for every variant (optional)")}</span>
        <textarea rows={3} className="mono" value={overridesText} disabled={disabled} placeholder={'sparse_infill_density = 20%\nwall_loops = 3'}
          onChange={(event) => changeOverrides(event.target.value)} aria-label={t("OrcaSlicer options")} />
        {parsed.invalidLines.length > 0
          ? <small className="field__help is-error">{t("Use “key = value” lines. Invalid lines: {0}.", parsed.invalidLines.join(', '))}</small>
          : <small className="field__help">{t("One “key = value” per line, e.g. sparse_infill_density = 20%.")}</small>}
      </label>
      <div className="slicer__actions">
        <button type="button" className="btn btn--primary" disabled={disabled || combos.length === 0 || parsed.invalidLines.length > 0} onClick={onSlice}>
          {combos.length > 0 ? t("Slice {0}", formatCount('variant', combos.length)) : t("Choose presets to slice")}
        </button>
        <span className="muted">
          {t("Each variant is sliced at {0}.", scales.map(formatScale).join(', '))}{' '}
          {t("Slicing again replaces the measurements of variants with the same presets; names and offers stay.")}
        </span>
      </div>
    </div>
  );
}

type Rates = Pick<Required<CatalogPricing>, 'hourlyRate' | 'filamentPricePerKg'>;

/** A variant's measurements at one scale: the original size (`index` null) or one of `variant.scaled`. */
interface Point {
  scale: number;
  index: number | null;
  measurements?: PrintMeasurements;
  sliced?: PrintMeasurements & { slicedAt: string };
}

/** The points shown for a variant: the original size, every scale the product needs and every stored scale. */
function variantPoints(variant: PrintVariant, scales: number[]): Point[] {
  const stored = (variant.scaled ?? []).map((point, index) => ({ ...point, index }));
  const missing = scales.filter((scale) => !sameScale(scale, 1) && !stored.some((point) => sameScale(point.scale, scale)))
    .map((scale) => ({ scale, index: null as number | null, measurements: undefined, sliced: undefined }));
  const original = { scale: 1, index: null, measurements: variant.measurements, sliced: variant.sliced };
  return [original, ...stored, ...missing].sort((a, b) => a.scale - b.scale);
}

/** A variant with one row per scale: its print time, filament and price there. */
function VariantRows({ variant, plateId, isDefault, rates, scales, disabled, onChange, onDefault, onToggle, onRemove }: {
  variant: PrintVariant;
  plateId: number | null;
  isDefault: boolean;
  rates: Rates | null;
  /** Scales the product is priced at (1 and the ends of its scale range). */
  scales: number[];
  disabled: boolean;
  onChange: (change: (variant: PrintVariant) => PrintVariant) => void;
  onDefault: () => void;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
}) {
  const points = variantPoints(variant, scales);
  const name = variant.label || variant.id;
  const number = (value: number) => (Number.isNaN(value) ? '' : value);
  /** Changes the measurements at one point (the original size or a scaled one). */
  const setMeasurements = (point: Point, change: (measurements: PrintMeasurements) => PrintMeasurements) => onChange((current) => (
    sameScale(point.scale, 1)
      ? { ...current, measurements: change(current.measurements) }
      : { ...current, scaled: (current.scaled ?? []).map((scaled, i) => (i === point.index ? { ...scaled, measurements: change(scaled.measurements) } : scaled)) }
  ));
  const rowSpan = points.length;
  return (
    <tbody className={`print-variants__variant ${variant.enabled ? '' : 'is-muted'}`}>
      {points.map((point, row) => {
        const scaleName = formatScale(point.scale);
        const stored = point.measurements !== undefined && (sameScale(point.scale, 1) || point.index !== null);
        const { measurements, sliced } = point;
        const price = rates && measurements ? measurementsPrice(measurements, rates) : null;
        const outside = !scales.some((scale) => sameScale(scale, point.scale));
        return (
          <tr key={point.scale}>
            {row === 0 && (
              <>
                <td rowSpan={rowSpan}>
                  <input type="checkbox" checked={variant.enabled} disabled={disabled} onChange={(event) => onToggle(event.target.checked)}
                    aria-label={t("Offer {0}", name)} />
                </td>
                <td rowSpan={rowSpan}>
                  <input type="radio" name={`default-variant-${plateId ?? 'model'}`} checked={isDefault} disabled={disabled || !variant.enabled}
                    onChange={onDefault} aria-label={t("Default: {0}", name)} />
                </td>
                <td rowSpan={rowSpan}>
                  <input value={variant.label} disabled={disabled} maxLength={120} onChange={(event) => onChange((current) => ({ ...current, label: event.target.value }))}
                    aria-label={t("Name of {0}", presetsText(variant.presets))} />
                  <small className="muted print-variants__presets" title={presetsText(variant.presets)}>
                    {t("{0} mm nozzle · {1} mm layers · {2}", formatNumber(variant.nozzleMm), formatNumber(variant.layerHeightMm), MATERIAL_LABELS[variant.material])}
                    <br />{presetsText(variant.presets)}
                  </small>
                </td>
              </>
            )}
            <td className={sameScale(point.scale, 1) ? 'print-variants__scale is-original' : 'print-variants__scale'}>
              {scaleName}
              {outside && stored && <small className="muted"> {t("(outside the range)")}</small>}
            </td>
            {stored && measurements ? (
              <>
                <td>
                  <input type="number" min={0.1} step={0.1} value={number(measurements.printMinutes)} disabled={disabled}
                    onChange={(event) => { const printMinutes = event.target.valueAsNumber; setMeasurements(point, (m) => ({ ...m, printMinutes })); }}
                    aria-label={t("Print time of {0} at {1} in minutes", name, scaleName)} />
                  {Number.isFinite(measurements.printMinutes) && (
                    <small className="muted"> {formatDuration(Math.round(measurements.printMinutes), durationUnits())}</small>
                  )}
                </td>
                <td>
                  {measurements.filaments.map((line, index) => (
                    <span key={index} className="input-unit">
                      <input type="number" min={0.01} step={0.01} value={number(line.grams)} disabled={disabled}
                        onChange={(event) => {
                          const grams = event.target.valueAsNumber;
                          setMeasurements(point, (m) => ({ ...m, filaments: m.filaments.map((l, i) => (i === index ? { ...l, grams } : l)) }));
                        }}
                        aria-label={t("Grams of {0} for {1} at {2}", line.material, name, scaleName)} />
                      <span className="muted">{line.material}</span>
                    </span>
                  ))}
                  {sliced && measurementsEdited({ measurements, sliced }) && (
                    <small className="muted print-variants__sliced">
                      {t("Sliced: {0} min, {1} g", formatNumber(sliced.printMinutes), formatNumber(sliced.filaments.reduce((sum, l) => sum + l.grams, 0)))}{' '}
                      <button type="button" className="btn btn--small btn--ghost" disabled={disabled}
                        onClick={() => setMeasurements(point, () => ({ printMinutes: sliced.printMinutes, filaments: structuredClone(sliced.filaments) }))}>
                        {t("Use sliced values")}
                      </button>
                    </small>
                  )}
                </td>
                <td>{price === null || !Number.isFinite(price) ? '—' : formatPrice(price)}</td>
              </>
            ) : (
              <td colSpan={3} className="print-variants__missing">{t("Not sliced at this scale yet: slice again.")}</td>
            )}
            {row === 0 && (
              <td rowSpan={rowSpan}>
                <button type="button" className="icon-btn" disabled={disabled} onClick={onRemove} aria-label={t("Remove {0}", name)}>×</button>
              </td>
            )}
          </tr>
        );
      })}
    </tbody>
  );
}
