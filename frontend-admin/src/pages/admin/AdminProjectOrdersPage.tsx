import { formatCount, t } from '../../i18n';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { api } from '../../api/client';
import { LoadState } from '../../components/LoadState';
import { PROJECT_ORDER_STATUSES, type ProjectOrder, type ProjectOrderStatus } from '../../types';
import { formatPrice } from '../../utils/pricing';
import { formatDateTime, PROJECT_STATUS_LABELS, ProjectOrderStatusBadge, SOURCE_LABELS } from './orderDisplay';
import { useAdminData } from './useAdminData';

function matches(order: ProjectOrder, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [order.number, order.customer.name, order.customer.email, order.project.title].some((field) => field.toLowerCase().includes(q));
}

/** Requests to print projects from Thingiverse, Printables and MakerWorld, awaiting review and a quote. */
export function AdminProjectOrdersPage() {
  const location = useLocation();
  const flash = (location.state as { message?: string } | null)?.message;
  const [status, setStatus] = useState<ProjectOrderStatus | ''>('');
  const [query, setQuery] = useState('');
  const { state, reload } = useAdminData(() => api.listProjectOrders(status || undefined), [status]);

  const orders = state.status === 'ready' ? state.data.filter((o) => matches(o, query)) : [];
  const awaiting = orders.filter((o) => o.status === 'new').length;

  return (
    <div className="admin">
      <div className="admin__header">
        <div>
          <h1>{t("Project orders")}</h1>
          {state.status === 'ready' && (
            <p className="muted">{formatCount('projectOrder', orders.length)} · {t("{0} awaiting review", awaiting)}</p>
          )}
        </div>
        <div className="admin__header-actions">
          <button type="button" className="btn btn--ghost" onClick={reload}>{t("Refresh")}</button>
        </div>
      </div>

      {flash && (
        <p className="banner banner--success" role="status">
          {flash}
        </p>
      )}

      <div className="admin__filters">
        <input
          type="search"
          className="admin__search"
          placeholder={t("Search by order number, name, email or project…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value as ProjectOrderStatus | '')} aria-label={t("Filter by status")}>
          <option value="">{t("All statuses")}</option>
          {PROJECT_ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PROJECT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {state.status !== 'ready' ? (
        <LoadState load={state} onRetry={reload} loadingText={t("Loading project orders…")} />
      ) : (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Order")}</th>
                <th>{t("Placed")}</th>
                <th>{t("Customer")}</th>
                <th>{t("Project")}</th>
                <th>{t("Models")}</th>
                <th>{t("Prints")}</th>
                <th>{t("Price")}</th>
                <th>{t("Status")}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <Link to={`/admin/project-orders/${order.id}`} className="admin-table__name mono">
                      {order.number}
                    </Link>
                  </td>
                  <td>{formatDateTime(order.createdAt)}</td>
                  <td>
                    {order.customer.name}
                    <div className="muted">{order.customer.email}</div>
                  </td>
                  <td>
                    {order.project.title}
                    <div className="muted">
                      {SOURCE_LABELS[order.project.source]}{!order.projectVerified && ` · ${t("unverified")}`}{order.product && ` · ${t("ready to print")}`}
                    </div>
                  </td>
                  <td>{order.items.some((item) => item.file) ? order.items.length : t("Whole project")}</td>
                  <td>{order.items.reduce((sum, item) => sum + item.settings.quantity, 0)}</td>
                  <td>
                    {order.review ? formatPrice(order.review.total) : <span className="muted">{t("quote needed")}</span>}
                    <div className="muted">{order.requiresQuote ? t("quote") : t("fixed price")}</div>
                  </td>
                  <td>
                    <ProjectOrderStatusBadge status={order.status} />
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted admin-table__empty">
                    {state.data.length === 0 ? t("No project orders yet.") : t("No project orders match your search.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
