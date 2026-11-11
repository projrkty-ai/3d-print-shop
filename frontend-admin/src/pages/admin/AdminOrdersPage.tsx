import { formatCount, t } from '../../i18n';
import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { api } from '../../api/client';
import { LoadState } from '../../components/LoadState';
import { ORDER_SOURCES, ORDER_STATUSES, type Order, type OrderSource, type OrderStatus } from '../../types';
import { formatPrice } from '../../utils/pricing';
import { itemLabel } from './OrderMeasurements';
import { formatDateTime, formatOrderPrice, ORDER_SOURCE_LABELS, OrderSourceBadge, OrderStatusBadge, STATUS_LABELS, totalCopies } from './orderDisplay';
import { useAdminData } from './useAdminData';

/** What the order prints, in a few words: the products, files or project. */
const contents = (order: Order) => (order.project ? order.project.title : order.items.map((item) => itemLabel(item.model, order)).join(', '));

function matches(order: Order, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [order.number, order.customer.name, order.customer.email, contents(order)].some((field) => field.toLowerCase().includes(q));
}

const parseSource = (value: string | null): OrderSource | '' => (ORDER_SOURCES.includes(value as OrderSource) ? value as OrderSource : '');

/** Every order in one list, newest first, whatever its models' source. */
export function AdminOrdersPage() {
  const location = useLocation();
  const flash = (location.state as { message?: string } | null)?.message;
  const [params, setParams] = useSearchParams();
  const source = parseSource(params.get('source'));
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [query, setQuery] = useState('');
  const { state, reload } = useAdminData(() => api.listOrders({ status: status || undefined, source: source || undefined }), [status, source]);

  const orders = state.status === 'ready' ? state.data.filter((o) => matches(o, query)) : [];
  const open = orders.filter((o) => o.status !== 'cancelled' && o.status !== 'rejected');
  const revenue = open.reduce((sum, o) => sum + (o.price.total ?? 0), 0);
  const toQuote = open.filter((o) => o.price.mode === 'quote' && o.price.total === null).length;

  function chooseSource(value: OrderSource | '') {
    const next = new URLSearchParams(params);
    if (value) next.set('source', value);
    else next.delete('source');
    setParams(next, { replace: true });
  }

  return (
    <div className="admin">
      <div className="admin__header">
        <div>
          <h1>{t("Orders")}</h1>
          <p className="muted">{t("Catalog products, customers' own models, external projects and Print on Demand: one list, the same statuses and processing.")}</p>
          {state.status === 'ready' && (
            <p className="muted">
              {formatCount('order', orders.length)} · {formatPrice(revenue)} {t("excluding cancelled")} · {t("{0} to quote", toQuote)}
            </p>
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
          placeholder={t("Search by order number, name, email or model…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value as OrderStatus | '')} aria-label={t("Filter by status")}>
          <option value="">{t("All statuses")}</option>
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <select value={source} onChange={(e) => chooseSource(e.target.value as OrderSource | '')} aria-label={t("Filter by source")}>
          <option value="">{t("All sources")}</option>
          {ORDER_SOURCES.map((s) => <option key={s} value={s}>{ORDER_SOURCE_LABELS[s]}</option>)}
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
                    <Link to={`/admin/orders/${order.id}`} className="admin-table__name admin-table__number mono">
                      {order.number}
                    </Link>
                  </td>
                  <td>{formatDateTime(order.createdAt)}</td>
                  <td>
                    {order.customer.name}
                    <div className="muted">{order.customer.email}</div>
                  </td>
                  <td>
                    <OrderSourceBadge source={order.source} />
                    <div className="muted admin-table__files">{contents(order)}</div>
                  </td>
                  <td>{totalCopies(order)}</td>
                  <td>
                    {formatOrderPrice(order)}
                    <div className="muted">{order.price.mode === 'fixed' ? t("fixed price") : t("quote")}</div>
                  </td>
                  <td>
                    <OrderStatusBadge status={order.status} />
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted admin-table__empty">
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
