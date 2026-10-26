import { formatCount, t } from '../../i18n';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { api } from '../../api/client';
import { LoadState } from '../../components/LoadState';
import { ORDER_STATUSES, type Order, type OrderStatus } from '../../types';
import { formatPrice } from '../../utils/pricing';
import { formatDateTime, OrderStatusBadge, STATUS_LABELS } from './orderDisplay';
import { useAdminData } from './useAdminData';

function matches(order: Order, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [order.number, order.customer.name, order.customer.email].some((field) => field.toLowerCase().includes(q));
}

export function AdminOrdersPage() {
  const location = useLocation();
  const flash = (location.state as { message?: string } | null)?.message;
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [query, setQuery] = useState('');
  const { state, reload } = useAdminData(() => api.listOrders(status || undefined), [status]);

  const orders = state.status === 'ready' ? state.data.filter((o) => matches(o, query)) : [];
  const revenue = orders.filter((o) => o.status !== 'cancelled').reduce((sum, o) => sum + o.total, 0);

  return (
    <div className="admin">
      <div className="admin__header">
        <div>
          <h1>{t("Orders")}</h1>
          {state.status === 'ready' && (
            <p className="muted">
              {formatCount('order', orders.length)} · {formatPrice(revenue)} {t("excluding cancelled")}</p>
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
          placeholder={t("Search by order number, name or email…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value as OrderStatus | '')} aria-label={t("Filter by status")}>
          <option value="">{t("All statuses")}</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {state.status !== 'ready' ? (
        <LoadState load={state} onRetry={reload} loadingText={t("Loading orders…")} />
      ) : (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Order")}</th>
                <th>{t("Placed")}</th>
                <th>{t("Customer")}</th>
                <th>{t("Items")}</th>
                <th>{t("Total")}</th>
                <th>{t("Status")}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <Link to={`/admin/orders/${order.id}`} className="admin-table__name mono">
                      {order.number}
                    </Link>
                  </td>
                  <td>{formatDateTime(order.createdAt)}</td>
                  <td>
                    {order.customer.name}
                    <div className="muted">{order.customer.email}</div>
                  </td>
                  <td>{order.items.reduce((n, item) => n + item.quantity, 0)}</td>
                  <td>{formatPrice(order.total)}</td>
                  <td>
                    <OrderStatusBadge status={order.status} />
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted admin-table__empty">
                    {state.data.length === 0 ? t("No orders yet.") : t("No orders match your search.")}
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
