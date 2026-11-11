// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../api/client';
import type { EmailSentLogEntry, LogEntry, Order } from '../../types';
import { AdminOrderPage } from './AdminOrderPage';

const auth = vi.hoisted(() => ({ signOut: () => undefined }));
vi.mock('../../store/AdminAuthContext', () => ({ useAdminAuth: () => auth }));
vi.mock('../../store/ProductsContext', () => ({ useProducts: () => ({ getProduct: () => undefined }) }));

const order: Order = {
  id: 'order-1', number: 'PF-261101-ABCD', status: 'shipped', source: 'catalog', items: [], currency: 'USD', adminNote: '', customerNote: '',
  price: { mode: 'fixed', handlingFee: 5, estimated: null, reviewed: null, total: 78 },
  customer: { name: 'Anna Nowak', email: 'anna@example.com', address: { line1: 'Długa 1', city: 'Kraków', postalCode: '30-001', country: 'PL' } },
  createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z',
};
const base = { orderId: 'order-1' };
const entries: LogEntry[] = [
  {
    ...base, id: 'reply', createdAt: '2026-11-03T08:00:00.000Z', type: 'emailImported', from: 'anna@example.com', fromName: 'Anna Nowak',
    to: 'shop@example.com', subject: 'Re: Your order has shipped', body: 'Thank you!\n\nAnna', sentAt: '2026-11-02T20:00:00.000Z',
    attachments: [{ fileName: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 2048 }], emlFileId: 'f1', fromCustomer: true,
  },
  {
    ...base, id: 'failed', createdAt: '2026-11-02T12:00:00.000Z', type: 'emailSent', to: 'anna@example.com', subject: 'Gift box?',
    body: 'Would you like a gift box?', template: null, delivery: 'failed', error: 'connect ECONNREFUSED', messageId: '<f@x>',
  },
  {
    ...base, id: 'shipped-email', createdAt: '2026-11-02T10:00:00.000Z', type: 'emailSent', to: 'anna@example.com',
    subject: 'Your order PF-261101-ABCD has shipped', body: 'It is on its way.', template: 'shipped', delivery: 'sent', messageId: '<s@x>',
  },
  { ...base, id: 'shipped', createdAt: '2026-11-02T10:00:00.000Z', type: 'status', from: 'received', to: 'shipped' },
  { ...base, id: 'placed', createdAt: '2026-11-01T10:00:00.000Z', type: 'status', from: null, to: 'received' },
];

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(api, 'getOrder').mockResolvedValue(order);
  vi.spyOn(api, 'getMailDelivery').mockResolvedValue({ transport: 'smtp', from: 'PrintForge <shop@example.com>' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const buttonIn = (scope: Element, text: string) => [...scope.querySelectorAll('button')].find((b) => b.textContent === text)!;
async function until(check: () => boolean, what: string) {
  for (let i = 0; i < 200 && !check(); i++) await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  if (!check()) throw new Error(`Timed out waiting for ${what}:\n${container.textContent}`);
}
function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
const render = () => act(async () => root.render(
  <MemoryRouter initialEntries={['/admin/orders/order-1']}>
    <Routes><Route path="/admin/orders/:orderId" element={<AdminOrderPage />} /></Routes>
  </MemoryRouter>,
));

describe('log book', () => {
  it('shows status changes and every email with the customer, newest first', async () => {
    vi.spyOn(api, 'getLog').mockResolvedValue(entries);
    await render();
    await until(() => !!$('.logbook__entries'), 'the log book');
    const items = [...container.querySelectorAll('.logbook__entry')];
    expect(items.map((item) => item.querySelector('.logbook__title')?.textContent)).toEqual([
      'Email from Anna Nowak <anna@example.com> Imported',
      'Email to anna@example.com Message Not delivered',
      'Email to anna@example.com Automated: Shipped Sent',
      'Status changed: Received → Shipped',
      'Placed with status Received',
    ]);
    expect(items[0].querySelector('.logbook__body')?.textContent).toBe('Thank you!\n\nAnna');
    expect(items[0].textContent).toContain('Attachments: photo.jpg (2 KB)');
    expect(items[1].querySelector('.logbook__error')?.textContent).toBe('connect ECONNREFUSED');
    expect(items[2].querySelector('.logbook__subject')?.textContent).toBe('Your order PF-261101-ABCD has shipped');
    expect(items[0].querySelector('.logbook__tag--warning')).toBeNull();
  });

  it('imports .eml files, reporting each file that could not be added, and downloads the originals', async () => {
    const log = vi.spyOn(api, 'getLog').mockResolvedValue(entries.slice(3));
    const imported = vi.spyOn(api, 'importEml').mockImplementation(async (_id, file) => {
      if (file.name === 'again.eml') throw new ApiError(409, 'This email is already in the log book.');
      return entries[0] as never;
    });
    await render();
    await until(() => !!$('.logbook__entries'), 'the log book');
    log.mockResolvedValue(entries);
    const input = $<HTMLInputElement>('[data-testid="eml-files"]')!;
    expect(input.accept).toBe('.eml,message/rfc822');
    Object.defineProperty(input, 'files', {
      value: [new File(['From: a'], 'reply.eml'), new File(['From: a'], 'again.eml')], configurable: true,
    });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await until(() => !!$('.logbook [role="alert"]'), 'the import result');
    expect(imported.mock.calls.map(([id, file]) => [id, file.name])).toEqual([['order-1', 'reply.eml'], ['order-1', 'again.eml']]);
    expect($('.logbook [role="alert"]')?.textContent).toBe('again.eml: This email is already in the log book.');
    expect(container.querySelectorAll('.logbook__entry')).toHaveLength(5);

    const download = vi.spyOn(api, 'downloadEml').mockResolvedValue(new Blob(['From: a']));
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:eml'), revokeObjectURL: vi.fn() }));
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    await act(async () => buttonIn($('.logbook__entry')!, 'Download .eml').click());
    expect(download).toHaveBeenCalledWith('order-1', 'reply');
    expect(clicked).toEqual(['PF-261101-ABCD-2026-11-02.eml']);
  });

  it('flags imported emails from another address than the customer\'s', async () => {
    vi.spyOn(api, 'getLog').mockResolvedValue([{ ...entries[0], from: 'other@example.com', fromName: undefined, fromCustomer: false } as LogEntry]);
    await render();
    await until(() => !!$('.logbook__entries'), 'the log book');
    expect($('.logbook__entry .logbook__tag--warning')?.textContent).toBe("Not the customer's address");
  });
});

describe('messages to the customer', () => {
  it('start from a status template, stay editable, and report delivery', async () => {
    vi.spyOn(api, 'getLog').mockResolvedValue([]);
    const preview = vi.spyOn(api, 'previewStatusEmail').mockResolvedValue({
      to: 'anna@example.com', template: 'shipped', subject: 'Your order PF-261101-ABCD has shipped',
      body: 'Hello Anna Nowak,\n\nyour order is on its way.', required: ['orderNumber'], missing: [],
    });
    const sentEntry = (delivery: EmailSentLogEntry['delivery'], error?: string): EmailSentLogEntry => ({
      ...base, id: 'm', createdAt: '2026-11-03T10:00:00.000Z', type: 'emailSent', to: 'anna@example.com', subject: 's', body: 'b',
      template: null, delivery, messageId: '<m@x>', ...(error && { error }),
    });
    const send = vi.spyOn(api, 'sendMessage').mockResolvedValueOnce(sentEntry('failed', 'Sending email is not configured'))
      .mockResolvedValueOnce(sentEntry('sent'));
    await render();
    const composer = $('.customer-message')!;
    const start = composer.querySelector<HTMLSelectElement>('select')!;
    expect([...start.options].map((o) => o.textContent)).toEqual([
      'A blank message', 'Status email: Received', 'Status email: Quoted', 'Status email: Accepted', 'Status email: Paid',
      'Status email: In queue', 'Status email: Printing', 'Status email: Done', 'Status email: Shipped (current)', 'Status email: Delivered', 'Status email: Rejected', 'Status email: Cancelled',
    ]);
    expect(buttonIn(composer, 'Send email').disabled).toBe(true);
    await act(async () => {
      start.value = 'shipped';
      start.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(preview).toHaveBeenCalledWith('order-1', { status: 'shipped' });
    const subject = composer.querySelector<HTMLInputElement>('input')!;
    const body = composer.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(subject.value).toBe('Your order PF-261101-ABCD has shipped');
    await act(async () => type(body, `${body.value}\n\nTracking: PL123`));
    await act(async () => buttonIn(composer, 'Send email').click());
    expect(send).toHaveBeenCalledWith('order-1', {
      subject: 'Your order PF-261101-ABCD has shipped', body: 'Hello Anna Nowak,\n\nyour order is on its way.\n\nTracking: PL123',
    });
    // A failed delivery keeps the message for another try.
    expect(composer.querySelector('[role="alert"]')?.textContent).toBe('The email to anna@example.com could not be sent: Sending email is not configured');
    expect(subject.value).toBe('Your order PF-261101-ABCD has shipped');
    await act(async () => buttonIn(composer, 'Send email').click());
    expect(composer.querySelector('[role="status"]')?.textContent).toBe('Email sent to anna@example.com.');
    expect(subject.value).toBe('');
  });

  it('explains how emails are delivered when the server has no SMTP', async () => {
    vi.spyOn(api, 'getLog').mockResolvedValue([]);
    vi.spyOn(api, 'getMailDelivery').mockResolvedValue({ transport: 'outbox', from: 'x' });
    vi.resetModules();
    const { AdminOrderPage: Page } = await import('./AdminOrderPage');
    const { api: freshApi } = await import('../../api/client');
    vi.spyOn(freshApi, 'getOrder').mockResolvedValue(order);
    vi.spyOn(freshApi, 'getLog').mockResolvedValue([]);
    vi.spyOn(freshApi, 'getMailDelivery').mockResolvedValue({ transport: 'outbox', from: 'x' });
    await act(async () => root.render(
      <MemoryRouter initialEntries={['/admin/orders/order-1']}>
        <Routes><Route path="/admin/orders/:orderId" element={<Page />} /></Routes>
      </MemoryRouter>,
    ));
    await until(() => !!$('.order-processing .banner--info'), 'the delivery note');
    expect($('.order-processing .banner--info')?.textContent)
      .toBe("Development mode: emails are saved as files in the server's outbox folder instead of being sent.");
  });
});
