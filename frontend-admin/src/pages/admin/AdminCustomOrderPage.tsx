import { formatCount, t } from '../../i18n';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError, type Notification } from '../../api/client';
import { LoadState } from '../../components/LoadState';
import { CUSTOM_ORDER_STATUSES, type CustomOrder, type CustomOrderFile, type CustomOrderStatus } from '../../types';
import { formatPrice } from '../../utils/pricing';
import { CustomModelFacts, EstimateText, fileEstimate, PrintChoices } from './CustomModelFacts';
import { LogBook } from './LogBook';
import { useLogBook } from './logBookData';
import { OrderProcessing } from './OrderProcessing';
import { CustomModelViewer } from './CustomModelViewer';
import { CustomOrderStatusBadge, CUSTOM_STATUS_LABELS, formatBytes, formatQuote, totalCopies } from './customOrderDisplay';
import { formatDateTime } from './orderDisplay';
import { useAdminData } from './useAdminData';
import { useCustomerModels, type CustomerModel } from './useCustomerModels';

export function AdminCustomOrderPage() {
  const { orderId = '' } = useParams();
  const { state, setData, reload } = useAdminData(() => api.getCustomOrder(orderId), [orderId]);

  if (state.status !== 'ready') {
    return (
      <div className="admin">
        <Link to="/admin/custom-orders" className="muted">{t("← All print requests")}</Link>
        <LoadState load={state} onRetry={reload} loadingText={t("Loading print request…")} />
      </div>
    );
  }
  // Keyed by id only: after a save the form already matches the server, and remounting would drop the success message.
  return <CustomOrderDetails key={state.data.id} order={state.data} onSaved={setData} />;
}

/** The quote as typed: empty means "not quoted"; anything else must be a non-negative amount. */
function parseQuote(text: string): number | null | undefined {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : undefined;
}

const quoteText = (quote: number | null) => (quote === null ? '' : String(quote));

function CustomOrderDetails({ order, onSaved }: { order: CustomOrder; onSaved: (order: CustomOrder) => void }) {
  const navigate = useNavigate();
  const [quote, setQuote] = useState(quoteText(order.quotedPrice));
  const [busy, setBusy] = useState(false);
  /** File being fetched for saving. */
  const [fetching, setFetching] = useState<string | null>(null);
  /** Index of the file shown in the 3D viewer. */
  const [viewing, setViewing] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const { models, fileUrl } = useCustomerModels(order);
  const modelOf = (file: CustomOrderFile): CustomerModel => models[file.fileId] ?? { status: 'loading' };
  const { customer } = order;
  const log = useLogBook('customOrder', order.id);

  /** Estimated price of the whole request, once every file has been read and has print options. */
  const estimates = order.files.map((file) => {
    const model = modelOf(file);
    return model.status === 'ready' ? fileEstimate(file, model.result) : undefined;
  });
  const estimating = order.files.some((file) => modelOf(file).status === 'loading');
  const estimatedTotal = estimates.every((estimate) => estimate)
    ? Math.round(estimates.reduce((sum, estimate, i) => sum + estimate!.unitPrice * order.files[i].quantity, 0) * 100) / 100
    : null;

  const quotedPrice = parseQuote(quote);
  const quoteInvalid = quotedPrice === undefined;

  const failure = (err: unknown, fallback: string) =>
    setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : fallback });

  /** Saves the processing form with the quote; the panel handles messages and errors. */
  async function save(changes: { status: string; adminNote: string } & Notification) {
    if (quoteInvalid) return;
    const saved = await api.updateCustomOrder(order.id, { ...changes, status: changes.status as CustomOrderStatus, quotedPrice });
    onSaved(saved);
    setQuote(quoteText(saved.quotedPrice));
  }

  const quoteField = (
    <label className="field">
      <span>{t("Quoted price ({0})", order.currency)}</span>
      <input
        inputMode="decimal"
        value={quote}
        onChange={(e) => setQuote(e.target.value)}
        placeholder={t("Not quoted")}
        aria-invalid={quoteInvalid || undefined}
      />
      <span className="custom-order__estimate">
        {estimatedTotal !== null ? (
          <>
            {t("Estimated from the files: {0}", formatPrice(estimatedTotal))}
            <button type="button" className="btn btn--small btn--ghost" onClick={() => setQuote(String(estimatedTotal))}>
              {t("Use estimate")}
            </button>
          </>
        ) : estimating ? t("Estimating from the files…") : t("No estimate: some files can't be read or have no print options.")}
      </span>
      <small className={`field__help ${quoteInvalid ? 'is-error' : ''}`}>
        {quoteInvalid
          ? t("Enter an amount of 0 or more, or leave it empty.")
          : t("Currently: {0}. The approval email states the quoted price.", formatQuote(order.quotedPrice))}
      </small>
    </label>
  );

  async function remove() {
    if (!window.confirm(t("Delete print request {0} and its model files? This cannot be undone.", order.number))) return;
    setBusy(true);
    try {
      await api.deleteCustomOrder(order.id);
      navigate('/admin/custom-orders', { state: { message: t("Deleted print request {0}.", order.number) } });
    } catch (err) {
      failure(err, t("Could not delete the print request."));
      setBusy(false);
    }
  }

  /** Saves the original file; it was usually downloaded already for its miniature. */
  async function download(file: CustomOrderFile) {
    setFetching(file.fileId);
    setMessage(null);
    try {
      const link = document.createElement('a');
      link.href = await fileUrl(file);
      link.download = `${order.number}-${file.fileName}`;
      document.body.append(link);
      link.click();
      link.remove();
    } catch (err) {
      failure(err, t("Could not download {0}.", file.fileName));
    } finally {
      setFetching(null);
    }
  }

  const viewed = viewing === null ? undefined : order.files[viewing];

  return (
    <div className="admin order-detail">
      <div className="admin__header">
        <div>
          <Link to="/admin/custom-orders" className="muted">{t("← All print requests")}</Link>
          <h1>{t("Print request")} <span className="mono">{order.number}</span> <CustomOrderStatusBadge status={order.status} />
          </h1>
          <p className="muted">{t("Submitted")} {formatDateTime(order.createdAt)}
            {order.updatedAt !== order.createdAt && t(" · updated {0}", formatDateTime(order.updatedAt))}
          </p>
        </div>
        <div className="admin__header-actions">
          <button type="button" className="btn btn--ghost btn--danger" onClick={() => void remove()} disabled={busy}>{t("Delete request")}</button>
        </div>
      </div>

      {message && (
        <p className={`banner banner--${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}

      {viewed && viewing !== null && (
        <CustomModelViewer
          file={viewed}
          model={modelOf(viewed)}
          orderNumber={order.number}
          position={viewing + 1}
          onDownload={() => void download(viewed)}
          onClose={() => setViewing(null)}
        />
      )}

      <div className="order-detail__layout">
        <div>
          <section className="card">
            <h2>{t("Models")}</h2>
            <p className="muted">{formatCount('file', order.files.length)} · {formatCount('print', totalCopies(order))}</p>
            <ul className="custom-files">
              {order.files.map((file, index) => {
                const model = modelOf(file);
                return (
                  <li key={file.fileId} className="model-file custom-file">
                    {/* The miniature and description open the 3D viewer. */}
                    <button
                      type="button"
                      className="custom-file__open"
                      disabled={model.status === 'error'}
                      aria-label={t("View {0} in 3D", file.fileName)}
                      title={model.status === 'error' ? undefined : t("View in 3D")}
                      onClick={() => setViewing(index)}
                    >
                      <span className="custom-file__thumb">
                        {model.status === 'ready' && model.result.thumbnail
                          ? <img src={model.result.thumbnail} alt="" />
                          : <span className="model-file__badge">{file.format.toUpperCase()}</span>}
                      </span>
                      <span className="custom-file__info">
                        <strong className="custom-file__name">{file.fileName}</strong>
                        <span className="muted">{file.format.toUpperCase()} · {formatBytes(file.sizeBytes)}</span>
                        <PrintChoices file={file} />
                        {model.status === 'ready' && <CustomModelFacts result={model.result} />}
                        {estimates[index] && <EstimateText estimate={estimates[index]} quantity={file.quantity} />}
                        {model.status === 'loading' && <span className="muted">{t("Loading preview…")}</span>}
                        {model.status === 'error' && (
                          <span className="custom-file__warning">{t("Preview unavailable")}: {model.message}</span>
                        )}
                      </span>
                    </button>
                    <span className="custom-file__copies">× {file.quantity}</span>
                    <div className="model-file__actions">
                      <button
                        type="button"
                        className="btn btn--small btn--ghost"
                        disabled={fetching !== null}
                        aria-label={t("Download {0}", file.fileName)}
                        onClick={() => void download(file)}
                      >
                        {fetching === file.fileId ? t("Loading…") : t("Download")}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <OrderProcessing
            kind="customOrder"
            orderId={order.id}
            customerEmail={customer.email}
            savedStatus={order.status}
            statuses={CUSTOM_ORDER_STATUSES}
            statusLabels={CUSTOM_STATUS_LABELS}
            savedAdminNote={order.adminNote}
            extra={{
              content: quoteField,
              dirty: !quoteInvalid && quotedPrice !== order.quotedPrice,
              invalid: quoteInvalid,
              quotedPrice: quoteInvalid ? order.quotedPrice : quotedPrice,
            }}
            onSave={save}
            onLogChanged={log.reload}
          />
          <LogBook
            kind="customOrder"
            orderId={order.id}
            orderNumber={order.number}
            state={log.state}
            statusLabels={CUSTOM_STATUS_LABELS}
            onReload={log.reload}
          />
        </div>

        <aside>
          <section className="card">
            <h2>{t("Customer's printing instructions")}</h2>
            {order.customerNote
              ? <p className="order-detail__note">{order.customerNote}</p>
              : <p className="muted">{t("No instructions — print with the shop's defaults.")}</p>}
          </section>

          <section className="card">
            <h2>{t("Customer")}</h2>
            <p className="order-detail__customer">
              <strong>{customer.name}</strong>
              <br />
              <a href={`mailto:${customer.email}?subject=${encodeURIComponent(t("Your print request {0}", order.number))}`}>{customer.email}</a>
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
        </aside>
      </div>
    </div>
  );
}
