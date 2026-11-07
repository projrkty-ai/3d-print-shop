import { t } from '../../i18n';
import { useState } from 'react';
import { ApiError } from '../../api/client';
import { PRINT_MATERIALS, type PricingSettings, type PrintMaterial, type ProjectPricing, type ProjectReviewInput } from '../../types';
import { formatPrice } from '../../utils/pricing';
import { priceProject } from '../../utils/projectPricing';
import { formatDateTime, MATERIAL_LABELS } from './orderDisplay';
import { PricingBreakdown } from './PricingBreakdown';

type Row = { material: PrintMaterial; grams: string };

interface Props {
  /** Saved measurements, or null to start from `suggestedMaterials`. */
  initial: ProjectReviewInput | null;
  suggestedMaterials?: PrintMaterial[];
  /** The shop's current rates: every price shown here is calculated with them. */
  pricing: PricingSettings;
  /** A stored price (an order's quote) to compare with; products have none, their price is always current. */
  saved?: { pricing: ProjectPricing; at: string };
  saveLabel: string;
  successText: string;
  /** Show the price only for unsaved changes (when the page shows the saved price elsewhere). */
  previewChangesOnly?: boolean;
  onSave: (measurements: ProjectReviewInput) => Promise<unknown>;
}

/** Print time and filament used per material, with the price they give at the current rates. */
export function MeasurementsForm({ initial, suggestedMaterials = [], pricing, saved, saveLabel, successText, previewChangesOnly = false, onSave }: Props) {
  const [hours, setHours] = useState(initial ? String(Math.floor(initial.printMinutes / 60)) : '');
  const [minutes, setMinutes] = useState(initial ? String(initial.printMinutes % 60) : '');
  const [rows, setRows] = useState<Row[]>(() => initial
    ? initial.filaments.map((line) => ({ material: line.material, grams: String(line.grams) }))
    : (suggestedMaterials.length > 0 ? suggestedMaterials : (['PLA'] as PrintMaterial[])).map((material) => ({ material, grams: '' })));
  const [stored, setStored] = useState(initial ? JSON.stringify(initial) : null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const number = (value: string) => (value.trim() === '' ? NaN : Number(value.replace(',', '.')));
  const printMinutes = Math.round((Number.isFinite(number(hours)) ? number(hours) : 0) * 60 + (Number.isFinite(number(minutes)) ? number(minutes) : 0));
  const timeValid = (hours.trim() !== '' || minutes.trim() !== '')
    && [hours, minutes].every((value) => value.trim() === '' || (Number.isInteger(number(value)) && number(value) >= 0));
  const rowsValid = rows.length > 0 && rows.every((row) => Number.isFinite(number(row.grams)) && number(row.grams) > 0);
  const input: ProjectReviewInput = { printMinutes, filaments: rows.map((row) => ({ material: row.material, grams: number(row.grams) })) };
  const preview = timeValid && rowsValid ? priceProject(input, pricing) : null;
  const changed = stored !== JSON.stringify(input);
  const ratesChanged = Boolean(saved && (saved.pricing.hourlyRate !== pricing.hourlyRate || saved.pricing.handlingFee !== pricing.handlingFee
    || saved.pricing.filaments.some((line) => line.pricePerKg !== pricing.filamentPricePerKg[line.material])));

  const setRow = (index: number, patch: Partial<Row>) => setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await onSave(input);
      setStored(JSON.stringify(input));
      setMessage({ kind: 'success', text: successText });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? [err.message, ...err.details].join(' ') : t("Could not save the price review.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="measurements">
      <fieldset className="project-review__time">
        <legend>{t("Print time")}</legend>
        <label className="field">
          <span>{t("Hours")}</span>
          <input type="number" min={0} step={1} value={hours} onChange={(e) => setHours(e.target.value)} aria-label={t("Print time, hours")} />
        </label>
        <label className="field">
          <span>{t("Minutes")}</span>
          <input type="number" min={0} step={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label={t("Print time, minutes")} />
        </label>
      </fieldset>

      <fieldset className="project-review__filaments">
        <legend>{t("Filament used")}</legend>
        {rows.map((row, index) => (
          <div key={index} className="project-review__row">
            <select value={row.material} onChange={(e) => setRow(index, { material: e.target.value as PrintMaterial })} aria-label={t("Material {0}", index + 1)}>
              {PRINT_MATERIALS.map((material) => <option key={material} value={material}>{MATERIAL_LABELS[material]}</option>)}
            </select>
            <span className="input-unit">
              <input type="number" min={0} step="0.1" inputMode="decimal" value={row.grams} onChange={(e) => setRow(index, { grams: e.target.value })}
                aria-label={t("Grams of {0}", row.material)} />
              <span className="muted">g</span>
            </span>
            <button type="button" className="icon-btn" aria-label={t("Remove {0}", row.material)} disabled={rows.length === 1}
              onClick={() => setRows(rows.filter((_, i) => i !== index))}>×</button>
          </div>
        ))}
        <button type="button" className="btn btn--small btn--ghost"
          onClick={() => setRows([...rows, { material: PRINT_MATERIALS.find((m) => !rows.some((row) => row.material === m)) ?? 'PLA', grams: '' }])}>
          {t("+ Add material")}
        </button>
      </fieldset>

      {previewChangesOnly && !changed ? null : preview ? (
        <PricingBreakdown pricing={preview} caption={saved && !changed && !ratesChanged ? t("Saved price") : t("Price with the current rates")} />
      ) : (
        <p className="muted">{t("Enter the print time and the weight of every material to see the price.")}</p>
      )}
      {saved && (
        <p className="muted">
          {t("Saved {0}: {1}.", formatDateTime(saved.at), formatPrice(saved.pricing.total))}
          {ratesChanged && !changed && ` ${t("The rates changed since; saving again reprices it.")}`}
        </p>
      )}
      {message && <p className={`banner banner--${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
      <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={busy || !preview || (!changed && !ratesChanged)}>
        {busy ? t("Saving…") : saveLabel}
      </button>
    </div>
  );
}
