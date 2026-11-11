import { simpleParser, type AddressObject } from 'mailparser';
import type { EmailAttachment } from '../domain/types';

/** Imported text is capped so one huge email can't bloat the log book. */
export const EML_TEXT_LIMIT = 100_000;
export const EML_MAX_BYTES = 15 * 1024 * 1024;

export interface ParsedEmail {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  body: string;
  /** ISO date from the Date header; null when missing or invalid. */
  sentAt: string | null;
  messageId?: string;
  attachments: EmailAttachment[];
}

const addresses = (value: AddressObject | AddressObject[] | undefined) =>
  (Array.isArray(value) ? value : value ? [value] : []).flatMap((object) => object.value);

/**
 * Reads an .eml file (RFC 822 / MIME, as saved by mail programs): sender, recipients, subject,
 * date and the plain text of the message — generated from the HTML part when there is no text
 * part — plus the names of its attachments. Null when it isn't an email (no sender address).
 */
export async function parseEml(data: Buffer): Promise<ParsedEmail | null> {
  let parsed;
  try {
    parsed = await simpleParser(data, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true });
  } catch {
    return null;
  }
  const [sender] = addresses(parsed.from);
  if (!sender?.address) return null;
  const text = (parsed.text ?? '').replace(/\r\n/g, '\n').trim();
  return {
    from: sender.address.toLowerCase(),
    ...(sender.name && { fromName: sender.name }),
    to: addresses(parsed.to).map((a) => a.address).filter(Boolean).join(', '),
    subject: parsed.subject ?? '',
    body: text.length > EML_TEXT_LIMIT ? `${text.slice(0, EML_TEXT_LIMIT)}…` : text,
    sentAt: parsed.date && !Number.isNaN(parsed.date.getTime()) ? parsed.date.toISOString() : null,
    ...(parsed.messageId && { messageId: parsed.messageId }),
    attachments: parsed.attachments
      .filter((attachment) => attachment.contentDisposition !== 'inline' || attachment.filename)
      .map((attachment) => ({
        fileName: attachment.filename ?? 'attachment',
        contentType: attachment.contentType,
        sizeBytes: attachment.size,
      })),
  };
}
