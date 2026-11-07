// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../api/client';
import type { EmailTemplateKey, EmailTemplatesResponse } from '../../types';
import { AdminEmailTemplatesPage } from './AdminEmailTemplatesPage';

const auth = vi.hoisted(() => ({ signOut: () => undefined }));
vi.mock('../../store/AdminAuthContext', () => ({ useAdminAuth: () => auth }));

const ORDER_VARIABLES = ['customerName', 'orderNumber', 'status', 'orderDate', 'shopName', 'note', 'total', 'items'];
const CUSTOM_VARIABLES = ['customerName', 'orderNumber', 'status', 'orderDate', 'shopName', 'note', 'quotedPrice', 'files'];
const keys: [EmailTemplateKey, string[]][] = [
  ['order.pending', ['orderNumber', 'total']], ['order.paid', ['orderNumber']], ['order.printing', ['orderNumber']],
  ['order.shipped', ['orderNumber']], ['order.delivered', ['orderNumber']], ['order.cancelled', ['orderNumber', 'note']],
  ['customOrder.submitted', ['orderNumber', 'files']], ['customOrder.approved', ['orderNumber', 'quotedPrice']],
  ['customOrder.rejected', ['orderNumber', 'note']], ['customOrder.printing', ['orderNumber']], ['customOrder.shipped', ['orderNumber']],
  ['customOrder.delivered', ['orderNumber']], ['customOrder.cancelled', ['orderNumber', 'note']],
];

function response(): EmailTemplatesResponse {
  const templates = Object.fromEntries(keys.map(([key, required]) => [key, {
    subject: `Update on {{orderNumber}}`, body: `Hello {{customerName}}, ${required.map((name) => `{{${name}}}`).join(' ')}`,
  }])) as EmailTemplatesResponse['templates'];
  return {
    templates,
    defaults: structuredClone(templates),
    definitions: Object.fromEntries(keys.map(([key, required]) => {
      const [kind, status] = key.split('.') as ['order' | 'customOrder', string];
      return [key, { kind, status, label: key, required, variables: kind === 'order' ? ORDER_VARIABLES : CUSTOM_VARIABLES }];
    })) as EmailTemplatesResponse['definitions'],
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => callback());
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
const button = (text: string, scope: ParentNode = container) => [...scope.querySelectorAll('button')].find((b) => b.textContent === text)!;
function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
const render = () => act(async () => root.render(<MemoryRouter><AdminEmailTemplatesPage /></MemoryRouter>));

describe('email templates editor', () => {
  it('lists a template per status with its variables, checks required ones and saves', async () => {
    vi.spyOn(api, 'getEmailTemplates').mockResolvedValue(response());
    const save = vi.spyOn(api, 'updateEmailTemplates').mockImplementation(async (templates) => ({ ...response(), templates }));
    await render();
    expect([...container.querySelectorAll('.email-template h3')].map((h) => h.textContent)).toEqual([
      'Pending', 'Paid', 'Printing', 'Shipped', 'Delivered', 'Cancelled',
      'Awaiting review', 'Approved', 'Rejected', 'Printing', 'Shipped', 'Delivered', 'Cancelled',
    ]);
    expect(container.textContent).toContain('Emails are sent from PrintForge <shop@example.com>.');
    const approved = $('article[aria-label="Approved"]')!;
    expect([...approved.querySelectorAll('.variable-chip--required')].map((chip) => chip.textContent)).toEqual(['{{orderNumber}}', '{{quotedPrice}}']);
    expect(approved.querySelector<HTMLButtonElement>('.variable-chip[title^="the quoted price"]')?.textContent).toBe('{{quotedPrice}}');

    // Removing a required variable and using an unknown one is reported before saving.
    const body = approved.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => type(body, 'Hello {{customerName}}, see {{total}}.'));
    expect([...approved.querySelectorAll('.email-template__problems li')].map((li) => li.textContent)).toEqual([
      'Unknown variable {{total}}.', 'Must include {{quotedPrice}}.',
    ]);
    expect(button('Save changes').disabled).toBe(true);

    // Clicking a variable inserts it at the cursor.
    body.setSelectionRange(28, 37); // selects {{total}}
    await act(async () => button('{{quotedPrice}}', approved).click());
    expect(body.value).toBe('Hello {{customerName}}, see {{quotedPrice}}.');
    expect(approved.querySelector('.email-template__problems')).toBeNull();
    expect(button('Save changes').disabled).toBe(false);
    await act(async () => button('Save changes').click());
    expect(save.mock.calls[0][0]['customOrder.approved'].body).toBe('Hello {{customerName}}, see {{quotedPrice}}.');
    expect($('[role="status"]')?.textContent).toBe('Email templates saved.');

    // Restore brings back the shipped text.
    await act(async () => button('Restore default', approved).click());
    expect(body.value).toBe('Hello {{customerName}}, {{orderNumber}} {{quotedPrice}}');
    expect(button('Restore default', approved).disabled).toBe(true);
  });

  it('shows the problems the server reports', async () => {
    vi.spyOn(api, 'getEmailTemplates').mockResolvedValue(response());
    vi.spyOn(api, 'updateEmailTemplates').mockRejectedValue(
      new ApiError(400, 'The email templates have problems.', ['Order — Paid: the subject must be a single line.']),
    );
    await render();
    await act(async () => type($('article[aria-label="Paid"] input')!, 'Paid {{orderNumber}}!'));
    await act(async () => button('Save changes').click());
    expect($('[role="alert"]')?.textContent).toBe('The email templates have problems.Order — Paid: the subject must be a single line.');
  });
});
