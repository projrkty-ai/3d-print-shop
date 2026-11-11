import { formatCount, t } from '../../i18n';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, ApiError } from '../../api/client';
import { LoadState } from '../../components/LoadState';
import type { OrderStatus, QueueEntry } from '../../types';
import { formatDuration } from '../../utils/projectPricing';
import { formatDimensions } from '../../utils/sizing';
import { formatDateTime, OrderSourceBadge, OrderStatusBadge, STATUS_LABELS } from './orderDisplay';
import { PrintersNav } from './printerDisplay';
import { durationUnits } from './PricingBreakdown';
import { useAdminData } from './useAdminData';

type Banner = { kind: 'success' | 'error'; text: string; details?: string[] };

/**
 * One printer's queue: the order being printed, then the waiting orders in the order they joined,
 * with estimated start and end (a break between prints). The admin starts printing an order, marks it
 * done or takes it out of the queue; orders join from their order page (status "In queue").
 */
export function AdminPrinterQueuePage() {
  const { printerId = '' } = useParams();
  const { state, setData, reload } = useAdminData(() => api.getPrinterQueue(printerId), [printerId]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);
  const [banner, setBanner] = useState<Banner | null>(null);

  if (state.status !== 'ready') {
    return (
      <div className="admin">
        <PrintersNav />
        <Link to="/admin/printers" className="muted">{t("← All printers")}</Link>
        <LoadState load={state} onRetry={reload} loadingText={t("Loading the queue…")} />
      </div>
    );
  }
  const { printer, entries, gapMinutes } = state.data;
  const printing = entries.find((entry) => entry.printJob.startedAt);

  /** Runs an action on one order, then shows the queue as it is now. */
  async function act(entry: QueueEntry, action: () => Promise<unknown>, done: string) {
    setBusyId(entry.order.id);
    setBanner(null);
    try {
      await action();
      setData(await api.getPrinterQueue(printerId));
      setBanner({ kind: 'success', text: done });
    } catch (err) {
      setBanner(err instanceof ApiError
        ? { kind: 'error', text: `${entry.order.number}: ${err.message}`, details: err.details }
        : { kind: 'error', text: `${entry.order.number}: ${t("Something went wrong.")}` });
    } finally {
      setBusyId(null);
    }
  }

  const setStatus = (entry: QueueEntry, status: OrderStatus) =>
    act(entry, () => api.updateOrder(entry.order.id, { status, notify }), t("Order {0}: {1}.", entry.order.number, STATUS_LABELS[status]));

  function remove(entry: QueueEntry) {
    if (!window.confirm(t("Take order {0} out of the queue? It goes back to {1}.", entry.order.number, STATUS_LABELS[entry.printJob.previousStatus]))) return;
    void act(entry, () => api.removeFromQueue(entry.order.id, { notify }),
      t("Order {0} left the queue ({1}).", entry.order.number, STATUS_LABELS[entry.printJob.previousStatus]));
  }

  return (
    <div className="admin printer-queue">
      <PrintersNav />
      <Link to="/admin/printers" className="muted">{t("← All printers")}</Link>
      <div className="admin__header">
        <div>
          <h1>{t("Queue of {0}", printer.name)}</h1>
          <p className="muted">
            {[printer.model ? `${printer.model.name}, ${formatDimensions(printer.model.plate)}` : t("Missing model"), printer.location].filter(Boolean).join(' · ')}
          </p>
          <p className="muted">
            {formatCount('order', entries.length)}
            {' · '}{t("An order queued now would start {0}.", formatDateTime(printer.queue.nextStart))}
            {' '}{t("Estimates add a break of {0} between prints.", formatDuration(gapMinutes, durationUnits()))}
          </p>
        </div>
        <div className="admin__header-actions">
          <button type="button" className="btn btn--ghost" onClick={reload}>{t("Refresh")}</button>
        </div>
      </div>

      {banner && (
        <div className={`banner banner--${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}>
          {banner.details?.length ? <strong>{banner.text}</strong> : banner.text}
          {banner.details && banner.details.length > 0 && <ul>{banner.details.map((d) => <li key={d}>{d}</li>)}</ul>}
        </div>
      )}

      <label className="checkbox printer-queue__notify">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        {t("Email the customer about each status change")}
      </label>

      <div className="table-wrap">
        <table className="admin-table printer-queue__table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t("Order")}</th>
              <th>{t("Customer")}</th>
              <th>{t("Models")}</th>
              <th>{t("Status")}</th>
              <th>{t("Print time")}</th>
              <th>{t("Estimated start")}</th>
              <th>{t("Estimated end")}</th>
              <th aria-label={t("Actions")} />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const started = entry.printJob.startedAt !== null;
              const busy = busyId === entry.order.id;
              return (
                <tr key={entry.order.id} className={started ? 'printer-queue__printing' : undefined}>
                  <td>{entry.position}</td>
                  <td>
                    <Link to={`/admin/orders/${encodeURIComponent(entry.order.id)}`} className="admin-table__name mono">{entry.order.number}</Link>
                    <div><OrderSourceBadge source={entry.order.source} /></div>
                  </td>
                  <td>{entry.order.customerName}</td>
                  <td className="printer-queue__models">{entry.order.models}</td>
                  <td><OrderStatusBadge status={entry.order.status} /></td>
                  <td>{formatDuration(entry.printJob.printMinutes, durationUnits())}</td>
                  <td>
                    {formatDateTime(entry.estimatedStart)}
                    {started && <div className="muted">{t("started")}</div>}
                  </td>
                  <td>{formatDateTime(entry.estimatedEnd)}</td>
                  <td>
                    <div className="admin-table__actions">
                      {!started && (
                        <button type="button" className="btn btn--small" disabled={busy || Boolean(printing)}
                          title={printing ? t("{0} is printing order {1}: mark it done first.", printer.name, printing.order.number) : undefined}
                          onClick={() => void setStatus(entry, 'printing')}>
                          {t("Start printing")}
                        </button>
                      )}
                      <button type="button" className="btn btn--small" disabled={busy} onClick={() => void setStatus(entry, 'done')}>{t("Done")}</button>
                      <button type="button" className="btn btn--small btn--ghost btn--danger" disabled={busy} onClick={() => remove(entry)}>
                        {t("Remove from queue")}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {entries.length === 0 && (
              <tr>
                <td colSpan={9} className="muted admin-table__empty">
                  {t("No orders in this queue. Orders join it when you set their status to “In queue” on the order page.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
