import { t } from '../../i18n';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../../api/client';
import { LoadState } from '../../components/LoadState';
import { CURRENCY } from '../../config';
import { PRINT_MATERIALS, type PricingSettings } from '../../types';
import { formatDateTime, MATERIAL_LABELS } from './orderDisplay';
import { AdminPrintOptionsPage } from './AdminPrintOptionsPage';
import { useAdminData } from './useAdminData';
import { useProducts } from '../../store/ProductsContext';

export function AdminPricingPage() {
  return (
    <div className="pricing-page">
      <PricingRates />
      <AdminPrintOptionsPage />
    </div>
  );
}

/** Shop-wide rates for pricing project orders: one place, not per order. */
function PricingRates() {
  const { state, setData, reload } = useAdminData(() => api.getPricing(), []);
  if (state.status !== 'ready') return <div className="admin"><h1>{t("Pricing")}</h1><LoadState load={state} onRetry={reload} loadingText={t("Loading pricing…")} /></div>;
  // Not keyed by the saved data: after saving, the form already shows it and keeps its confirmation.
  return <PricingForm settings={state.data} onSaved={setData} />;
}

type Draft = { hourlyRate: string; handlingFee: string; filamentPricePerKg: Record<string, string> };
const toDraft = (settings: PricingSettings): Draft => ({
  hourlyRate: String(settings.hourlyRate),
  handlingFee: String(settings.handlingFee),
  filamentPricePerKg: Object.fromEntries(PRINT_MATERIALS.map((material) => [material, String(settings.filamentPricePerKg[material])])),
});

function PricingForm({ settings, onSaved }: { settings: PricingSettings; onSaved: (settings: PricingSettings) => void }) {
  const { reload: reloadProducts } = useProducts();
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const amount = (value: string) => Number(value.replace(',', '.'));
  const valid = [draft.hourlyRate, draft.handlingFee, ...Object.values(draft.filamentPricePerKg)]
    .every((value) => value.trim() !== '' && Number.isFinite(amount(value)) && amount(value) >= 0);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const saved = await api.savePricing({
        hourlyRate: amount(draft.hourlyRate),
        handlingFee: amount(draft.handlingFee),
        filamentPricePerKg: Object.fromEntries(PRINT_MATERIALS.map((material) => [material, amount(draft.filamentPricePerKg[material])])) as PricingSettings['filamentPricePerKg'],
      });
      onSaved(saved);
      void reloadProducts();
      setMessage({ kind: 'success', text: t("Pricing saved. Ready-to-print prices and new quotes use these rates.") });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? [err.message, ...err.details].join(' ') : t("Could not save the pricing.") });
    } finally {
      setBusy(false);
    }
  }

  const money = (label: string, value: string, onChange: (value: string) => void, unit: string) => (
    <label className="field">
      <span>{label}</span>
      <span className="input-unit">
        <input type="number" min={0} step="0.01" inputMode="decimal" required value={value} onChange={(e) => onChange(e.target.value)} />
        <span className="muted">{unit}</span>
      </span>
    </label>
  );

  return (
    <form className="admin pricing-settings" onSubmit={(e) => void save(e)}>
      <div className="admin__header">
        <div>
          <h1>{t("Pricing")}</h1>
          <p className="muted">{t("Catalog and ready-to-print prices follow these rates. Placed orders keep their prices.")}</p>
          <p className="muted">{t("Catalog prices use the current Pricing rates: estimated weight = volume × 1.3 g/cm³ × 30%; estimated print time = weight ÷ 20 g/hour. Handling is charged once per order.")}</p>
          <p className="muted">
            {t("Project orders are priced as handling fee + print time × hourly rate + filament used × price per kilogram.")}
            {' '}
            {settings.updatedAt ? t("Last saved {0}.", formatDateTime(settings.updatedAt)) : t("Default rates — save to set your own.")}
          </p>
        </div>
      </div>
      {message && <p className={`banner banner--${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}

      <section className="card">
        <h2>{t("Printing")}</h2>
        <div className="pricing-settings__grid">
          {money(t("Printer hourly rate"), draft.hourlyRate, (hourlyRate) => setDraft({ ...draft, hourlyRate }), t("{0} per hour", CURRENCY))}
          {money(t("Handling fee per order"), draft.handlingFee, (handlingFee) => setDraft({ ...draft, handlingFee }), CURRENCY)}
        </div>
      </section>

      <section className="card">
        <h2>{t("Filament prices")}</h2>
        <div className="pricing-settings__grid">
          {PRINT_MATERIALS.map((material) => (
            <div key={material}>
              {money(MATERIAL_LABELS[material], draft.filamentPricePerKg[material],
                (value) => setDraft({ ...draft, filamentPricePerKg: { ...draft.filamentPricePerKg, [material]: value } }), t("{0} per kg", CURRENCY))}
            </div>
          ))}
        </div>
      </section>

      <p className="muted">{t("Ready-to-print prices follow these rates at once. Placed orders keep their price; quotes are repriced only when you save the review again.")}</p>
      <button type="submit" className="btn btn--primary" disabled={busy || !valid}>{busy ? t("Saving…") : t("Save pricing")}</button>
    </form>
  );
}
