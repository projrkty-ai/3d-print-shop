import { readFileSync } from 'node:fs';
import nodemailer, { type SendMailOptions } from 'nodemailer';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { defaultTemplates } from './domain/emailTemplates';
import type { Customization, LogEntry, Order, OrderInput, OrderStatus } from './domain/types';
import type { Mailer, OutgoingEmail } from './mail/mailer';
import { seedEmailTemplates, seedPrintSettings, seedProducts, type Storage } from './storage';
import { deleteAllOrders, openTestStorage } from './storage/testStorage';

const TOKEN = 'test-admin-token';
const admin = { Authorization: `Bearer ${TOKEN}` };

interface FakeMailer extends Mailer {
  sent: OutgoingEmail[];
  fail: string | null;
}

/** Records what it sends; `fail` makes the next sends throw like an unreachable SMTP server. */
const mailer: FakeMailer = {
  transport: 'smtp',
  from: 'PrintForge <shop@printforge.example>',
  sent: [] as OutgoingEmail[],
  fail: null,
  async send(email) {
    if (mailer.fail) throw new Error(mailer.fail);
    mailer.sent.push(email);
    return { delivery: 'sent', messageId: `<${mailer.sent.length}@printforge.example>` };
  },
};


let db: Storage;
let stop: (() => Promise<void>) | undefined;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  ({ storage: db, stop } = await openTestStorage('log-book'));
  app = createApp({ db, adminToken: TOKEN, mailer });
}, 120_000);

afterAll(async () => {
  await stop?.();
});

beforeEach(async () => {
  await deleteAllOrders(db);
  await seedProducts(db, { reset: true });
  await seedPrintSettings(db, { reset: true });
  await seedEmailTemplates(db, { reset: true });
  mailer.sent = [];
  mailer.fail = null;
});

const customer = { name: 'Anna Nowak', email: 'anna@example.com', address: { line1: 'Długa 1', city: 'Kraków', postalCode: '30-001', country: 'Poland' } };

const customization: Customization = {
  dimensions: { widthMm: 110, depthMm: 110, heightMm: 200 }, colorId: 'white', partColors: {},
  engravingText: '', engravingFont: 'Georgia', engravingColorId: null, textureDataUrl: null,
};

async function placeOrder(): Promise<Order> {
  const body: OrderInput = { customer, items: [{ productId: 'spiral-vase', customization, quantity: 2 }] };
  return (await request(app).post('/api/orders').send(body).expect(201)).body as Order;
}

/** An order of the customer's own model: it needs a quote. */
async function placeRequest(): Promise<Order> {
  const stl = readFileSync(new URL('../public/models/twisted-star-vase.stl', import.meta.url));
  const upload = (await request(app).post('/api/uploads').set('Content-Type', 'application/octet-stream')
    .set('X-File-Name', 'vase.stl').send(stl).expect(201)).body as { fileId: string; uploadKey: string };
  return (await request(app).post('/api/orders').send({
    source: 'upload',
    customer,
    items: [{ ...upload, quantity: 2, nozzleId: 'nozzle-0-4', layerHeightId: 'layer-0-2', parts: [{ key: 'model', name: 'Model', filamentId: 'pla', colorId: 'black' }] }],
  }).expect(201)).body as Order;
}

const logOf = async (path: string) => (await request(app).get(`${path}/log`).set(admin).expect(200)).body as LogEntry[];
const summary = (entries: LogEntry[]) => entries.map((entry) => (entry.type === 'status' ? `status ${entry.from}→${entry.to}`
  : entry.type === 'emailSent' ? `sent ${entry.delivery} ${entry.template ?? 'custom'}` : `imported ${entry.from}`));

/** An email as a mail program would save it: multipart text + HTML, with an attachment. */
async function eml(overrides: Partial<SendMailOptions> = {}): Promise<Buffer> {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
  const info = await transport.sendMail({
    from: 'Anna Nowak <Anna@Example.com>', to: 'shop@printforge.example',
    subject: 'Re: Zlecenie wydruku CP — pytanie o kolor', date: new Date('2026-11-02T09:30:00Z'),
    text: 'Dzień dobry,\n\nczy może być w kolorze złotym?\n\nAnna', html: '<p>Dzień dobry,</p><p>czy może być w kolorze <b>złotym</b>?</p>',
    messageId: '<reply-1@example.com>',
    attachments: [{ filename: 'szkic.png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47]), contentType: 'image/png' }],
    ...overrides,
  });
  return info.message as Buffer;
}

describe('log book', () => {
  it('starts with the status each order was placed with, and is private to admins', async () => {
    const order = await placeOrder();
    const printRequest = await placeRequest();
    expect(summary(await logOf(`/api/orders/${order.id}`))).toEqual(['status null→received']);
    expect(summary(await logOf(`/api/orders/${printRequest.id}`))).toEqual(['status null→received']);
    await request(app).get(`/api/orders/${order.id}/log`).expect(401);
    await request(app).post(`/api/orders/${order.id}/messages`).send({ subject: 'x', body: 'y' }).expect(401);
    await request(app).get('/api/orders/missing/log').set(admin).expect(404);
    // The public customer endpoints still work without a key.
    await request(app).post('/api/uploads').set('Content-Type', 'application/octet-stream').send(Buffer.alloc(0)).expect(400);
  });

  it('logs every status change and, when asked, emails the customer the status template', async () => {
    const order = await placeOrder();
    const path = `/api/orders/${order.id}`;
    await request(app).patch(path).set(admin).send({ status: 'paid' }).expect(200);
    expect(mailer.sent).toEqual([]);
    await request(app).patch(path).set(admin).send({ adminNote: 'Paid by transfer' }).expect(200); // no status change: not logged
    await request(app).patch(path).set(admin).send({ status: 'shipped', notify: true, note: 'Tracking number: PL123.' }).expect(200);
    expect(mailer.sent).toEqual([{
      to: { name: 'Anna Nowak', address: 'anna@example.com' },
      subject: `Your order ${order.number} has shipped`,
      text: `Hello Anna Nowak,\n\nyour order ${order.number} is on its way.\n\nTracking number: PL123.\n\nBest regards,\nPrintForge`,
    }]);
    const log = await logOf(path);
    // Newest first: the email follows the status change it announces.
    expect(summary(log)).toEqual(['sent sent shipped', 'status paid→shipped', 'status received→paid', 'status null→received']);
    expect(log[0]).toMatchObject({ to: 'anna@example.com', subject: `Your order ${order.number} has shipped`, messageId: '<1@printforge.example>' });
    // The same status again is no change: nothing is logged or sent.
    await request(app).patch(path).set(admin).send({ status: 'shipped', notify: true }).expect(200);
    expect((await logOf(path)).length).toBe(4);
  });

  it('requires the values a status email needs before changing anything, e.g. the reason for a rejection', async () => {
    const printRequest = await placeRequest();
    const path = `/api/orders/${printRequest.id}`;
    const rejected = await request(app).patch(path).set(admin).send({ status: 'rejected', notify: true, note: ' ' }).expect(400);
    expect(rejected.body).toEqual({
      error: "The email to the customer can't be sent yet.", details: ['Write a message for the customer: this email must explain the reason.'],
    });
    expect((await db.orders.get(printRequest.id))?.status).toBe('received');
    expect(summary(await logOf(path))).toEqual(['status null→received']);

    // Saving the price together with the quote fills it in.
    await request(app).patch(path).set(admin).send({ status: 'quoted', price: 24.5, notify: true }).expect(200);
    expect(mailer.sent[0].subject).toBe(`Your price for order ${printRequest.number}`);
    expect(mailer.sent[0].text).toContain('Price: $24.50');
    expect(mailer.sent[0].text).toContain('• vase.stl × 2 (nozzle 0.4 mm, layers 0.20 mm, PLA Black)');
    expect(summary(await logOf(path))).toEqual(['sent sent quoted', 'status received→quoted', 'status null→received']);
  });

  it('tells the customer the price will be quoted while an order has none', async () => {
    const printRequest = await placeRequest();
    await request(app).patch(`/api/orders/${printRequest.id}`).set(admin).send({ status: 'printing' }).expect(200);
    await request(app).patch(`/api/orders/${printRequest.id}`).set(admin).send({ status: 'received', notify: true }).expect(200);
    expect(mailer.sent[0].text).toContain('Price: to be quoted after we review your order');
    const order = await placeOrder();
    await request(app).patch(`/api/orders/${order.id}`).set(admin).send({ status: 'paid' }).expect(200);
    await request(app).patch(`/api/orders/${order.id}`).set(admin).send({ status: 'received', notify: true }).expect(200);
    expect(mailer.sent[1].text).toContain(`Price: $${order.price.total!.toFixed(2)}`);
    expect(mailer.sent[1].text).toContain(`• 2 × Spiral Vase — $${order.items[0].lineTotal!.toFixed(2)}`);
  });

  it('saves the status change and logs a failed delivery when the email cannot be sent', async () => {
    const order = await placeOrder();
    mailer.fail = 'connect ECONNREFUSED 127.0.0.1:587';
    const updated = await request(app).patch(`/api/orders/${order.id}`).set(admin).send({ status: 'paid', notify: true }).expect(200);
    expect(updated.body.status).toBe('paid');
    const [failed] = await logOf(`/api/orders/${order.id}`);
    expect(failed).toMatchObject({ type: 'emailSent', delivery: 'failed', error: 'connect ECONNREFUSED 127.0.0.1:587', template: 'paid' });
  });

  it('previews the status email from the unsaved form, listing what is missing', async () => {
    const printRequest = await placeRequest();
    const path = `/api/orders/${printRequest.id}/email-preview`;
    const missing = (await request(app).post(path).set(admin).send({ status: 'quoted' }).expect(200)).body;
    expect(missing).toMatchObject({
      to: 'anna@example.com', template: 'quoted', required: ['orderNumber', 'price'], missing: ['price'],
    });
    const ready = (await request(app).post(path).set(admin).send({ status: 'quoted', price: 30, note: 'Ready on Friday.' }).expect(200)).body;
    expect(ready.missing).toEqual([]);
    expect(ready.body).toContain('Price: $30.00\n\nPlease reply to this email to accept it, and we will arrange payment.\n\nReady on Friday.');
    await request(app).post(path).set(admin).send({ status: 'approved' }).expect(400); // not a status
    expect(mailer.sent).toEqual([]);
  });

  it('sends the admin\'s own messages and logs them', async () => {
    const order = await placeOrder();
    const path = `/api/orders/${order.id}`;
    const entry = (await request(app).post(`${path}/messages`).set(admin)
      .send({ subject: `Question about ${order.number}`, body: 'Would you like a gift box?' }).expect(201)).body;
    expect(entry).toMatchObject({ type: 'emailSent', template: null, delivery: 'sent', to: 'anna@example.com' });
    expect(mailer.sent.at(-1)?.text).toBe('Would you like a gift box?');
    for (const body of [{ subject: '', body: 'x' }, { subject: 'Hi\nBcc: x@y.z', body: 'x' }, { subject: 'Hi', body: '  ' }]) {
      await request(app).post(`${path}/messages`).set(admin).send(body).expect(400);
    }
    expect(summary(await logOf(path))).toEqual(['sent sent custom', 'status null→received']);
  });

  it('imports the customer\'s emails from .eml files, keeping the original and flagging other senders', async () => {
    const printRequest = await placeRequest();
    const path = `/api/orders/${printRequest.id}`;
    const file = await eml();
    const entry = (await request(app).post(`${path}/log/eml`).set(admin).set('Content-Type', 'message/rfc822').send(file).expect(201)).body;
    expect(entry).toMatchObject({
      type: 'emailImported', from: 'anna@example.com', fromName: 'Anna Nowak', to: 'shop@printforge.example',
      subject: 'Re: Zlecenie wydruku CP — pytanie o kolor', body: 'Dzień dobry,\n\nczy może być w kolorze złotym?\n\nAnna',
      sentAt: '2026-11-02T09:30:00.000Z', messageId: '<reply-1@example.com>', fromCustomer: true,
      attachments: [{ fileName: 'szkic.png', contentType: 'image/png', sizeBytes: 4 }],
    });
    const original = await request(app).get(`${path}/log/${entry.id}/eml`).set(admin).responseType('blob').expect(200);
    expect(Buffer.compare(original.body as Buffer, file)).toBe(0);
    expect(original.headers['content-disposition']).toMatch(new RegExp(`^attachment; filename="${printRequest.number}-\\d{4}-\\d{2}-\\d{2}\\.eml"$`));
    await request(app).get(`${path}/log/${entry.id}/eml`).expect(401);

    // The same email twice is refused; an email from another address is accepted but flagged.
    const again = await request(app).post(`${path}/log/eml`).set(admin).set('Content-Type', 'application/octet-stream').send(file).expect(409);
    expect(again.body.error).toBe('This email is already in the log book.');
    const other = (await request(app).post(`${path}/log/eml`).set(admin).set('Content-Type', 'message/rfc822')
      .send(await eml({ from: 'someone@else.example', messageId: '<other@else.example>', html: undefined, attachments: [] })).expect(201)).body;
    expect(other).toMatchObject({ from: 'someone@else.example', fromCustomer: false, attachments: [] });
    expect(summary(await logOf(path))).toEqual(['imported someone@else.example', 'imported anna@example.com', 'status null→received']);
  });

  it('reads emails saved in other encodings, and refuses files that are not emails', async () => {
    const order = await placeOrder();
    const path = `/api/orders/${order.id}/log/eml`;
    // ISO-8859-2, quoted-printable and an encoded-word subject, as older mail programs save Polish text.
    const latin2 = Buffer.from([
      'From: =?ISO-8859-2?Q?Anna_Nowak?= <anna@example.com>', 'To: shop@printforge.example',
      'Subject: =?ISO-8859-2?Q?Pytanie_o_przesy=B3k=EA?=', 'Date: Mon, 2 Nov 2026 10:00:00 +0100', 'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=ISO-8859-2', 'Content-Transfer-Encoding: quoted-printable', '',
      'Kiedy przyjdzie przesy=B3ka? Dzi=EAkuj=EA.', '',
    ].join('\r\n'), 'latin1');
    const entry = (await request(app).post(path).set(admin).set('Content-Type', 'message/rfc822').send(latin2).expect(201)).body;
    expect(entry).toMatchObject({ subject: 'Pytanie o przesyłkę', body: 'Kiedy przyjdzie przesyłka? Dziękuję.', sentAt: '2026-11-02T09:00:00.000Z' });
    expect(entry.messageId).toBeUndefined();
    const notEmail = await request(app).post(path).set(admin).set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('just some text\nwithout headers')).expect(400);
    expect(notEmail.body.error).toBe("This doesn't look like an email (.eml) file: it has no sender.");
    await request(app).post(path).set(admin).set('Content-Type', 'application/octet-stream').send(Buffer.alloc(0)).expect(400);
  });

  it('deletes the log book and imported files together with the order', async () => {
    const order = await placeOrder();
    const printRequest = await placeRequest();
    for (const path of [`/api/orders/${order.id}`, `/api/orders/${printRequest.id}`]) {
      await request(app).post(`${path}/log/eml`).set(admin).set('Content-Type', 'message/rfc822').send(await eml()).expect(201);
    }
    expect(await db.mailFiles.ids()).toHaveLength(2);
    await request(app).delete(`/api/orders/${order.id}`).set(admin).expect(204);
    await request(app).delete(`/api/orders/${printRequest.id}`).set(admin).expect(204);
    expect(await db.logBook.list(order.id)).toEqual([]);
    expect(await db.logBook.list(printRequest.id)).toEqual([]);
    expect(await db.mailFiles.ids()).toEqual([]);
  });
});

describe('email templates', () => {
  it('are editable by admins, with the variables and required ones for each status', async () => {
    await request(app).get('/api/email-templates').expect(401);
    const current = (await request(app).get('/api/email-templates').set(admin).expect(200)).body;
    expect(current.templates).toEqual(defaultTemplates('en'));
    expect(current.defaults).toEqual(defaultTemplates('en'));
    // One template per status, the same for every order.
    expect(Object.keys(current.definitions)).toEqual(['received', 'quoted', 'accepted', 'paid', 'queued', 'printing', 'done', 'shipped', 'delivered', 'rejected', 'cancelled']);
    expect(current.definitions.quoted).toEqual({
      status: 'quoted', label: 'Quoted', required: ['orderNumber', 'price'],
      variables: ['customerName', 'orderNumber', 'status', 'orderDate', 'shopName', 'note', 'price', 'items', 'printStart', 'printDuration', 'printEnd'],
    });
    expect((await request(app).get('/api/email-templates/delivery').set(admin).expect(200)).body)
      .toEqual({ transport: 'smtp', from: 'PrintForge <shop@printforge.example>' });

    const templates = { ...current.templates as Record<OrderStatus, { subject: string; body: string }> };
    templates.paid = { subject: 'Thanks, {{customerName}}! ({{orderNumber}})', body: 'Payment for {{orderNumber}} arrived.\n{{note}}' };
    const saved = (await request(app).put('/api/email-templates').set(admin).send({ templates }).expect(200)).body;
    expect(saved.templates.paid.subject).toBe('Thanks, {{customerName}}! ({{orderNumber}})');

    const order = await placeOrder();
    await request(app).patch(`/api/orders/${order.id}`).set(admin).send({ status: 'paid', notify: true }).expect(200);
    expect(mailer.sent.at(-1)).toMatchObject({ subject: `Thanks, Anna Nowak! (${order.number})`, text: `Payment for ${order.number} arrived.` });
    // An order of uploaded models gets the very same template.
    const printRequest = await placeRequest();
    await request(app).patch(`/api/orders/${printRequest.id}`).set(admin).send({ status: 'paid', notify: true }).expect(200);
    expect(mailer.sent.at(-1)).toMatchObject({ subject: `Thanks, Anna Nowak! (${printRequest.number})` });

    const broken = { ...templates, quoted: { subject: 'Quoted', body: 'Hello {{total}}' } };
    const refused = await request(app).put('/api/email-templates').set(admin).send({ templates: broken }).expect(400);
    expect(refused.body).toEqual({
      error: 'The email templates have problems.',
      details: [
        'Quoted: unknown variable {{total}}. Available: customerName, orderNumber, status, orderDate, shopName, note, price, items, printStart, printDuration, printEnd.',
        'Quoted: the template must include {{orderNumber}}.',
        'Quoted: the template must include {{price}}.',
      ],
    });
    await request(app).put('/api/email-templates').send({ templates }).expect(401);
  });
});
