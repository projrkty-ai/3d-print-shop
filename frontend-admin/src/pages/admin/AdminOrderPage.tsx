import { t } from '../../i18n';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../../api/client';
import { ConfigurationDetails, ItemThumbnail } from '../../components/ConfiguredItem';
import { LoadState } from '../../components/LoadState';
import { useProducts } from '../../store/ProductsContext';
import { ORDER_STATUSES, type Order, type OrderStatus } from '../../types';
import { formatPrice } from '../../utils/pricing';
import { LogBook } from './LogBook';
import { useLogBook } from './logBookData';
import { OrderedTextures, OrderItemViewer } from './OrderItemViewer';
import { OrderProcessing } from './OrderProcessing';
import { formatDateTime, OrderStatusBadge, STATUS_LABELS } from './orderDisplay';
import { useAdminData } from './useAdminData';

export function AdminOrderPage() {
  const { orderId = '' } = useParams();
  const { state, setData, reload } = useAdminData(() => api.getOrder(orderId), [orderId]);

  if (state.status !== 'ready') {
    return (
      <div className="admin">
        <Link to="/admin/orders" className="muted">{t("← All orders")}</Link>
        <LoadState load={state} onRetry={reload} loadingText={t("Loading order…")} />
      </div>
    );
  }
  // Keyed by id only: after a save the form already matches the server, and remounting would drop the success message.
  return <OrderDetails key={state.data.id} order={state.data} onSaved={setData} />;
}

function OrderDetails({ order, onSaved }: { order: Order; onSaved: (order: Order) => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const { getProduct } = useProducts();
  /** Index of the item shown in the 3D viewer. */
  const [viewing, setViewing] = useState<number | null>(null);
  const viewed = viewing === null ? undefined : order.items[viewing];
  const { customer } = order;
  const log = useLogBook('order', order.id);

  async function remove() {
    if (!window.confirm(t("Delete order {0}? This cannot be undone.", order.number))) return;
    setBusy(true);
    try {
      await api.deleteOrder(order.id);
      navigate('/admin/orders', { state: { message: t("Deleted order {0}.", order.number) } });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : t("Could not delete the order.") });
      setBusy(false);
    }
  }

  return (
    <div className="admin order-detail">
      <div className="admin__header">
        <div>
          <Link to="/admin/orders" className="muted">{t("← All orders")}</Link>
          <h1>{t("Order")} <span className="mono">{order.number}</span> <OrderStatusBadge status={order.status} />
          </h1>
          <p className="muted">{t("Placed")} {formatDateTime(order.createdAt)}
            {order.updatedAt !== order.createdAt && t(" · updated {0}", formatDateTime(order.updatedAt))}
          </p>
        </div>
        <div className="admin__header-actions">
          <button type="button" className="btn btn--ghost btn--danger" onClick={() => void remove()} disabled={busy}>{t("Delete order")}</button>
        </div>
      </div>

      {message && (
        <p className={`banner banner--${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}

      {viewed && viewing !== null && (
        <OrderItemViewer
          item={viewed}
          product={getProduct(viewed.productId)}
          orderNumber={order.number}
          position={viewing + 1}
          onClose={() => setViewing(null)}
        />
      )}

      <div className="order-detail__layout">
        <div>
          <section className="card">
            <h2>{t("Items")}</h2>
            <ul className="order-items">
              {order.items.map((item, i) => (
                <li key={i} className="order-item">
                  <ItemThumbnail item={item} product={getProduct(item.productId)} onOpen={() => setViewing(i)} />
                  <div className="order-item__info">
                    <Link to={`/product/${item.productId}`} className="cart-item__name">
                      {item.productName}
                    </Link>
                    <ConfigurationDetails item={item} />
                    <OrderedTextures item={item} fileName={`${order.number}-${i + 1}`} />
                    <details className="order-item__prices">
                      <summary>{t("Price breakdown")}</summary>
                      <table className="summary__lines">
                        <tbody>
                          {item.priceLines.map((line) => (
                            <tr key={line.label}>
                              <td>
                                {line.label}
                                {line.note && <small className="summary__note">{line.note}</small>}
                              </td>
                              <td>{formatPrice(line.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  </div>
                  <div className="order-item__total">
                    {item.quantity} × {formatPrice(item.unitPrice)}
                    <strong>{formatPrice(item.lineTotal)}</strong>
                  </div>
                </li>
              ))}
            </ul>
            {order.handlingFee !== undefined && <p className="muted">{t("Handling fee per order")}: {formatPrice(order.handlingFee)}</p>}
            <div className="order-detail__total">{t("Total")} <strong>{formatPrice(order.total)}</strong>
            </div>
          </section>

          <OrderProcessing
            kind="order"
            orderId={order.id}
            customerEmail={customer.email}
            savedStatus={order.status}
            statuses={ORDER_STATUSES}
            statusLabels={STATUS_LABELS}
            savedAdminNote={order.adminNote}
            onSave={async ({ status, ...changes }) => onSaved(await api.updateOrder(order.id, { status: status as OrderStatus, ...changes }))}
            onLogChanged={log.reload}
          />
          <LogBook
            kind="order"
            orderId={order.id}
            orderNumber={order.number}
            state={log.state}
            statusLabels={STATUS_LABELS}
            onReload={log.reload}
          />
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
            {order.customerNote && (
              <>
                <h3>{t("Customer note")}</h3>
                <p className="order-detail__note">{order.customerNote}</p>
              </>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
