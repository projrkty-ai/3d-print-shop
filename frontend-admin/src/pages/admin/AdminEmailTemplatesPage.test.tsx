// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../api/client';
import type { EmailTemplatesResponse, OrderStatus } from '../../types';
import { AdminEmailTemplatesPage } from './AdminEmailTemplatesPage';

const auth = vi.hoisted(() => ({ signOut: () => undefined }));
vi.mock('../../store/AdminAuthContext', () => ({ useAdminAuth: () => auth }));

const VARIABLES = ['customerName', 'orderNumber', 'status', 'orderDate', 'shopName', 'note', 'price', 'items'];
const keys: [OrderStatus, string[]][] = [
  ['received', ['orderNumber', 'items']], ['quoted', ['orderNumber', 'price']], ['accepted', ['orderNumber']], ['paid', ['orderNumber']],
  ['printing', ['orderNumber']], ['shipped', ['orderNumber']], ['delivered', ['orderNumber']], ['rejected', ['orderNumber', 'note']],
  ['cancelled', ['orderNumber', 'note']],
];

function response(): EmailTemplatesResponse {
  const templates = Object.fromEntries(keys.map(([key, required]) => [key, {
    subject: `Update on {{orderNumber}}`, body: `Hello {{customerName}}, ${required.map((name) => `{{${name}}}`).join(' ')}`,
  }])) as EmailTemplatesResponse['templates'];
  return {
    templates,
    defaults: structuredClone(templates),
    definitions: Object.fromEntries(keys.map(([key, required]) => [key, { status: key, label: key, required, variables: VARIABLES }])) as
      EmailTemplatesResponse['definitions'],
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
  it('lists one template per status, shared by every order, with its variables, checks required ones and saves', async () => {
    vi.spyOn(api, 'getEmailTemplates').mockResolvedValue(response());
    const save = vi.spyOn(api, 'updateEmailTemplates').mockImplementation(async (templates) => ({ ...response(), templates }));
    await render();
    expect([...container.querySelectorAll('.email-template h3')].map((h) => h.textContent)).toEqual([
      'Received', 'Quoted', 'Accepted', 'Paid', 'Printing', 'Shipped', 'Delivered', 'Rejected', 'Cancelled',
    ]);
    expect([...container.querySelectorAll('.email-templates h2')].map((h) => h.textContent)).toEqual(['Order statuses']);
    expect(container.textContent).toContain('Emails are sent from PrintForge <shop@example.com>.');
    const approved = $('article[aria-label="Quoted"]')!;
    expect([...approved.querySelectorAll('.variable-chip--required')].map((chip) => chip.textContent)).toEqual(['{{orderNumber}}', '{{price}}']);
    expect(approved.querySelector<HTMLButtonElement>('.variable-chip[title^="the order\'s price"]')?.textContent).toBe('{{price}}');
    expect(approved.querySelector<HTMLButtonElement>('.variable-chip[title^="what is printed"]')?.textContent).toBe('{{items}}');

    // Removing a required variable and using an unknown one is reported before saving.
    const body = approved.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => type(body, 'Hello {{customerName}}, see {{total}}.'));
    expect([...approved.querySelectorAll('.email-template__problems li')].map((li) => li.textContent)).toEqual([
      'Unknown variable {{total}}.', 'Must include {{price}}.',
    ]);
    expect(button('Save changes').disabled).toBe(true);

    // Clicking a variable inserts it at the cursor.
    body.setSelectionRange(28, 37); // selects {{total}}
    await act(async () => button('{{price}}', approved).click());
    expect(body.value).toBe('Hello {{customerName}}, see {{price}}.');
    expect(approved.querySelector('.email-template__problems')).toBeNull();
    expect(button('Save changes').disabled).toBe(false);
    await act(async () => button('Save changes').click());
    expect(save.mock.calls[0][0].quoted.body).toBe('Hello {{customerName}}, see {{price}}.');
    expect($('[role="status"]')?.textContent).toBe('Email templates saved.');

    // Restore brings back the shipped text.
    await act(async () => button('Restore default', approved).click());
    expect(body.value).toBe('Hello {{customerName}}, {{orderNumber}} {{price}}');
    expect(button('Restore default', approved).disabled).toBe(true);
  });

  it('shows the problems the server reports', async () => {
    vi.spyOn(api, 'getEmailTemplates').mockResolvedValue(response());
    vi.spyOn(api, 'updateEmailTemplates').mockRejectedValue(
      new ApiError(400, 'The email templates have problems.', ['Paid: the subject must be a single line.']),
    );
    await render();
    await act(async () => type($('article[aria-label="Paid"] input')!, 'Paid {{orderNumber}}!'));
    await act(async () => button('Save changes').click());
    expect($('[role="alert"]')?.textContent).toBe('The email templates have problems.Paid: the subject must be a single line.');
  });
});
