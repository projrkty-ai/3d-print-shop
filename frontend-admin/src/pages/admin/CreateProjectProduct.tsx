import { t } from '../../i18n';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '../../api/client';
import type { ProjectOrder, ProjectProduct } from '../../types';
import { formatPrice } from '../../utils/pricing';

/** Offers the reviewed project in the shop's "Ready to print" tab at the reviewed price. */
export function CreateProjectProduct({ order }: { order: ProjectOrder }) {
  const [title, setTitle] = useState(order.project.title);
  const [description, setDescription] = useState(order.project.description);
  const [published, setPublished] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ProjectProduct | null>(null);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setCreated(await api.createProjectProduct({ orderId: order.id, title: title.trim(), description: description.trim(), published }));
    } catch (err) {
      setError(err instanceof ApiError ? [err.message, ...err.details].join(' ') : t("Could not create the product."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>{t("Ready-to-print product")}</h2>
      {!order.review ? (
        <p className="muted">{t("Save a price review first: the product is offered at the reviewed price.")}</p>
      ) : created ? (
        <div className="banner banner--success" role="status">
          {t("Created “{0}” for {1}.", created.title, formatPrice(created.pricing.total))}{' '}
          <Link to={`/admin/ready-to-print/${created.id}`}>{t("Open product")}</Link>
        </div>
      ) : (
        <form onSubmit={(e) => void create(e)}>
          <p className="muted">{t("Offer these models, printed as reviewed, to every customer. The product keeps this print time and filament; its price always follows the current rates.")}</p>
          <label className="field">
            <span>{t("Title")}</span>
            <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            <span>{t("Description")}</span>
            <textarea rows={3} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
            {t("Publish in the shop now")}
          </label>
          {error && <p className="banner banner--error" role="alert">{error}</p>}
          <button type="submit" className="btn btn--primary" disabled={busy || !title.trim()}>{busy ? t("Creating…") : t("Create product")}</button>
        </form>
      )}
    </section>
  );
}
