import { t } from '../../i18n';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { api, ApiError, type Notification } from '../../api/client';
import type { LogEntry, OrderKind, StatusEmailPreview } from '../../types';
import { deliveryText, missingValueText, useMailDelivery } from './logBookData';

type Banner = { kind: 'success' | 'error'; text: string; details?: string[] } | null;

interface Props {
  kind: OrderKind;
  orderId: string;
  customerEmail: string;
  savedStatus: string;
  statuses: readonly string[];
  statusLabels: Record<string, string>;
  savedAdminNote: string;
  /** Fields saved with the form (a print request's quote): whether they changed or are invalid, and the quote for previews. */
  extra?: { content: ReactNode; dirty: boolean; invalid: boolean; quotedPrice?: number | null };
  onSave: (changes: { status: string; adminNote: string } & Notification) => Promise<void>;
  /** Reloads the log book after something was logged; resolves with the fresh entries. */
  onLogChanged: () => Promise<LogEntry[]>;
}

/** How long to wait after typing before asking the server for a fresh email preview. */
const PREVIEW_DELAY_MS = 300;

/**
 * Processing an order: its status — optionally emailing the customer the status template, with a
 * preview of exactly what will be sent — the internal note, and messages to the customer.
 */
export function OrderProcessing(props: Props) {
  const { kind, orderId, customerEmail, savedStatus, statuses, statusLabels, savedAdminNote, extra, onSave, onLogChanged } = props;
  const [status, setStatus] = useState(savedStatus);
  const [adminNote, setAdminNote] = useState(savedAdminNote);
  const [notify, setNotify] = useState(true);
  const [note, setNote] = useState('');
  // The last preview stays visible while a fresher one loads; `for` says which form values it shows.
  const [preview, setPreview] = useState<(StatusEmailPreview & { for: string }) | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const delivery = useMailDelivery();
  const ids = { status: useId(), note: useId(), adminNote: useId() };

  const statusChanged = status !== savedStatus;
  const emailing = statusChanged && notify;
  const quote = extra?.quotedPrice;
  const previewKey = JSON.stringify([status, note, quote]);
  const upToDate = preview?.for === previewKey;
  const missing = emailing ? (preview?.missing ?? []) : [];
  const dirty = statusChanged || adminNote !== savedAdminNote || !!extra?.dirty;
  const canSave = dirty && !busy && !extra?.invalid && (!emailing || (upToDate && missing.length === 0));

  useEffect(() => {
    setPreviewError(null);
    if (!emailing) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.previewStatusEmail(kind, orderId, { status, note, ...(quote !== undefined && { quotedPrice: quote }) })
        .then((result) => !cancelled && setPreview({ ...result, for: previewKey }))
        .catch((err: unknown) => !cancelled && setPreviewError(err instanceof ApiError ? err.message : t("Could not prepare the email.")));
    }, PREVIEW_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [emailing, kind, orderId, status, note, quote, previewKey]);

  async function save() {
    setBusy(true);
    setBanner(null);
    try {
      await onSave({ status, adminNote, ...(statusChanged && { notify, ...(notify && note.trim() && { note }) }) });
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
            <select id={ids.status} value={status} onChange={(e) => setStatus(e.target.value)}>
              {statuses.map((s) => <option key={s} value={s}>{statusLabels[s]}</option>)}
            </select>
          </label>
          {extra?.content}
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

        {statusChanged && (
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
                    {missing.map((name) => <li key={name}>{missingValueText(name)}</li>)}
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

      <CustomerMessage
        kind={kind}
        orderId={orderId}
        customerEmail={customerEmail}
        currentStatus={savedStatus}
        statuses={statuses}
        statusLabels={statusLabels}
        onLogChanged={onLogChanged}
      />
    </section>
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
  kind: OrderKind;
  orderId: string;
  customerEmail: string;
  currentStatus: string;
  statuses: readonly string[];
  statusLabels: Record<string, string>;
  onLogChanged: () => Promise<LogEntry[]>;
}

/** An email to the customer: written from scratch or starting from a status template, editable before sending. */
function CustomerMessage({ kind, orderId, customerEmail, currentStatus, statuses, statusLabels, onLogChanged }: MessageProps) {
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
      const email = await api.previewStatusEmail(kind, orderId, { status: value });
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
      const entry = await api.sendMessage(kind, orderId, { subject, body });
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
          {statuses.map((s) => (
            <option key={s} value={s}>
              {t("Status email: {0}", statusLabels[s])}{s === currentStatus ? ` ${t("(current)")}` : ''}
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
