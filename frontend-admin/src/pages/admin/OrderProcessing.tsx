import { t } from '../../i18n';
import { useEffect, useId, useState } from 'react';
import { api, ApiError, type QueueInput } from '../../api/client';
import { ORDER_STATUSES, type LogEntry, type Order, type OrderStatus, type Printer, type StatusEmailPreview } from '../../types';
import { formatPrice } from '../../utils/pricing';
import { formatDuration } from '../../utils/projectPricing';
import { deliveryText, missingValueText, useMailDelivery } from './logBookData';
import { formatDateTime, formatOrderPrice, STATUS_LABELS } from './orderDisplay';
import { durationUnits } from './PricingBreakdown';

type Banner = { kind: 'success' | 'error'; text: string; details?: string[] } | null;

interface Props {
  order: Order;
  onSaved: (order: Order) => void;
  /** Reloads the log book after something was logged; resolves with the fresh entries. */
  onLogChanged: () => Promise<LogEntry[]>;
}

/** The price as typed: empty means "not quoted"; anything else must be a non-negative amount. */
function parsePrice(text: string): number | null | undefined {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : undefined;
}

const priceText = (price: number | null) => (price === null ? '' : String(price));

/** Minutes the whole order prints by the shop's measurements (one copy × copies), or null while an item is not measured. */
export function measuredPrintMinutes(order: Pick<Order, 'items'>): number | null {
  if (order.items.some((item) => !item.review)) return null;
  return Math.round(order.items.reduce((sum, item) => sum + item.review!.printMinutes * item.quantity, 0));
}

/** Whole minutes, 1 or more; undefined otherwise. */
function parseMinutes(text: string): number | undefined {
  const value = Number(text.trim());
  return Number.isInteger(value) && value >= 1 && value <= 60 * 24 * 60 ? value : undefined;
}

/** "U1-01 (Snapmaker U1) — 2 in the queue, next start Nov 10, 2026, 2:00 PM" */
function printerOption(printer: Printer): string {
  const queue = printer.queue.length === 0 ? t("queue empty") : t("{0} in the queue", printer.queue.length);
  return `${printer.name}${printer.model ? ` (${printer.model.name})` : ''} — ${queue}, ${t("next start {0}", formatDateTime(printer.queue.nextStart))}`;
}

/** How long to wait after typing before asking the server for a fresh email preview. */
const PREVIEW_DELAY_MS = 300;

/**
 * Processing an order, the same for every source: its status — optionally emailing the customer the
 * status template, with a preview of exactly what will be sent — the price of orders that need a
 * quote, the internal note, and messages to the customer.
 */
export function OrderProcessing({ order, onSaved, onLogChanged }: Props) {
  const orderId = order.id;
  const customerEmail = order.customer.email;
  const savedStatus = order.status;
  const savedAdminNote = order.adminNote;
  const quoting = order.price.mode === 'quote';
  const [status, setStatus] = useState<OrderStatus>(savedStatus);
  const [adminNote, setAdminNote] = useState(savedAdminNote);
  const [priceInput, setPriceInput] = useState(priceText(order.price.total));
  const measuredMinutes = measuredPrintMinutes(order);
  const [printerId, setPrinterId] = useState(order.printJob?.printerId ?? '');
  const [minutesInput, setMinutesInput] = useState(measuredMinutes === null ? '' : String(measuredMinutes));
  const [printers, setPrinters] = useState<Printer[] | null>(null);
  const [printersError, setPrintersError] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);
  const [note, setNote] = useState('');
  // The last preview stays visible while a fresher one loads; `for` says which form values it shows.
  const [preview, setPreview] = useState<(StatusEmailPreview & { for: string }) | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const delivery = useMailDelivery();
  const ids = { status: useId(), note: useId(), adminNote: useId() };

  const price = quoting ? parsePrice(priceInput) : order.price.total;
  const priceInvalid = price === undefined;
  const priceChanged = quoting && !priceInvalid && price !== order.price.total;
  const statusChanged = status !== savedStatus;
  // Queueing: joining a printer's queue (or moving to another printer's) needs the printer and the print time.
  const queueing = status === 'queued';
  const joining = queueing && printerId !== '' && printerId !== order.printJob?.printerId;
  const printMinutes = parseMinutes(minutesInput);
  const minutesInvalid = joining && printMinutes === undefined;
  const needsPrinter = queueing && !order.printJob && printerId === '';
  const queue: QueueInput | undefined = joining && printMinutes !== undefined ? { printerId, printMinutes } : undefined;
  const emailing = (statusChanged || joining) && notify;
  const quote = priceInvalid ? order.price.total : price;
  const previewKey = JSON.stringify([status, note, quote, queue]);
  const upToDate = preview?.for === previewKey;
  const missing = emailing ? (preview?.missing ?? []) : [];
  // Like the server: an order is only quoted with a price.
  const needsPrice = status === 'quoted' && quote === null;
  const dirty = statusChanged || adminNote !== savedAdminNote || priceChanged || joining;
  const canSave = dirty && !busy && !priceInvalid && !needsPrice && !needsPrinter && !minutesInvalid && (!emailing || (upToDate && missing.length === 0));

  // The printers to queue on, with their queues, once the admin chooses "In queue".
  useEffect(() => {
    if (!queueing || printers) return;
    let cancelled = false;
    api.listPrinters()
      .then((list) => !cancelled && setPrinters(list))
      .catch((err: unknown) => !cancelled && setPrintersError(err instanceof ApiError ? err.message : t("Could not load the printers.")));
    return () => {
      cancelled = true;
    };
  }, [queueing, printers]);

  useEffect(() => {
    setPreviewError(null);
    if (!emailing) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.previewStatusEmail(orderId, { status, note, price: quote, ...(queue && { queue }) })
        .then((result) => !cancelled && setPreview({ ...result, for: previewKey }))
        .catch((err: unknown) => !cancelled && setPreviewError(err instanceof ApiError ? err.message : t("Could not prepare the email.")));
    }, PREVIEW_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `previewKey` stands for the queue choice.
  }, [emailing, orderId, status, note, quote, previewKey]);

  async function save() {
    setBusy(true);
    setBanner(null);
    try {
      const saved = await api.updateOrder(orderId, {
        status, adminNote, ...(priceChanged && { price }), ...(queue && { queue }),
        ...((statusChanged || joining) && { notify, ...(notify && note.trim() && { note }) }),
      });
      onSaved(saved);
      setPriceInput(priceText(saved.price.total));
      setPrinterId(saved.printJob?.printerId ?? '');
      // Queues changed: reload them next time.
      setPrinters(null);
      const entries = await onLogChanged();
      const email = emailing ? entries.find((entry) => entry.type === 'emailSent') : undefined;
      const result = email?.type === 'emailSent' ? deliveryText(email) : null;
      setBanner(result?.kind === 'error'
        ? { kind: 'error', text: `${t("Changes saved.")} ${result.text}` }
        : { kind: 'success', text: [t("Changes saved."), result?.text].filter(Boolean).join(' ') });
      setNote('');
    } catch (err) {
      setBanner(err instanceof ApiError
        ? { kind: 'error', text: err.message, details: err.details }
        : { kind: 'error', text: t("Could not save the changes.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card order-processing" aria-labelledby={`${ids.status}-title`}>
      <h2 id={`${ids.status}-title`}>{t("Order processing")}</h2>
      {delivery && delivery.transport !== 'smtp' && (
        <p className={`banner ${delivery.transport === 'disabled' ? 'banner--warning' : 'banner--info'}`}>
          {delivery.transport === 'outbox'
            ? t("Development mode: emails are saved as files in the server's outbox folder instead of being sent.")
            : t("Email sending isn't configured on the server (SMTP_HOST, MAIL_FROM): emails will be logged as failed.")}
        </p>
      )}
      {banner && <ProcessingBanner banner={banner} />}

      <div className="order-processing__grid">
        <div>
          <label className="field">
            <span>{t("Status")}</span>
            <select id={ids.status} value={status} onChange={(e) => setStatus(e.target.value as OrderStatus)}>
              {ORDER_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
            {needsPrice && <small className="field__help is-error" role="alert">{t("Set the price before marking the order as quoted.")}</small>}
          </label>
          {queueing && (
            <QueueFields order={order} printers={printers} printersError={printersError} printerId={printerId} onPrinter={setPrinterId}
              joining={joining} minutesInput={minutesInput} onMinutes={setMinutesInput} measuredMinutes={measuredMinutes}
              minutesInvalid={minutesInvalid} needsPrinter={needsPrinter} />
          )}
          {quoting ? (
            <label className="field">
              <span>{t("Price ({0})", order.currency)}</span>
              <input inputMode="decimal" value={priceInput} onChange={(e) => setPriceInput(e.target.value)} placeholder={t("Not quoted")}
                aria-invalid={priceInvalid || undefined} />
              {order.price.reviewed !== null && (
                <span className="order-processing__suggestion">
                  {t("From the shop's measurements: {0}", formatPrice(order.price.reviewed))}
                  <button type="button" className="btn btn--small btn--ghost" onClick={() => setPriceInput(String(order.price.reviewed))}>
                    {t("Use the measured price")}
                  </button>
                </span>
              )}
              {order.price.estimated !== null && (
                <span className="order-processing__suggestion">
                  {t("Customer's estimate: {0}", formatPrice(order.price.estimated))}
                  <button type="button" className="btn btn--small btn--ghost" onClick={() => setPriceInput(String(order.price.estimated))}>
                    {t("Use the customer's estimate")}
                  </button>
                </span>
              )}
              <small className={`field__help ${priceInvalid ? 'is-error' : ''}`}>
                {priceInvalid
                  ? t("Enter an amount of 0 or more, or leave it empty.")
                  : t("Currently: {0}. The quote email states the price.", formatOrderPrice(order))}
              </small>
            </label>
          ) : (
            <p className="order-processing__fixed">
              <span className="muted">{t("Price")}</span> <strong>{formatOrderPrice(order)}</strong>
              <small className="muted">{t("Fixed when the customer ordered; it cannot change.")}</small>
            </p>
          )}
          <label className="field">
            <span>{t("Internal note")}</span>
            <textarea
              id={ids.adminNote}
              rows={3}
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              placeholder={t("Not shown to the customer")}
              maxLength={5000}
            />
          </label>
        </div>

        {(statusChanged || joining) && (
          <div className="status-email">
            <label className="status-email__notify">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              {t("Email the customer about this change")}
            </label>
            {notify && (
              <>
                <label className="field" htmlFor={ids.note}>
                  <span>
                    {t("Message for the customer")}{' '}
                    <small className="muted">{preview?.required.includes('note') ? t("(required)") : t("(optional)")}</small>
                  </span>
                  <textarea id={ids.note} rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000}
                    placeholder={t("Added to the email, e.g. a tracking number or the reason")} />
                </label>
                {missing.length > 0 && (
                  <ul className="status-email__missing" role="alert">
                    {[...new Set(missing.map(missingValueText))].map((text) => <li key={text}>{text}</li>)}
                  </ul>
                )}
                {previewError && <p className="field__help is-error" role="alert">{previewError}</p>}
                <EmailPreview preview={preview} to={customerEmail} />
              </>
            )}
          </div>
        )}
      </div>

      <div className="order-processing__actions">
        <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={!canSave}>
          {busy ? t("Saving…") : emailing ? t("Save and send email") : t("Save changes")}
        </button>
      </div>

      <CustomerMessage orderId={orderId} customerEmail={customerEmail} currentStatus={savedStatus} onLogChanged={onLogChanged} />
    </section>
  );
}

/**
 * The printer whose queue the order joins — each with its queue at a glance — and the order's print
 * time (from the shop's measurements when every item is measured). An order already in a queue keeps
 * its place unless another printer is chosen (it then joins the end of that printer's queue).
 */
function QueueFields({ order, printers, printersError, printerId, onPrinter, joining, minutesInput, onMinutes, measuredMinutes, minutesInvalid, needsPrinter }: {
  order: Order;
  printers: Printer[] | null;
  printersError: string | null;
  printerId: string;
  onPrinter: (id: string) => void;
  joining: boolean;
  minutesInput: string;
  onMinutes: (text: string) => void;
  measuredMinutes: number | null;
  minutesInvalid: boolean;
  needsPrinter: boolean;
}) {
  const ids = { printer: useId(), minutes: useId() };
  const job = order.printJob;
  const minutes = parseMinutes(minutesInput);
  return (
    <div className="order-processing__queue">
      <label className="field" htmlFor={ids.printer}>
        <span>{t("Printer")}</span>
        <select id={ids.printer} value={printerId} onChange={(e) => onPrinter(e.target.value)} disabled={!printers}>
          <option value="">{printers ? t("Choose a printer…") : t("Loading printers…")}</option>
          {job && !printers?.some((printer) => printer.id === job.printerId) && <option value={job.printerId}>{job.printerName}</option>}
          {printers?.map((printer) => <option key={printer.id} value={printer.id}>{printerOption(printer)}</option>)}
        </select>
        {printersError && <small className="field__help is-error" role="alert">{printersError}</small>}
        {printers?.length === 0 && <small className="field__help is-error">{t("There are no printers yet: add them in the Printers tab.")}</small>}
        {needsPrinter && <small className="field__help is-error" role="alert">{t("Choose the printer whose queue the order joins.")}</small>}
        {job && !joining && (
          <small className="field__help">
            {job.startedAt
              ? t("Printing on {0} since {1}.", job.printerName, formatDateTime(job.startedAt))
              : t("In the queue of {0} since {1}; estimated start: {2}.", job.printerName, formatDateTime(job.queuedAt), formatDateTime(job.estimatedStart))}
          </small>
        )}
        {job && joining && <small className="field__help">{t("The order moves to the end of this printer's queue.")}</small>}
      </label>
      {joining && (
        <label className="field" htmlFor={ids.minutes}>
          <span>{t("Print time of the whole order (minutes)")}</span>
          <input id={ids.minutes} type="number" min={1} step={1} value={minutesInput} onChange={(e) => onMinutes(e.target.value)}
            aria-invalid={minutesInvalid || undefined} />
          <small className={`field__help ${minutesInvalid ? 'is-error' : ''}`}>
            {minutes !== undefined ? `${formatDuration(minutes, durationUnits())}. ` : ''}
            {measuredMinutes !== null
              ? t("From the shop's measurements: {0}.", formatDuration(measuredMinutes, durationUnits()))
              : t("Not every item is measured: enter how long the order prints.")}
            {' '}{t("The queue adds a break of 1 h between prints.")}
          </small>
        </label>
      )}
    </div>
  );
}

function ProcessingBanner({ banner }: { banner: NonNullable<Banner> }) {
  return (
    <div className={`banner banner--${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}>
      {banner.details?.length ? <strong>{banner.text}</strong> : banner.text}
      {banner.details && banner.details.length > 0 && <ul>{banner.details.map((d) => <li key={d}>{d}</li>)}</ul>}
    </div>
  );
}

function EmailPreview({ preview, to }: { preview: StatusEmailPreview | null; to: string }) {
  if (!preview) return <p className="muted" role="status">{t("Preparing the email…")}</p>;
  return (
    <figure className="email-preview" aria-label={t("Email preview")}>
      <figcaption>
        <span className="muted">{t("To:")}</span> {to}
        <br />
        <span className="muted">{t("Subject:")}</span> <strong>{preview.subject}</strong>
      </figcaption>
      <pre className="email-preview__body">{preview.body}</pre>
    </figure>
  );
}

interface MessageProps {
  orderId: string;
  customerEmail: string;
  currentStatus: OrderStatus;
  onLogChanged: () => Promise<LogEntry[]>;
}

/** An email to the customer: written from scratch or starting from a status template, editable before sending. */
function CustomerMessage({ orderId, customerEmail, currentStatus, onLogChanged }: MessageProps) {
  const [start, setStart] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const ids = { start: useId(), subject: useId(), body: useId() };

  async function startFrom(value: string) {
    setStart(value);
    setBanner(null);
    if (!value) return;
    try {
      const email = await api.previewStatusEmail(orderId, { status: value as OrderStatus });
      setSubject(email.subject);
      setBody(email.body);
    } catch (err) {
      setBanner({ kind: 'error', text: err instanceof ApiError ? err.message : t("Could not prepare the email.") });
    }
  }

  async function sendMessage() {
    setBusy(true);
    setBanner(null);
    try {
      const entry = await api.sendMessage(orderId, { subject, body });
      setBanner(deliveryText(entry));
      await onLogChanged();
      if (entry.delivery !== 'failed') {
        setSubject('');
        setBody('');
        setStart('');
      }
    } catch (err) {
      setBanner(err instanceof ApiError
        ? { kind: 'error', text: err.message, details: err.details }
        : { kind: 'error', text: t("Could not send the email.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="customer-message">
      <h3>{t("Message the customer")}</h3>
      <p className="muted">{t("Sent to {0}. Replies arrive in your mailbox; import them into the log book as .eml files.", customerEmail)}</p>
      {banner && <ProcessingBanner banner={banner} />}
      <label className="field">
        <span>{t("Start from")}</span>
        <select id={ids.start} value={start} onChange={(e) => void startFrom(e.target.value)}>
          <option value="">{t("A blank message")}</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t("Status email: {0}", STATUS_LABELS[s])}{s === currentStatus ? ` ${t("(current)")}` : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t("Subject")}</span>
        <input id={ids.subject} value={subject} onChange={(e) => setSubject(e.target.value.replace(/[\r\n]/g, ' '))} maxLength={200} />
      </label>
      <label className="field">
        <span>{t("Message")}</span>
        <textarea id={ids.body} rows={6} value={body} onChange={(e) => setBody(e.target.value)} maxLength={20_000} />
      </label>
      <button type="button" className="btn" onClick={() => void sendMessage()} disabled={busy || !subject.trim() || !body.trim()}>
        {busy ? t("Sending…") : t("Send email")}
      </button>
    </div>
  );
}
