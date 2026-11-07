import { formatNumber, t } from '../../i18n';
import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { api, ApiError } from '../../api/client';
import { LoadState } from '../../components/LoadState';
import type { FilamentColor, FilamentType, LayerHeightOption, NozzleOption, PrintSettings } from '../../types';
import { createId, uniqueSlug } from '../../utils/ids';
import { layerFitsNozzle, layerHeightRange } from '../../utils/printEstimate';
import { formatPrice } from '../../utils/pricing';
import { useAdminData } from './useAdminData';

type Editable = Omit<PrintSettings, 'updatedAt'>;

/**
 * Items added in this session get a temporary id; saving replaces it with one derived from the name.
 * Slugs never contain "~", so saved ids can't be mistaken for temporary ones.
 */
const NEW_ID = '~new-';
const isNew = (id: string) => id.startsWith(NEW_ID);
const HEX = /^#[0-9a-f]{6}$/i;
/** Volume of the example model used to show what a filament costs. */
const EXAMPLE_CM3 = 100;

function NumberInput({ value, onChange, ...rest }: { value: number; onChange: (value: number) => void } & Omit<
  InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'
>) {
  return (
    <input type="number" value={Number.isNaN(value) ? '' : value} onChange={(e) => onChange(e.target.valueAsNumber)} {...rest} />
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="field__help">{hint}</small>}
    </label>
  );
}

const editable = ({ updatedAt: _updatedAt, ...settings }: PrintSettings): Editable => settings;

/** Sizes as slicers show them: nozzles "0.4 mm", layer heights "0.20 mm". */
const millimeters = (value: number, minimumFractionDigits = 1) =>
  Number.isFinite(value) ? `${formatNumber(value, { minimumFractionDigits, maximumFractionDigits: 3 })} mm` : '–';

/** Gives new entries readable ids (e.g. `nozzle-0-6`, `layer-0-24`, `petg-cf`) that don't collide. */
function withFinalIds(settings: Editable): Editable {
  const slugs = <T extends { id: string }>(items: T[], label: (item: T) => string): T[] => {
    const taken = items.filter((item) => !isNew(item.id)).map((item) => item.id);
    return items.map((item) => {
      if (!isNew(item.id)) return item;
      const id = uniqueSlug(label(item), taken);
      taken.push(id);
      return { ...item, id };
    });
  };
  const finalId = <T extends { id: string }>(before: T[], after: T[], id: string) => after[before.findIndex((item) => item.id === id)]?.id ?? id;
  const nozzles = slugs(settings.nozzles, (n) => `nozzle ${n.diameterMm}`);
  const layerHeights = slugs(settings.layerHeights, (l) => `layer ${l.heightMm}`);
  return {
    nozzles,
    defaultNozzleId: finalId(settings.nozzles, nozzles, settings.defaultNozzleId),
    layerHeights,
    defaultLayerHeightId: finalId(settings.layerHeights, layerHeights, settings.defaultLayerHeightId),
    filaments: slugs(settings.filaments, (f) => f.name || 'filament')
      .map((filament) => ({ ...filament, colors: slugs(filament.colors, (c) => c.name || 'color') })),
  };
}

/** Blank fields the server can't read as numbers; the server checks the remaining rules. */
function missingNumbers(settings: Editable): string[] {
  const problems: string[] = [];
  settings.nozzles.forEach((n, i) => {
    if (!Number.isFinite(n.diameterMm)) problems.push(t("Nozzle #{0}: enter the diameter.", i + 1));
    if (!Number.isFinite(n.priceMultiplier)) problems.push(t("{0}: enter the price multiplier.", t("Nozzle {0}", millimeters(n.diameterMm))));
  });
  settings.layerHeights.forEach((l, i) => {
    if (!Number.isFinite(l.heightMm)) problems.push(t("Layer height #{0}: enter the height.", i + 1));
    if (!Number.isFinite(l.priceMultiplier)) problems.push(t("{0}: enter the price multiplier.", t("Layer height {0}", millimeters(l.heightMm, 2))));
  });
  settings.filaments.forEach((f, i) => {
    const name = f.name || t("Filament #{0}", i + 1);
    if (!Number.isFinite(f.pricePerKg)) problems.push(t("{0}: enter the price per kilogram.", name));
    if (!Number.isFinite(f.densityGPerCm3)) problems.push(t("{0}: enter the density.", name));
  });
  return problems;
}

const fits = (layer: LayerHeightOption, nozzle: NozzleOption) =>
  Number.isFinite(layer.heightMm) && Number.isFinite(nozzle.diameterMm) && layerFitsNozzle(layer.heightMm, nozzle.diameterMm);

/** Nozzles, layer heights and filaments customers choose from for prints of their own models. */
export function AdminPrintOptionsPage() {
  const { state, setData, reload } = useAdminData(() => api.getPrintSettings(), []);
  if (state.status !== 'ready') {
    return (
      <div className="admin">
        <h2>{t("Print options")}</h2>
        <LoadState load={state} onRetry={reload} loadingText={t("Loading print options…")} />
      </div>
    );
  }
  // Not keyed by the saved version: the editor takes the saved result over itself, keeping its success message.
  return <PrintOptionsEditor saved={state.data} onSaved={setData} />;
}

function PrintOptionsEditor({ saved, onSaved }: { saved: PrintSettings; onSaved: (settings: PrintSettings) => void }) {
  const [draft, setDraft] = useState<Editable>(() => editable(saved));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string; details?: string[] } | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(editable(saved));
  const defaultNozzle = draft.nozzles.find((n) => n.id === draft.defaultNozzleId);
  const defaultLayer = draft.layerHeights.find((l) => l.id === draft.defaultLayerHeightId);
  const defaultMultiplier = (defaultNozzle?.priceMultiplier ?? 1) * (defaultLayer?.priceMultiplier ?? 1);
  const defaultsFit = !defaultNozzle || !defaultLayer || fits(defaultLayer, defaultNozzle);

  const setNozzle = (id: string, patch: Partial<NozzleOption>) =>
    setDraft((d) => ({ ...d, nozzles: d.nozzles.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  const setLayer = (id: string, patch: Partial<LayerHeightOption>) =>
    setDraft((d) => ({ ...d, layerHeights: d.layerHeights.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const setFilament = (id: string, patch: Partial<FilamentType>) =>
    setDraft((d) => ({ ...d, filaments: d.filaments.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
  const setColor = (filament: FilamentType, id: string, patch: Partial<FilamentColor>) =>
    setFilament(filament.id, { colors: filament.colors.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

  function addNozzle() {
    setDraft((d) => ({ ...d, nozzles: [...d.nozzles, { id: createId('~new'), diameterMm: NaN, priceMultiplier: 1 }] }));
  }
  function removeNozzle(id: string) {
    setDraft((d) => {
      const nozzles = d.nozzles.filter((n) => n.id !== id);
      return { ...d, nozzles, defaultNozzleId: d.defaultNozzleId === id ? (nozzles[0]?.id ?? '') : d.defaultNozzleId };
    });
  }
  function addLayer() {
    setDraft((d) => ({ ...d, layerHeights: [...d.layerHeights, { id: createId('~new'), heightMm: NaN, priceMultiplier: 1 }] }));
  }
  function removeLayer(id: string) {
    setDraft((d) => {
      const layerHeights = d.layerHeights.filter((l) => l.id !== id);
      return { ...d, layerHeights, defaultLayerHeightId: d.defaultLayerHeightId === id ? (layerHeights[0]?.id ?? '') : d.defaultLayerHeightId };
    });
  }
  function addFilament() {
    const filament: FilamentType = {
      id: createId('~new'), name: '', description: '', pricePerKg: NaN, densityGPerCm3: 1.24,
      colors: [{ id: createId('~new'), name: t("Black"), hex: '#1c1c1e' }],
    };
    setDraft((d) => ({ ...d, filaments: [...d.filaments, filament] }));
  }

  async function save() {
    const problems = missingNumbers(draft);
    if (problems.length > 0) {
      setMessage({ kind: 'error', text: t("The print options have problems."), details: problems });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.updatePrintSettings(withFinalIds(draft));
      onSaved(result);
      setDraft(editable(result));
      setMessage({ kind: 'success', text: t("Print options saved. New print requests use them; placed requests keep their prices.") });
    } catch (err) {
      setMessage(err instanceof ApiError
        ? { kind: 'error', text: err.message, details: err.details }
        : { kind: 'error', text: t("Could not save the print options.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin print-settings">
      <div className="admin__header">
        <div>
          <h2>{t("Print options")}</h2>
          <p className="muted">
            {t("What customers choose for prints of their own models: a nozzle, a layer height, and a filament type and color for each color of the model. Customers see only the resulting price: the model's weight (volume × density) × price per kilogram × the nozzle's and layer height's multipliers.")}
          </p>
        </div>
        <div className="admin__header-actions">
          <button type="button" className="btn btn--ghost" disabled={!dirty || busy} onClick={() => setDraft(editable(saved))}>{t("Discard changes")}</button>
          <button type="button" className="btn btn--primary" disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? t("Saving…") : t("Save changes")}
          </button>
        </div>
      </div>

      {message && (
        <div className={`banner banner--${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.details?.length ? <strong>{message.text}</strong> : message.text}
          {message.details && message.details.length > 0 && (
            <ul>{message.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
          )}
        </div>
      )}

      <section className="card">
        <div className="card__header">
          <h2>{t("Nozzle diameters")}</h2>
          <button type="button" className="btn btn--small" onClick={addNozzle}>{t("+ Add nozzle")}</button>
        </div>
        <p className="muted card__intro">{t("Each nozzle prints layer heights from a quarter to 0.8 × its diameter; customers are only offered those. The multiplier is applied to the filament price (smaller nozzles print slower).")}</p>
        <div className="table-wrap">
          <table className="option-table" data-testid="nozzles">
            <thead>
              <tr>
                <th>{t("Default")}</th>
                <th>{t("Diameter (mm)")}</th>
                <th>{t("Price multiplier")}</th>
                <th>{t("Layer heights it can print")}</th>
                <th aria-label={t("Remove")} />
              </tr>
            </thead>
            <tbody>
              {draft.nozzles.map((nozzle) => {
                const range = layerHeightRange(nozzle.diameterMm);
                const usable = draft.layerHeights.filter((l) => fits(l, nozzle)).sort((a, b) => a.heightMm - b.heightMm);
                const label = millimeters(nozzle.diameterMm);
                return (
                  <tr key={nozzle.id}>
                    <td>
                      <input type="radio" name="default-nozzle" checked={draft.defaultNozzleId === nozzle.id}
                        onChange={() => setDraft((d) => ({ ...d, defaultNozzleId: nozzle.id }))}
                        aria-label={t("Default nozzle: {0}", label)} />
                    </td>
                    <td>
                      <NumberInput min={0.1} max={2} step={0.1} value={nozzle.diameterMm}
                        onChange={(diameterMm) => setNozzle(nozzle.id, { diameterMm })} aria-label={t("Diameter of nozzle {0}", label)} />
                    </td>
                    <td>
                      <NumberInput min={0.1} max={10} step={0.05} value={nozzle.priceMultiplier}
                        onChange={(priceMultiplier) => setNozzle(nozzle.id, { priceMultiplier })} aria-label={t("Price multiplier of nozzle {0}", label)} />
                    </td>
                    <td className="print-settings__fit">
                      {!Number.isFinite(nozzle.diameterMm) ? '–' : (
                        <>
                          <span className="muted">{millimeters(range.min, 2)} – {millimeters(range.max, 2)}: </span>
                          {usable.length > 0
                            ? usable.map((l) => millimeters(l.heightMm, 2)).join(', ')
                            : <span className="print-settings__warning">{t("none — add a layer height in this range")}</span>}
                        </>
                      )}
                    </td>
                    <td>
                      <button type="button" className="icon-btn" aria-label={t("Remove nozzle {0}", label)} onClick={() => removeNozzle(nozzle.id)}>
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card__header">
          <h2>{t("Layer heights")}</h2>
          <button type="button" className="btn btn--small" onClick={addLayer}>{t("+ Add layer height")}</button>
        </div>
        <p className="muted card__intro">{t("Thinner layers give smoother surfaces but take longer: the multiplier is applied to the filament price. The defaults are preselected for customers; the default layer height must suit the default nozzle.")}</p>
        {!defaultsFit && (
          <p className="banner banner--warning">{t("The default layer height doesn't suit the default nozzle. Choose defaults that fit.")}</p>
        )}
        <div className="table-wrap">
          <table className="option-table" data-testid="layers">
            <thead>
              <tr>
                <th>{t("Default")}</th>
                <th>{t("Height (mm)")}</th>
                <th>{t("Price multiplier")}</th>
                <th>{t("Nozzles that can print it")}</th>
                <th aria-label={t("Remove")} />
              </tr>
            </thead>
            <tbody>
              {draft.layerHeights.map((layer) => {
                const nozzles = draft.nozzles.filter((n) => fits(layer, n)).sort((a, b) => a.diameterMm - b.diameterMm);
                const label = millimeters(layer.heightMm, 2);
                return (
                  <tr key={layer.id}>
                    <td>
                      <input type="radio" name="default-layer" checked={draft.defaultLayerHeightId === layer.id}
                        onChange={() => setDraft((d) => ({ ...d, defaultLayerHeightId: layer.id }))}
                        aria-label={t("Default layer height: {0}", label)} />
                    </td>
                    <td>
                      <NumberInput min={0.02} max={1.6} step={0.02} value={layer.heightMm}
                        onChange={(heightMm) => setLayer(layer.id, { heightMm })} aria-label={t("Height of layer {0}", label)} />
                    </td>
                    <td>
                      <NumberInput min={0.1} max={10} step={0.05} value={layer.priceMultiplier}
                        onChange={(priceMultiplier) => setLayer(layer.id, { priceMultiplier })} aria-label={t("Price multiplier of layer {0}", label)} />
                    </td>
                    <td className="print-settings__fit">
                      {!Number.isFinite(layer.heightMm) ? '–' : nozzles.length > 0
                        ? nozzles.map((n) => millimeters(n.diameterMm)).join(', ')
                        : <span className="print-settings__warning">{t("none — never offered")}</span>}
                    </td>
                    <td>
                      <button type="button" className="icon-btn" aria-label={t("Remove layer height {0}", label)} onClick={() => removeLayer(layer.id)}>
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card__header">
          <h2>{t("Filament types")}</h2>
          <button type="button" className="btn btn--small" onClick={addFilament}>{t("+ Add filament type")}</button>
        </div>
        <p className="muted card__intro">{t("Price per kilogram is what the shop charges for printed filament; the density converts the model's volume to weight. Customers see only the resulting prices.")}</p>
        <div className="filament-editors">
          {draft.filaments.map((filament) => {
            const example = (EXAMPLE_CM3 * filament.densityGPerCm3 / 1000) * filament.pricePerKg * defaultMultiplier;
            return (
              <article key={filament.id} className="filament-editor" aria-label={filament.name || t("New filament type")}>
                <div className="filament-editor__header">
                  <h3>{filament.name || t("New filament type")}</h3>
                  <button type="button" className="btn btn--small btn--ghost btn--danger"
                    onClick={() => setDraft((d) => ({ ...d, filaments: d.filaments.filter((f) => f.id !== filament.id) }))}>
                    {t("Remove filament type")}
                  </button>
                </div>
                <div className="form-grid">
                  <Field label={t("Name")}>
                    <input value={filament.name} onChange={(e) => setFilament(filament.id, { name: e.target.value })} placeholder="PLA" />
                  </Field>
                  <Field label={t("Price per kilogram (USD)")}>
                    <NumberInput min={0} step={1} value={filament.pricePerKg}
                      onChange={(pricePerKg) => setFilament(filament.id, { pricePerKg })} />
                  </Field>
                  <Field label={t("Density (g/cm³)")} hint={t("PLA 1.24, PETG 1.27, ABS 1.04, TPU 1.21")}>
                    <NumberInput min={0.5} max={3} step={0.01} value={filament.densityGPerCm3}
                      onChange={(densityGPerCm3) => setFilament(filament.id, { densityGPerCm3 })} />
                  </Field>
                </div>
                <Field label={t("Description for customers")}>
                  <input value={filament.description} maxLength={300}
                    onChange={(e) => setFilament(filament.id, { description: e.target.value })} placeholder={t("Tough and heat resistant")} />
                </Field>
                <p className="muted">
                  {Number.isFinite(example)
                    ? t("A {0} cm³ model costs ≈ {1} in this filament with the defaults (nozzle {2}, layers {3}).", EXAMPLE_CM3, formatPrice(example),
                      millimeters(defaultNozzle?.diameterMm ?? NaN), millimeters(defaultLayer?.heightMm ?? NaN, 2))
                    : t("Enter the price and density to see an example price.")}
                </p>
                <table className="option-table filament-editor__colors">
                  <thead>
                    <tr>
                      <th>{t("Color")}</th>
                      <th>{t("Name")}</th>
                      <th>{t("Hex")}</th>
                      <th aria-label={t("Remove")} />
                    </tr>
                  </thead>
                  <tbody>
                    {filament.colors.map((color) => (
                      <tr key={color.id}>
                        <td>
                          <input type="color" value={HEX.test(color.hex) ? color.hex : '#000000'}
                            onChange={(e) => setColor(filament, color.id, { hex: e.target.value })}
                            aria-label={t("Pick {0}", color.name || t('color'))} />
                        </td>
                        <td>
                          <input value={color.name} onChange={(e) => setColor(filament, color.id, { name: e.target.value })}
                            aria-label={t("Color name")} />
                        </td>
                        <td>
                          <input value={color.hex} className="mono" maxLength={7} aria-label={t("Hex code of {0}", color.name)}
                            onChange={(e) => setColor(filament, color.id, { hex: e.target.value.trim() })} />
                        </td>
                        <td>
                          <button type="button" className="icon-btn" aria-label={t("Remove color {0}", color.name)}
                            onClick={() => setFilament(filament.id, { colors: filament.colors.filter((c) => c.id !== color.id) })}>
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button type="button" className="btn btn--small"
                  onClick={() => setFilament(filament.id, { colors: [...filament.colors, { id: createId('~new'), name: '', hex: '#808080' }] })}>
                  {t("+ Add color")}
                </button>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
