import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import { t } from '../i18n';

export interface OutgoingEmail {
  to: { name: string; address: string };
  subject: string;
  text: string;
}

export type MailTransport = 'smtp' | 'outbox' | 'disabled';

/** Sends the shop's emails to customers. `send` resolves with how the email left, or throws. */
export interface Mailer {
  readonly transport: MailTransport;
  /** The From address, e.g. `PrintForge <shop@example.com>`. */
  readonly from: string;
  send(email: OutgoingEmail): Promise<{ delivery: 'sent' | 'outbox'; messageId: string }>;
}

export interface MailConfig {
  /** SMTP server; without it, development saves emails to `outboxDir` and production can't send. */
  smtp?: { host: string; port: number; secure: boolean; user?: string; password?: string };
  from: string;
  replyTo?: string;
  outboxDir?: string;
}

/** `Name <address>` or a bare address → the address part, for Message-ID domains. */
const addressOf = (mailbox: string) => /<([^>]+)>/.exec(mailbox)?.[1] ?? mailbox.trim();

function messageId(from: string): string {
  const domain = addressOf(from).split('@')[1] || 'localhost';
  return `<${randomUUID()}@${domain}>`;
}

function envelope(config: MailConfig, email: OutgoingEmail, id: string) {
  return {
    from: config.from,
    ...(config.replyTo && { replyTo: config.replyTo }),
    to: { name: email.to.name, address: email.to.address },
    // Subjects are single lines; stripping line breaks rules out header injection from any source.
    subject: email.subject.replace(/[\r\n]+/g, ' '),
    text: email.text,
    messageId: id,
    date: new Date(),
  };
}

/**
 * SMTP when configured; otherwise development writes each email as an .eml file to the outbox
 * folder (open it with any mail program), and production reports that email isn't configured.
 */
export function createMailer(config: MailConfig): Mailer {
  if (config.smtp) {
    const { host, port, secure, user, password } = config.smtp;
    const transporter: Transporter = nodemailer.createTransport({
      host, port, secure,
      // Credentials only ever travel encrypted: without implicit TLS, STARTTLS is mandatory.
      requireTLS: !secure && Boolean(user),
      ...(user && { auth: { user, pass: password ?? '' } }),
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    return {
      transport: 'smtp',
      from: config.from,
      async send(email) {
        const id = messageId(config.from);
        await transporter.sendMail(envelope(config, email, id));
        return { delivery: 'sent', messageId: id };
      },
    };
  }
  if (config.outboxDir) {
    const dir = resolve(config.outboxDir);
    const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
    return {
      transport: 'outbox',
      from: config.from,
      async send(email) {
        const id = messageId(config.from);
        const info = await transporter.sendMail(envelope(config, email, id));
        await mkdir(dir, { recursive: true });
        const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${id.slice(1, 9)}.eml`);
        await writeFile(file, info.message as Buffer);
        console.log(`Email to ${email.to.address} saved to ${file} (no SMTP_HOST configured).`);
        return { delivery: 'outbox', messageId: id };
      },
    };
  }
  return {
    transport: 'disabled',
    from: config.from,
    async send() {
      throw new Error(t('mailNotConfigured'));
    },
  };
}

/** Reads SMTP_*, MAIL_FROM, MAIL_REPLY_TO and MAIL_OUTBOX_DIR; throws on settings that can't work. */
export function mailConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MailConfig {
  const production = env.NODE_ENV === 'production';
  const from = env.MAIL_FROM || 'PrintForge <no-reply@localhost>';
  const host = env.SMTP_HOST?.trim();
  if (host) {
    if (!env.MAIL_FROM) throw new Error('MAIL_FROM must be set when SMTP_HOST is set, e.g. "PrintForge <shop@example.com>".');
    const secure = env.SMTP_SECURE === 'true';
    const port = Number(env.SMTP_PORT || (secure ? 465 : 587));
    if (!Number.isInteger(port) || port <= 0) throw new Error(`SMTP_PORT must be a port number, not "${env.SMTP_PORT}".`);
    return {
      smtp: { host, port, secure, user: env.SMTP_USER || undefined, password: env.SMTP_PASSWORD || undefined },
      from,
      ...(env.MAIL_REPLY_TO && { replyTo: env.MAIL_REPLY_TO }),
    };
  }
  return {
    from,
    ...(env.MAIL_REPLY_TO && { replyTo: env.MAIL_REPLY_TO }),
    ...(!production && { outboxDir: env.MAIL_OUTBOX_DIR || 'data/outbox' }),
  };
}
