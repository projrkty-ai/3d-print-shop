import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleParser } from 'mailparser';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMailer, mailConfigFromEnv } from './mailer';

/** A local SMTP server that keeps what it receives, so delivery is tested over real SMTP. */
let server: SMTPServer;
let port: number;
const received: { from: string; to: string[]; raw: Buffer }[] = [];

beforeAll(async () => {
  server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        received.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
          to: session.envelope.rcptTo.map((r) => r.address),
          raw: Buffer.concat(chunks),
        });
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('mailer', () => {
  it('delivers plain-text UTF-8 emails over SMTP with a Message-ID on the shop domain', async () => {
    const mailer = createMailer({
      smtp: { host: '127.0.0.1', port, secure: false }, from: 'PrintForge <shop@printforge.example>', replyTo: 'help@printforge.example',
    });
    expect(mailer.transport).toBe('smtp');
    const result = await mailer.send({
      to: { name: 'Zoë Łukasiewicz', address: 'zoe@example.com' },
      subject: 'Zlecenie CP-261101-ABCD zostało zaakceptowane',
      text: 'Dzień dobry,\n\ncena: 25,00 zł — odpowiedz, aby potwierdzić.',
    });
    expect(result.delivery).toBe('sent');
    expect(result.messageId).toMatch(/^<[0-9a-f-]+@printforge\.example>$/);
    const message = received.at(-1)!;
    expect(message.from).toBe('shop@printforge.example');
    expect(message.to).toEqual(['zoe@example.com']);
    const parsed = await simpleParser(message.raw);
    expect(parsed.subject).toBe('Zlecenie CP-261101-ABCD zostało zaakceptowane');
    expect(parsed.text?.trim()).toBe('Dzień dobry,\n\ncena: 25,00 zł — odpowiedz, aby potwierdzić.');
    expect(parsed.messageId).toBe(result.messageId);
    expect(parsed.replyTo?.text).toBe('help@printforge.example');
    expect(parsed.to && !Array.isArray(parsed.to) && parsed.to.value[0]).toEqual({ name: 'Zoë Łukasiewicz', address: 'zoe@example.com' });
  });

  it('never lets a subject add headers', async () => {
    const mailer = createMailer({ smtp: { host: '127.0.0.1', port, secure: false }, from: 'shop@printforge.example' });
    await mailer.send({ to: { name: 'A', address: 'a@example.com' }, subject: 'Hello\r\nBcc: victim@example.com', text: 'x' });
    const raw = received.at(-1)!;
    expect(raw.to).toEqual(['a@example.com']);
    expect(raw.raw.toString('latin1')).not.toMatch(/^Bcc:/im);
    expect((await simpleParser(raw.raw)).subject).toBe('Hello Bcc: victim@example.com');
  });

  it('saves emails as .eml files in the outbox when no SMTP server is configured (development)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'outbox-'));
    try {
      const mailer = createMailer({ from: 'PrintForge <no-reply@localhost>', outboxDir: dir });
      expect(mailer.transport).toBe('outbox');
      const original = console.log;
      console.log = () => undefined;
      const result = await mailer.send({ to: { name: 'Anna', address: 'anna@example.com' }, subject: 'Test', text: 'Hello' }).finally(() => {
        console.log = original;
      });
      expect(result.delivery).toBe('outbox');
      const [file] = readdirSync(dir);
      const parsed = await simpleParser(readFileSync(join(dir, file)));
      expect([parsed.subject, parsed.text?.trim(), parsed.messageId]).toEqual(['Test', 'Hello', result.messageId]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports that email is not configured when there is neither SMTP nor an outbox (production)', async () => {
    const mailer = createMailer({ from: 'shop@example.com' });
    expect(mailer.transport).toBe('disabled');
    await expect(mailer.send({ to: { name: 'A', address: 'a@example.com' }, subject: 'x', text: 'x' }))
      .rejects.toThrow('Sending email is not configured on the server (SMTP_HOST and MAIL_FROM).');
  });

  it('reads its configuration from the environment', () => {
    expect(mailConfigFromEnv({})).toEqual({ from: 'PrintForge <no-reply@localhost>', outboxDir: 'data/outbox' });
    expect(mailConfigFromEnv({ NODE_ENV: 'production' })).toEqual({ from: 'PrintForge <no-reply@localhost>' });
    expect(mailConfigFromEnv({
      SMTP_HOST: 'smtp.example.com', SMTP_USER: 'shop', SMTP_PASSWORD: 'secret', MAIL_FROM: 'Shop <shop@example.com>', MAIL_REPLY_TO: 'help@example.com',
    })).toEqual({
      smtp: { host: 'smtp.example.com', port: 587, secure: false, user: 'shop', password: 'secret' },
      from: 'Shop <shop@example.com>', replyTo: 'help@example.com',
    });
    expect(mailConfigFromEnv({ SMTP_HOST: 'smtp.example.com', SMTP_SECURE: 'true', MAIL_FROM: 'shop@example.com' }).smtp?.port).toBe(465);
    expect(() => mailConfigFromEnv({ SMTP_HOST: 'smtp.example.com' })).toThrow('MAIL_FROM must be set');
    expect(() => mailConfigFromEnv({ SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'a@b.c', SMTP_PORT: 'abc' })).toThrow('SMTP_PORT');
  });
});
