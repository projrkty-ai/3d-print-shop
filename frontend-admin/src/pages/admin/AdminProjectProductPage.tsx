import { t } from '../../i18n';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../../api/client';
import { LoadState } from '../../components/LoadState';
import type { PricingSettings, ProjectProduct } from '../../types';
import { MeasurementsForm } from './MeasurementsForm';
import { SOURCE_LABELS } from './orderDisplay';
import { PricingBreakdown } from './PricingBreakdown';
import { ProjectItems } from './ProjectItems';
import { useAdminData } from './useAdminData';

export function AdminProjectProductPage() {
  const { productId = '' } = useParams();
  const { state, setData, reload } = useAdminData(
    async () => Promise.all([api.getProjectProduct(productId), api.getPricing()]).then(([product, pricing]) => ({ product, pricing })),
    [productId],
  );
  if (state.status !== 'ready') {
    return (
      <div className="admin">
        <Link to="/admin/ready-to-print" className="muted">{t("← All ready-to-print products")}</Link>
        <LoadState load={state} onRetry={reload} loadingText={t("Loading product…")} />
      </div>
    );
  }
  const { product, pricing } = state.data;
  return <ProjectProductEditor key={product.id} product={product} pricing={pricing} onSaved={(saved) => setData({ product: saved, pricing })} />;
}

/** Title, description, publication and the measurements are editable; the price always follows the current rates. */
function ProjectProductEditor({ product, pricing, onSaved }: { product: ProjectProduct; pricing: PricingSettings; onSaved: (product: ProjectProduct) => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState(product.title);
  const [description, setDescription] = useState(product.description);
  const [published, setPublished] = useState(product.published);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const dirty = title !== product.title || description !== product.description || published !== product.published;
  const site = SOURCE_LABELS[product.project.source];

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      onSaved(await api.updateProjectProduct(product.id, { title: title.trim(), description: description.trim(), published }));
      setMessage({ kind: 'success', text: t("Product saved.") });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? [err.message, ...err.details].join(' ') : t("Could not save the product.") });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t("Delete \"{0}\"? This cannot be undone.", product.title))) return;
    setBusy(true);
    try {
      await api.deleteProjectProduct(product.id);
      navigate('/admin/ready-to-print');
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : t("Could not delete the product.") });
      setBusy(false);
    }
  }

  return (
    <div className="admin order-detail">
      <div className="admin__header">
        <div>
          <Link to="/admin/ready-to-print" className="muted">{t("← All ready-to-print products")}</Link>
          <h1>{product.title}</h1>
          <p className="muted">
            {site} · {t("made from")} <Link to={`/admin/project-orders/${product.sourceOrder.id}`} className="mono">{product.sourceOrder.number}</Link>
          </p>
        </div>
        <div className="admin__header-actions">
          <button type="button" className="btn btn--ghost btn--danger" onClick={() => void remove()} disabled={busy}>{t("Delete product")}</button>
        </div>
      </div>
      {message && <p className={`banner banner--${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}

      <div className="order-detail__layout">
        <div>
          <form className="card" onSubmit={(e) => void save(e)}>
            <h2>{t("Shop listing")}</h2>
            <label className="field">
              <span>{t("Title")}</span>
              <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field">
              <span>{t("Description")}</span>
              <textarea rows={4} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <label className="checkbox-field">
              <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
              {t("Published in the shop")}
            </label>
            <button type="submit" className="btn btn--primary" disabled={!dirty || busy || !title.trim()}>{busy ? t("Saving…") : t("Save changes")}</button>
          </form>
          <section className="card project-review">
            <h2>{t("Print time and filament for one set")}</h2>
            <MeasurementsForm
              initial={product.measurements}
              pricing={pricing}
              saveLabel={t("Save print time and filament")}
              successText={t("Saved. The shop shows the new price.")}
              previewChangesOnly
              onSave={async (measurements) => onSaved(await api.updateProjectProduct(product.id, { measurements }))}
            />
          </section>
          <section className="card">
            <h2>{t("Models to print")}</h2>
            <ProjectItems items={product.items} sameSettingsForAll={false} />
          </section>
        </div>
        <aside>
          <section className="card">
            <h2>{t("Current price for one set")}</h2>
            <PricingBreakdown pricing={product.pricing} />
            <p className="muted">{t("Calculated from the print time and filament below with the current rates. Customers ordering several sets pay the handling fee once.")}</p>
            <a href={product.project.url} target="_blank" rel="noopener noreferrer">{t("Open on {0}", site)} ↗</a>
          </section>
        </aside>
      </div>
    </div>
  );
}
