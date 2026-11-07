import { formatCount, t } from '../../i18n';
import { useRef, useState } from 'react';
import { api, ApiError } from '../../api/client';
import type { EmailImportedLogEntry, EmailSentLogEntry, LogEntry, OrderKind, StatusLogEntry } from '../../types';
import { formatBytes } from './customOrderDisplay';
import type { LogState } from './logBookData';
import { formatDateTime } from './orderDisplay';

interface Props {
  kind: OrderKind;
  orderId: string;
  orderNumber: string;
  state: LogState;
  statusLabels: Record<string, string>;
  onReload: () => Promise<LogEntry[]>;
}

/**
 * Everything that happened to an order, newest first: status changes, emails the shop sent
 * (automated or written by the admin) and emails imported from .eml files, e.g. customer replies.
 */
export function LogBook({ kind, orderId, orderNumber, state, statusLabels, onReload }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const label = (status: string) => statusLabels[status] ?? status;

  /** Imports each chosen .eml file in turn, reporting every file that couldn't be added. */
  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setBanner(null);
    const problems: string[] = [];
    let imported = 0;
    for (const file of [...files]) {
      try {
        await api.importEml(kind, orderId, file);
        imported++;
      } catch (err) {
        problems.push(`${file.name}: ${err instanceof ApiError ? err.message : t("Could not import the email.")}`);
      }
    }
    if (input.current) input.current.value = '';
    if (imported > 0) await onReload();
    setBanner(problems.length > 0
      ? { kind: 'error', text: problems.join(' ') }
      : { kind: 'success', text: t("Imported {0} into the log book.", formatCount('email', imported)) });
    setBusy(false);
  }

  async function download(entry: EmailImportedLogEntry) {
    try {
      const url = URL.createObjectURL(await api.downloadEml(kind, orderId, entry.id));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${orderNumber}-${entry.sentAt.slice(0, 10)}.eml`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setBanner({ kind: 'error', text: err instanceof ApiError ? err.message : t("Could not download the email.") });
    }
  }

  return (
    <section className="card logbook" aria-label={t("Log book")}>
      <div className="card__header">
        <h2>{t("Log book")}</h2>
        <button type="button" className="btn btn--small" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? t("Importing…") : t("Import email (.eml)")}
        </button>
        <input
          ref={input}
          type="file"
          accept=".eml,message/rfc822"
          multiple
          hidden
          data-testid="eml-files"
          onChange={(e) => void importFiles(e.target.files)}
        />
      </div>
      <p className="muted card__intro">
        {t("Status changes and all emails with the customer, newest first. Save a customer's email from your mail program as an .eml file and import it here.")}
      </p>
      {banner && <p className={`banner banner--${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}>{banner.text}</p>}

      {state.status === 'loading' && <p className="muted" role="status">{t("Loading the log book…")}</p>}
      {state.status === 'error' && (
        <p className="banner banner--error" role="alert">
          {state.message} <button type="button" className="btn btn--small" onClick={() => void onReload()}>{t("Try again")}</button>
        </p>
      )}
      {state.status === 'ready' && (
        state.entries.length === 0 ? <p className="muted">{t("Nothing logged yet.")}</p> : (
          <ol className="logbook__entries">
            {state.entries.map((entry) => (
              <li key={entry.id} className={`logbook__entry logbook__entry--${entry.type}`}>
                <time className="logbook__time" dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                {entry.type === 'status' && <StatusEntry entry={entry} label={label} />}
                {entry.type === 'emailSent' && <SentEntry entry={entry} label={label} />}
                {entry.type === 'emailImported' && <ImportedEntry entry={entry} onDownload={() => void download(entry)} />}
              </li>
            ))}
          </ol>
        )
      )}
    </section>
  );
}

function StatusEntry({ entry, label }: { entry: StatusLogEntry; label: (status: string) => string }) {
  return entry.from === null
    ? <p className="logbook__title">{t("Placed with status {0}", label(entry.to))}</p>
    : (
      <p className="logbook__title">
        {t("Status changed")}: <span className="logbook__status">{label(entry.from)}</span> → <strong>{label(entry.to)}</strong>
      </p>
    );
}

function SentEntry({ entry, label }: { entry: EmailSentLogEntry; label: (status: string) => string }) {
  const delivery = {
    sent: t("Sent"),
    outbox: t("Saved to the outbox (development)"),
    failed: t("Not delivered"),
  }[entry.delivery];
  return (
    <>
      <p className="logbook__title">
        {t("Email to {0}", entry.to)}{' '}
        <span className="logbook__tag">{entry.template ? t("Automated: {0}", label(entry.template.split('.')[1])) : t("Message")}</span>{' '}
        <span className={`logbook__tag logbook__tag--${entry.delivery}`}>{delivery}</span>
      </p>
      {entry.error && <p className="logbook__error">{entry.error}</p>}
      <p className="logbook__subject">{entry.subject}</p>
      <pre className="logbook__body">{entry.body}</pre>
    </>
  );
}

function ImportedEntry({ entry, onDownload }: { entry: EmailImportedLogEntry; onDownload: () => void }) {
  const sender = entry.fromName ? `${entry.fromName} <${entry.from}>` : entry.from;
  return (
    <>
      <p className="logbook__title">
        {t("Email from {0}", sender)}{' '}
        <span className="logbook__tag">{t("Imported")}</span>
        {!entry.fromCustomer && <span className="logbook__tag logbook__tag--warning">{t("Not the customer's address")}</span>}
      </p>
      <p className="muted logbook__meta">
        {t("Sent {0} to {1}", formatDateTime(entry.sentAt), entry.to || '—')}
      </p>
      <p className="logbook__subject">{entry.subject || t("(no subject)")}</p>
      <pre className="logbook__body">{entry.body || t("(no text)")}</pre>
      {entry.attachments.length > 0 && (
        <p className="muted logbook__attachments">
          {t("Attachments:")} {entry.attachments.map((a) => `${a.fileName} (${formatBytes(a.sizeBytes)})`).join(', ')}
        </p>
      )}
      <button type="button" className="btn btn--small btn--ghost" onClick={onDownload}>{t("Download .eml")}</button>
    </>
  );
}
