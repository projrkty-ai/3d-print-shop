import { formatCount, t } from '../../i18n';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { api } from '../../api/client';
import { LoadState } from '../../components/LoadState';
import { CUSTOM_ORDER_STATUSES, type CustomOrder, type CustomOrderStatus } from '../../types';
import { CustomOrderStatusBadge, CUSTOM_STATUS_LABELS, formatQuote, totalCopies } from './customOrderDisplay';
import { formatDateTime } from './orderDisplay';
import { useAdminData } from './useAdminData';

function matches(order: CustomOrder, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [order.number, order.customer.name, order.customer.email, ...order.files.map((file) => file.fileName)]
    .some((field) => field.toLowerCase().includes(q));
}

/** Print requests for customers' own models, newest first; new ones wait for the shop's review. */
export function AdminCustomOrdersPage() {
  const location = useLocation();
  const flash = (location.state as { message?: string } | null)?.message;
  const [status, setStatus] = useState<CustomOrderStatus | ''>('');
  const [query, setQuery] = useState('');
  const { state, reload } = useAdminData(() => api.listCustomOrders(status || undefined), [status]);

  const orders = state.status === 'ready' ? state.data.filter((o) => matches(o, query)) : [];
  const awaiting = orders.filter((o) => o.status === 'submitted').length;

  return (
    <div className="admin">
      <div className="admin__header">
        <div>
          <h1>{t("Print requests")}</h1>
          <p className="muted">{t("Customers' own STL and 3MF models. Review each request, then approve it with a price or reject it.")}</p>
          {state.status === 'ready' && (
            <p className="muted">{formatCount('request', orders.length)} · {t("{0} awaiting review", awaiting)}</p>
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
          placeholder={t("Search by request number, name, email or file…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value as CustomOrderStatus | '')} aria-label={t("Filter by status")}>
          <option value="">{t("All statuses")}</option>
          {CUSTOM_ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CUSTOM_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {state.status !== 'ready' ? (
        <LoadState load={state} onRetry={reload} loadingText={t("Loading print requests…")} />
      ) : (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Request")}</th>
                <th>{t("Submitted")}</th>
                <th>{t("Customer")}</th>
                <th>{t("Models")}</th>
                <th>{t("Price quote")}</th>
                <th>{t("Status")}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <Link to={`/admin/custom-orders/${order.id}`} className="admin-table__name admin-table__number mono">
                      {order.number}
                    </Link>
                  </td>
                  <td>{formatDateTime(order.createdAt)}</td>
                  <td>
                    {order.customer.name}
                    <div className="muted">{order.customer.email}</div>
                  </td>
                  <td>
                    {formatCount('file', order.files.length)} · {formatCount('print', totalCopies(order))}
                    <div className="muted admin-table__files">{order.files.map((file) => file.fileName).join(', ')}</div>
                  </td>
                  <td>{formatQuote(order.quotedPrice)}</td>
                  <td>
                    <CustomOrderStatusBadge status={order.status} />
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted admin-table__empty">
                    {state.data.length === 0 ? t("No print requests yet.") : t("No print requests match your search.")}
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
