import { t } from '../../i18n';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../../api/client';
import { ConfigurationDetails, ItemSwatch } from '../../components/ConfiguredItem';
import { LoadState } from '../../components/LoadState';
import { ORDER_STATUSES, type Order, type OrderStatus } from '../../types';
import { formatPrice } from '../../utils/pricing';
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
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [adminNote, setAdminNote] = useState(order.adminNote);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const dirty = status !== order.status || adminNote !== order.adminNote;
  const { customer } = order;

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      onSaved(await api.updateOrder(order.id, { status, adminNote }));
      setMessage({ kind: 'success', text: t("Order updated.") });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : t("Could not update the order.") });
    } finally {
      setBusy(false);
    }
  }

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

      <div className="order-detail__layout">
        <section className="card">
          <h2>{t("Items")}</h2>
          <ul className="order-items">
            {order.items.map((item, i) => (
              <li key={i} className="order-item">
                <ItemSwatch item={item} />
                <div className="order-item__info">
                  <Link to={`/product/${item.productId}`} className="cart-item__name">
                    {item.productName}
                  </Link>
                  <ConfigurationDetails item={item} />
                  {!item.customization.plates && item.customization.textureDataUrl && (
                    <figure className="order-item__texture">
                      <img src={item.customization.textureDataUrl} alt={t("Texture uploaded for {0}", item.productName)} />
                      <figcaption className="muted">{t("Customer's texture picture")}</figcaption>
                    </figure>
                  )}
                  {item.plates?.map((plate) => {
                    const texture = item.customization.plates?.[plate.id]?.textureDataUrl;
                    return texture ? (
                      <figure key={plate.id} className="order-item__texture">
                        <img src={texture} alt={t("Texture uploaded for {0}, {1}", item.productName, plate.name)} />
                        <figcaption className="muted">{plate.name} {t("— customer's texture picture")}</figcaption>
                      </figure>
                    ) : null;
                  })}
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
          <div className="order-detail__total">{t("Total")} <strong>{formatPrice(order.total)}</strong>
          </div>
        </section>

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

          <section className="card">
            <h2>{t("Fulfilment")}</h2>
            <label className="field">
              <span>{t("Status")}</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as OrderStatus)}>
                {ORDER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
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
                placeholder={t("Tracking number, print notes… (not shown to the customer)")}
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
