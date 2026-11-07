import { t } from '../../i18n';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import type { LogEntry, MailDelivery, OrderKind } from '../../types';

export type LogState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; entries: LogEntry[] };

/** An order's log book, newest first. `reload` resolves with the fresh entries (or [] when it fails). */
export function useLogBook(kind: OrderKind, orderId: string) {
  const [state, setState] = useState<LogState>({ status: 'loading' });
  const reload = useCallback(async (): Promise<LogEntry[]> => {
    try {
      const entries = await api.getLog(kind, orderId);
      setState({ status: 'ready', entries });
      return entries;
    } catch (err) {
      setState({ status: 'error', message: err instanceof ApiError ? err.message : t("Could not load the log book.") });
      return [];
    }
  }, [kind, orderId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { state, reload };
}

let delivery: Promise<MailDelivery> | null = null;

/** How the server delivers emails; asked once per visit. Null while unknown. */
export function useMailDelivery(): MailDelivery | null {
  const [value, setValue] = useState<MailDelivery | null>(null);
  useEffect(() => {
    let cancelled = false;
    delivery ??= api.getMailDelivery().catch((err: unknown) => {
      delivery = null;
      throw err;
    });
    delivery.then((result) => !cancelled && setValue(result), () => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return value;
}

/** What to do about each required template value the email still lacks. */
export function missingValueText(name: string): string {
  if (name === 'note') return t("Write a message for the customer: this email must explain the reason.");
  if (name === 'quotedPrice') return t("Set the quoted price: this email states it.");
  return t("{0} has no value.", `{{${name}}}`);
}

/** The result of sending an email, for the banner after saving or sending. */
export function deliveryText(entry: { delivery: 'sent' | 'outbox' | 'failed'; to: string; error?: string }): { kind: 'success' | 'error'; text: string } {
  if (entry.delivery === 'failed') return { kind: 'error', text: t("The email to {0} could not be sent: {1}", entry.to, entry.error ?? '') };
  if (entry.delivery === 'outbox') return { kind: 'success', text: t("The email to {0} was saved to the server's outbox folder (development, no SMTP).", entry.to) };
  return { kind: 'success', text: t("Email sent to {0}.", entry.to) };
}
