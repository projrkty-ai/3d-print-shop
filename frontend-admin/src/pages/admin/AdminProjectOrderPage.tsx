import { t } from '../../i18n';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../../api/client';
import { LoadState } from '../../components/LoadState';
import { PROJECT_ORDER_STATUSES, type PricingSettings, type ProjectOrder, type ProjectOrderStatus } from '../../types';
import { formatPrice } from '../../utils/pricing';
import { CreateProjectProduct } from './CreateProjectProduct';
import { ProjectItems } from './ProjectItems';
import { ProjectReviewEditor } from './ProjectReviewEditor';
import { formatDateTime, PROJECT_STATUS_LABELS, ProjectOrderStatusBadge, SOURCE_LABELS } from './orderDisplay';
import { useAdminData } from './useAdminData';


export function AdminProjectOrderPage() {
  const { orderId = '' } = useParams();
  const { state, setData, reload } = useAdminData(
    async () => Promise.all([api.getProjectOrder(orderId), api.getPricing()]).then(([order, pricing]) => ({ order, pricing })),
    [orderId],
  );

  if (state.status !== 'ready') {
    return (
      <div className="admin">
        <Link to="/admin/project-orders" className="muted">{t("← All project orders")}</Link>
        <LoadState load={state} onRetry={reload} loadingText={t("Loading project order…")} />
      </div>
    );
  }
  const { order, pricing } = state.data;
  return <ProjectOrderDetails key={order.id} order={order} pricing={pricing} onSaved={(saved) => setData({ order: saved, pricing })} />;
}

/** Review screen: the project as the customer chose it, their print preferences, and fulfilment controls. */
function ProjectOrderDetails({ order, pricing, onSaved }: { order: ProjectOrder; pricing: PricingSettings; onSaved: (order: ProjectOrder) => void }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<ProjectOrderStatus>(order.status);
  const [adminNote, setAdminNote] = useState(order.adminNote);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const dirty = status !== order.status || adminNote !== order.adminNote;
  const { customer, project } = order;
  const site = SOURCE_LABELS[project.source];

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      onSaved(await api.updateProjectOrder(order.id, { status, adminNote }));
      setMessage({ kind: 'success', text: t("Project order updated.") });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : t("Could not update the project order.") });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t("Delete project order {0}? This cannot be undone.", order.number))) return;
    setBusy(true);
    try {
      await api.deleteProjectOrder(order.id);
      navigate('/admin/project-orders', { state: { message: t("Deleted project order {0}.", order.number) } });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : t("Could not delete the project order.") });
      setBusy(false);
    }
  }

  return (
    <div className="admin order-detail">
      <div className="admin__header">
        <div>
          <Link to="/admin/project-orders" className="muted">{t("← All project orders")}</Link>
          <h1>{t("Project order")} <span className="mono">{order.number}</span> <ProjectOrderStatusBadge status={order.status} />
          </h1>
          <p className="muted">{t("Placed")} {formatDateTime(order.createdAt)}
            {order.updatedAt !== order.createdAt && t(" · updated {0}", formatDateTime(order.updatedAt))}
          </p>
        </div>
        <div className="admin__header-actions">
          <button type="button" className="btn btn--ghost btn--danger" onClick={() => void remove()} disabled={busy}>{t("Delete project order")}</button>
        </div>
      </div>

      {order.product && (
        <p className={`banner ${order.product.materialsChanged ? 'banner--warning' : 'banner--info'}`}>
          {order.product.materialsChanged
            ? t("Ordered from the ready-to-print product {0} (sets: {1}) with other materials than offered, so it needs a quote.", order.product.title, order.product.sets)
            : t("Ordered from the ready-to-print product {0} ({1} × {2} set price, handling fee once).", order.product.title, order.product.sets,
              formatPrice(order.review ? (order.review.total - order.review.handlingFee) / order.product.sets : 0))}{' '}
          <Link to={`/admin/ready-to-print/${order.product.id}`}>{t("Open product")}</Link>
        </p>
      )}

      {message && (
        <p className={`banner banner--${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}

      <div className="order-detail__layout">
        <div>
          <section className="card">
            <h2>{t("Project")}</h2>
            {!order.projectVerified && (
              <p className="banner banner--warning" role="alert">
                {t("The project could not be fetched from {0} when the order was placed; the details below are the customer's copy. Check the link before quoting.", site)}
              </p>
            )}
            <div className="project-summary">
              <div className="project-summary__thumb">
                {project.thumbnailUrl ? <img src={project.thumbnailUrl} alt="" referrerPolicy="no-referrer" /> : <span aria-hidden="true">◆</span>}
              </div>
              <div>
                <span className={`status-badge source-badge--${project.source}`}>{site}</span>
                <h3 className="project-summary__title">{project.title}</h3>
                {project.author && <p className="muted">{t("by {0}", project.author)}</p>}
                {project.license && <p className="muted">{t("License: {0}", project.license)}</p>}
                {project.description && <p className="project-summary__description">{project.description}</p>}
                <a href={project.url} target="_blank" rel="noopener noreferrer">{t("Open on {0}", site)} ↗</a>
                <div className="muted mono">{t("Project id")}: {project.id}</div>
              </div>
            </div>
          </section>

          <section className="card">
            <h2>{t("Models to print")}</h2>
            <ProjectItems items={order.items} sameSettingsForAll={order.sameSettingsForAll} />
          </section>

          <section className="card">
            <h2>{t("Customer notes")}</h2>
            {order.notes ? <p className="order-detail__note">{order.notes}</p> : <p className="muted">{t("No notes.")}</p>}
          </section>

          <ProjectReviewEditor order={order} pricing={pricing} onSaved={onSaved} />
          <CreateProjectProduct key={order.review?.reviewedAt ?? 'unreviewed'} order={order} />
        </div>

        <aside>
          <section className="card">
            <h2>{t("Customer")}</h2>
            <p className="order-detail__customer">
              <strong>{customer.name}</strong>
              <br />
              <a href={`mailto:${customer.email}`}>{customer.email}</a>
              {customer.phone && (
                <>
                  <br />
                  {customer.phone}
                </>
              )}
            </p>
            <h3>{t("Ship to")}</h3>
            <address>
              {customer.address.line1}
              {customer.address.line2 && (
                <>
                  <br />
                  {customer.address.line2}
                </>
              )}
              <br />
              {customer.address.postalCode} {customer.address.city}
              <br />
              {customer.address.country}
            </address>
          </section>

          <section className="card">
            <h2>{t("Review")}</h2>
            <label className="field">
              <span>{t("Status")}</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as ProjectOrderStatus)}>
                {PROJECT_ORDER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {PROJECT_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("Internal note")}</span>
              <textarea
                rows={4}
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                placeholder={t("Quoted price, print notes… (not shown to the customer)")}
                maxLength={5000}
              />
            </label>
            <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={!dirty || busy}>
              {busy ? t("Saving…") : t("Save changes")}
            </button>
          </section>
        </aside>
      </div>
    </div>
  );
}
