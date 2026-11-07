import { randomUUID } from 'node:crypto';
import {
  defaultTemplates, missingValues, renderTemplate, TEMPLATE_DEFINITIONS, templateKey, templateValues, type OrderDocument,
  type TemplateVariable,
} from './domain/emailTemplates';
import type {
  EmailImportedLogEntry, EmailSentLogEntry, EmailTemplate, EmailTemplateKey, LogEntry, OrderKind, StatusLogEntry,
} from './domain/types';
import { HttpError } from './http';
import { t } from './i18n';
import { parseEml } from './mail/eml';
import type { Mailer } from './mail/mailer';
import type { Storage } from './storage';

const base = (orderKind: OrderKind, orderId: string) => ({
  id: randomUUID(), orderKind, orderId, createdAt: new Date().toISOString(),
});

/** Records a status change; `from` null is the status the order was placed with. */
export async function logStatus(db: Storage, orderKind: OrderKind, orderId: string, from: string | null, to: string) {
  const entry: StatusLogEntry = { ...base(orderKind, orderId), type: 'status', from, to };
  await db.logBook.insert(entry);
  return entry;
}

export async function loadOrder(db: Storage, kind: OrderKind, id: string): Promise<OrderDocument | null> {
  if (kind === 'order') {
    const order = await db.orders.get(id);
    return order && { kind, order };
  }
  const order = await db.customOrders.get(id);
  return order && { kind, order };
}

export interface StatusEmail extends EmailTemplate {
  template: EmailTemplateKey;
  /** Variables the template requires, e.g. `note` for a cancellation. */
  required: readonly TemplateVariable[];
  /** Required variables without a value: the email can't be sent until they are filled in. */
  missing: TemplateVariable[];
}

/** The email for `status`, from the admin's templates (or the defaults), with the current values. */
export async function statusEmail(
  db: Storage,
  document: OrderDocument,
  status: string,
  options: { note?: string; quotedPrice?: number | null } = {},
): Promise<StatusEmail> {
  const key = templateKey(document.kind, status);
  const template = (await db.emailTemplates.get())?.templates[key] ?? defaultTemplates()[key];
  const values = templateValues(document, { status, ...options });
  return { template: key, ...renderTemplate(template, values), required: TEMPLATE_DEFINITIONS[key].required, missing: missingValues(key, values) };
}

/** Why an email can't be sent yet, per missing required variable. */
export const missingValueMessages = (missing: TemplateVariable[]) => missing.map((name) => t('missingValue', name));

/**
 * Sends an email to the order's customer and logs it. A failed delivery doesn't throw: it is
 * logged with its error, so the admin sees it in the log book and can send it again.
 */
export async function sendToCustomer(
  db: Storage,
  mailer: Mailer,
  document: OrderDocument,
  email: { subject: string; body: string; template: EmailTemplateKey | null },
): Promise<EmailSentLogEntry> {
  const { customer } = document.order;
  let result: Pick<EmailSentLogEntry, 'delivery' | 'messageId' | 'error'>;
  try {
    result = await mailer.send({ to: { name: customer.name, address: customer.email }, subject: email.subject, text: email.body });
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    result = { delivery: 'failed', messageId: `<failed-${randomUUID()}@localhost>`, error };
  }
  const entry: EmailSentLogEntry = {
    ...base(document.kind, document.order.id), type: 'emailSent', to: customer.email,
    subject: email.subject, body: email.body, template: email.template, ...result,
  };
  await db.logBook.insert(entry);
  return entry;
}

/** Adds an email saved as .eml (e.g. the customer's reply) to the log book, keeping the original file. */
export async function importEml(db: Storage, document: OrderDocument, data: Buffer): Promise<EmailImportedLogEntry> {
  const parsed = await parseEml(data);
  if (!parsed) throw new HttpError(400, t('invalidEml'));
  const orderId = document.order.id;
  if (parsed.messageId && (await db.logBook.hasMessageId(document.kind, orderId, parsed.messageId))) {
    throw new HttpError(409, t('emlDuplicate'));
  }
  const emlFileId = await db.mailFiles.upload('message.eml', data, { orderKind: document.kind, orderId, importedAt: new Date().toISOString() });
  const { sentAt, ...email } = parsed;
  const entry: EmailImportedLogEntry = {
    ...base(document.kind, orderId), type: 'emailImported', ...email, sentAt: sentAt ?? new Date().toISOString(), emlFileId,
    fromCustomer: parsed.from === document.order.customer.email.trim().toLowerCase(),
  };
  await db.logBook.insert(entry);
  return entry;
}

/** Deletes an order's log book with the imported .eml files. */
export async function deleteLogBook(db: Storage, orderKind: OrderKind, orderId: string) {
  for (const entry of await db.logBook.deleteForOrder(orderKind, orderId)) {
    if (entry.type === 'emailImported') await db.mailFiles.delete(entry.emlFileId);
  }
}

export type { LogEntry };
