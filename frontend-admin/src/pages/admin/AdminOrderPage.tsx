import { t } from '../../i18n';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../../api/client';
import { LoadState } from '../../components/LoadState';
import type { Order, PricingSettings, ProjectProduct } from '../../types';
import type { UploadFile } from '../../utils/printEstimate';
import { formatPrice } from '../../utils/pricing';
import { formatDuration } from '../../utils/projectPricing';
import { CreateProjectProduct } from './CreateProjectProduct';
import { LogBook } from './LogBook';
import { useLogBook } from './logBookData';
import { OrderMeasurements } from './OrderMeasurements';
import { OrderModels } from './OrderModels';
import { OrderPrintFiles } from './OrderPrintFiles';
import { OrderProcessing } from './OrderProcessing';
import { formatDateTime, formatOrderPrice, OrderSourceBadge, OrderStatusBadge, uploadFiles } from './orderDisplay';
import { durationUnits } from './PricingBreakdown';
import { useAdminData } from './useAdminData';
import { useCustomerModels, type CustomerModel } from './useCustomerModels';
import { useProjectFiles } from './useProjectFiles';

export function AdminOrderPage() {
  const { orderId = '' } = useParams();
  const { state, setData, reload } = useAdminData(() => api.getOrder(orderId), [orderId]);
  // The shop's rates, for previewing measured prices; the page works without them.
  const { state: rates } = useAdminData(() => api.getPricing(), []);

  if (state.status !== 'ready') {
    return (
      <div className="admin">
        <Link to="/admin/orders" className="muted">{t("← All orders")}</Link>
        <LoadState load={state} onRetry={reload} loadingText={t("Loading order…")} />
      </div>
    );
  }
  // Keyed by id only: after a save the form already matches the server, and remounting would drop the success message.
  return <OrderDetails key={state.data.id} order={state.data} pricing={rates.status === 'ready' ? rates.data : null} onSaved={setData} />;
}

/**
 * One order, whatever its models' source: the models (the only source-specific part), their
 * measurements and price, the processing with status emails, the log book and the customer.
 */
function OrderDetails({ order, pricing, onSaved }: { order: Order; pricing: PricingSettings | null; onSaved: (order: Order) => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  /** Uploaded file being fetched for saving. */
  const [downloading, setDownloading] = useState<string | null>(null);
  const { customer } = order;
  const log = useLogBook(order.id);
  const { models, fileUrl } = useCustomerModels(order.id, uploadFiles(order));
  const modelOf = (file: Pick<UploadFile, 'fileId'>): CustomerModel => models[file.fileId] ?? { status: 'loading' };
  const fromProject = order.source === 'project' || order.source === 'printOnDemand';
  const projectFiles = useProjectFiles(order);
  const product = usePrintOnDemandProduct(order);

  async function remove() {
    const files = order.source === 'upload' ? ` ${t("The customer's files are deleted too.")}` : '';
    if (!window.confirm(`${t("Delete order {0}? This cannot be undone.", order.number)}${files}`)) return;
    setBusy(true);
    try {
      await api.deleteOrder(order.id);
      navigate('/admin/orders', { state: { message: t("Deleted order {0}.", order.number) } });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : t("Could not delete the order.") });
      setBusy(false);
    }
  }

  /** Saves an uploaded file; it was usually downloaded already for its miniature. */
  async function download(file: UploadFile) {
    setDownloading(file.fileId);
    setMessage(null);
    try {
      const link = document.createElement('a');
      link.href = await fileUrl(file);
      link.download = `${order.number}-${file.fileName}`;
      document.body.append(link);
      link.click();
      link.remove();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : t("Could not download {0}.", file.fileName) });
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="admin order-detail">
      <div className="admin__header">
        <div>
          <Link to="/admin/orders" className="muted">{t("← All orders")}</Link>
          <h1>{t("Order")} <span className="mono">{order.number}</span> <OrderStatusBadge status={order.status} /> <OrderSourceBadge source={order.source} /></h1>
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
        <div>
          <OrderModels order={order} modelOf={modelOf} onDownload={download} downloading={downloading} />
          {fromProject && <OrderPrintFiles order={order} files={projectFiles} product={product} />}
          <OrderMeasurements order={order} pricing={pricing} modelOf={modelOf} fileUrl={fileUrl} projectFiles={projectFiles} product={product} onSaved={onSaved} />
          <OrderProcessing order={order} onSaved={onSaved} onLogChanged={log.reload} />
          <LogBook orderId={order.id} orderNumber={order.number} state={log.state} onReload={log.reload} />
          {order.source === 'project' && <CreateProjectProduct key={order.updatedAt} order={order} />}
        </div>

        <aside>
          <OrderPriceCard order={order} />
          {order.printJob && <PrintJobCard order={order} />}
          <section className="card">
            <h2>{t("Customer")}</h2>
            <p className="order-detail__customer">
              <strong>{customer.name}</strong>
              <br />
              <a href={`mailto:${customer.email}?subject=${encodeURIComponent(t("Your order {0}", order.number))}`}>{customer.email}</a>
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
            <h3>{t("Customer note")}</h3>
            {order.customerNote
              ? <p className="order-detail__note">{order.customerNote}</p>
              : <p className="muted">{t("No note.")}</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}

/** Where the order is printed: the printer's queue it is in, its print time and start. */
function PrintJobCard({ order }: { order: Order }) {
  const job = order.printJob!;
  return (
    <section className="card order-print-job" aria-label={t("Print queue")}>
      <h2>{t("Print queue")}</h2>
      <p>
        <Link to={`/admin/printers/${encodeURIComponent(job.printerId)}`}>{job.printerName}</Link>
        {' '}<OrderStatusBadge status={order.status} />
      </p>
      <dl className="config-details">
        <dt>{t("Print time")}</dt>
        <dd>{formatDuration(job.printMinutes, durationUnits())}</dd>
        <dt>{t("Joined the queue")}</dt>
        <dd>{formatDateTime(job.queuedAt)}</dd>
        {job.startedAt ? (
          <>
            <dt>{t("Printing since")}</dt>
            <dd>{formatDateTime(job.startedAt)}</dd>
          </>
        ) : (
          <>
            <dt>{t("Estimated start")}</dt>
            <dd>{formatDateTime(job.estimatedStart)} <small className="muted">{t("(when queued)")}</small></dd>
          </>
        )}
      </dl>
      <p className="muted">{t("The printer's queue shows the current estimates.")}</p>
    </section>
  );
}

/** The ordered Print on Demand product (for its print file): undefined while loading, null when it is gone. */
function usePrintOnDemandProduct(order: Order): ProjectProduct | null | undefined {
  const productId = order.items.map(({ model }) => model).find((model) => model.source === 'printOnDemand')?.productId ?? null;
  const [product, setProduct] = useState<{ id: string; value: ProjectProduct | null } | null>(null);
  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    api.getProjectProduct(productId).then(
      (found) => !cancelled && setProduct({ id: productId, value: found }),
      () => !cancelled && setProduct({ id: productId, value: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [productId]);
  if (!productId) return null;
  return product?.id === productId ? product.value : undefined;
}

/** The order's price: fixed when ordered, or quoted by the shop; with the estimate and the measured price. */
function OrderPriceCard({ order }: { order: Order }) {
  const { price } = order;
  return (
    <section className="card order-price">
      <h2>{t("Price")}</h2>
      <p className="order-price__total"><strong>{formatOrderPrice(order)}</strong></p>
      <p className="muted">
        {price.mode === 'fixed' ? t("Fixed when the customer ordered.") : price.total === null ? t("Needs a quote.") : t("Quoted by the shop.")}
      </p>
      <dl className="config-details">
        <dt>{t("Handling fee")}</dt>
        <dd>{formatPrice(price.handlingFee)}</dd>
        {price.estimated !== null && (
          <>
            <dt>{t("Customer's estimate")}</dt>
            <dd>{formatPrice(price.estimated)}</dd>
          </>
        )}
        <dt>{t("From the measurements")}</dt>
        <dd>{price.reviewed === null ? <span className="muted">{t("Not every item is measured.")}</span> : formatPrice(price.reviewed)}</dd>
      </dl>
    </section>
  );
}
