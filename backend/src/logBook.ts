import { randomUUID } from 'node:crypto';
import {
  defaultTemplates, missingValues, renderTemplate, TEMPLATE_DEFINITIONS, templateValues, type TemplateVariable,
} from './domain/emailTemplates';
import type {
  EmailImportedLogEntry, EmailSentLogEntry, EmailTemplate, LogEntry, Order, OrderStatus, StatusLogEntry,
} from './domain/types';
import { HttpError } from './http';
import { t } from './i18n';
import { parseEml } from './mail/eml';
import type { Mailer } from './mail/mailer';
import type { Storage } from './storage';

const base = (orderId: string) => ({ id: randomUUID(), orderId, createdAt: new Date().toISOString() });

/** Records a status change; `from` null is the status the order was placed with. */
export async function logStatus(db: Storage, orderId: string, from: string | null, to: string) {
  const entry: StatusLogEntry = { ...base(orderId), type: 'status', from, to };
  await db.logBook.insert(entry);
  return entry;
}

export interface StatusEmail extends EmailTemplate {
  template: OrderStatus;
  /** Variables the template requires, e.g. `note` for a cancellation. */
  required: readonly TemplateVariable[];
  /** Required variables without a value: the email can't be sent until they are filled in. */
  missing: TemplateVariable[];
}

/** The email for `status`, from the admin's templates (or the defaults), with the current values. */
export async function statusEmail(
  db: Storage,
  order: Order,
  status: OrderStatus,
  options: { note?: string; price?: number | null } = {},
): Promise<StatusEmail> {
  const template = (await db.emailTemplates.get())?.templates[status] ?? defaultTemplates()[status];
  const values = templateValues(order, { status, ...options });
  return { template: status, ...renderTemplate(template, values), required: TEMPLATE_DEFINITIONS[status].required, missing: missingValues(status, values) };
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
  order: Order,
  email: { subject: string; body: string; template: OrderStatus | null },
): Promise<EmailSentLogEntry> {
  const { customer } = order;
  let result: Pick<EmailSentLogEntry, 'delivery' | 'messageId' | 'error'>;
  try {
    result = await mailer.send({ to: { name: customer.name, address: customer.email }, subject: email.subject, text: email.body });
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    result = { delivery: 'failed', messageId: `<failed-${randomUUID()}@localhost>`, error };
  }
  const entry: EmailSentLogEntry = {
    ...base(order.id), type: 'emailSent', to: customer.email,
    subject: email.subject, body: email.body, template: email.template, ...result,
  };
  await db.logBook.insert(entry);
  return entry;
}

/** Adds an email saved as .eml (e.g. the customer's reply) to the log book, keeping the original file. */
export async function importEml(db: Storage, order: Order, data: Buffer): Promise<EmailImportedLogEntry> {
  const parsed = await parseEml(data);
  if (!parsed) throw new HttpError(400, t('invalidEml'));
  if (parsed.messageId && (await db.logBook.hasMessageId(order.id, parsed.messageId))) {
    throw new HttpError(409, t('emlDuplicate'));
  }
  const emlFileId = await db.mailFiles.upload('message.eml', data, { orderId: order.id, importedAt: new Date().toISOString() });
  const { sentAt, ...email } = parsed;
  const entry: EmailImportedLogEntry = {
    ...base(order.id), type: 'emailImported', ...email, sentAt: sentAt ?? new Date().toISOString(), emlFileId,
    fromCustomer: parsed.from === order.customer.email.trim().toLowerCase(),
  };
  await db.logBook.insert(entry);
  return entry;
}

/** Deletes an order's log book with the imported .eml files. */
export async function deleteLogBook(db: Storage, orderId: string) {
  for (const entry of await db.logBook.deleteForOrder(orderId)) {
    if (entry.type === 'emailImported') await db.mailFiles.delete(entry.emlFileId);
  }
}

export type { LogEntry };
