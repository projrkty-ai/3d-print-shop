import { language, t } from '../i18n';
import { CURRENCY, LOCALE, SHOP_NAME } from './config';
import {
  CUSTOM_ORDER_STATUSES, ORDER_STATUSES, type CustomOrder, type CustomOrderStatus, type EmailTemplate, type EmailTemplateKey,
  type EmailTemplates, type Order, type OrderKind, type OrderStatus,
} from './types';

/** Values templates can use as `{{name}}`. `note` is the admin's optional message for that email. */
const COMMON_VARIABLES = ['customerName', 'orderNumber', 'status', 'orderDate', 'shopName', 'note'] as const;
const ORDER_VARIABLES = [...COMMON_VARIABLES, 'total', 'items'] as const;
const CUSTOM_ORDER_VARIABLES = [...COMMON_VARIABLES, 'quotedPrice', 'files'] as const;
export type TemplateVariable = (typeof ORDER_VARIABLES)[number] | (typeof CUSTOM_ORDER_VARIABLES)[number];

export interface TemplateDefinition {
  kind: OrderKind;
  status: string;
  /** Variables the template may use. */
  variables: readonly TemplateVariable[];
  /**
   * Variables the template must contain, and which must have a value when the email is sent:
   * every email names the order; an approval states the price; cancelling or rejecting explains why.
   */
  required: readonly TemplateVariable[];
}

const REQUIRED: Record<EmailTemplateKey, readonly TemplateVariable[]> = {
  'order.pending': ['orderNumber', 'total'],
  'order.paid': ['orderNumber'],
  'order.printing': ['orderNumber'],
  'order.shipped': ['orderNumber'],
  'order.delivered': ['orderNumber'],
  'order.cancelled': ['orderNumber', 'note'],
  'customOrder.submitted': ['orderNumber', 'files'],
  'customOrder.approved': ['orderNumber', 'quotedPrice'],
  'customOrder.rejected': ['orderNumber', 'note'],
  'customOrder.printing': ['orderNumber'],
  'customOrder.shipped': ['orderNumber'],
  'customOrder.delivered': ['orderNumber'],
  'customOrder.cancelled': ['orderNumber', 'note'],
};

export const TEMPLATE_DEFINITIONS: Record<EmailTemplateKey, TemplateDefinition> = Object.fromEntries([
  ...ORDER_STATUSES.map((status) => [`order.${status}`, { kind: 'order', status, variables: ORDER_VARIABLES, required: REQUIRED[`order.${status}`] }]),
  ...CUSTOM_ORDER_STATUSES.map((status) => [
    `customOrder.${status}`, { kind: 'customOrder', status, variables: CUSTOM_ORDER_VARIABLES, required: REQUIRED[`customOrder.${status}`] },
  ]),
]) as Record<EmailTemplateKey, TemplateDefinition>;

export const TEMPLATE_KEYS = Object.keys(TEMPLATE_DEFINITIONS) as EmailTemplateKey[];

export const templateKey = (kind: OrderKind, status: string) => `${kind}.${status}` as EmailTemplateKey;

const SIGN_OFF = { en: '\n\nBest regards,\n{{shopName}}', pl: '\n\nPozdrawiamy,\n{{shopName}}' };

const EN: Record<EmailTemplateKey, EmailTemplate> = {
  'order.pending': {
    subject: 'We received your order {{orderNumber}}',
    body: 'Hello {{customerName}},\n\nthank you for your order {{orderNumber}} of {{orderDate}}:\n\n{{items}}\n\nTotal: {{total}}\n\nWe will contact you to confirm it and arrange payment.\n\n{{note}}',
  },
  'order.paid': {
    subject: 'Payment received for order {{orderNumber}}',
    body: 'Hello {{customerName}},\n\nwe received your payment for order {{orderNumber}}. We will start printing soon.\n\n{{note}}',
  },
  'order.printing': {
    subject: 'Your order {{orderNumber}} is being printed',
    body: 'Hello {{customerName}},\n\nyour order {{orderNumber}} is now being printed.\n\n{{note}}',
  },
  'order.shipped': {
    subject: 'Your order {{orderNumber}} has shipped',
    body: 'Hello {{customerName}},\n\nyour order {{orderNumber}} is on its way.\n\n{{note}}',
  },
  'order.delivered': {
    subject: 'Your order {{orderNumber}} was delivered',
    body: 'Hello {{customerName}},\n\nyour order {{orderNumber}} was delivered. We hope you enjoy your prints!\n\n{{note}}',
  },
  'order.cancelled': {
    subject: 'Your order {{orderNumber}} was cancelled',
    body: 'Hello {{customerName}},\n\nyour order {{orderNumber}} was cancelled:\n\n{{note}}',
  },
  'customOrder.submitted': {
    subject: 'We received your print request {{orderNumber}}',
    body: 'Hello {{customerName}},\n\nthank you for your print request {{orderNumber}} of {{orderDate}}:\n\n{{files}}\n\nWe will review your models and send you a price before anything is printed.\n\n{{note}}',
  },
  'customOrder.approved': {
    subject: 'Your print request {{orderNumber}} is approved',
    body: 'Hello {{customerName}},\n\nwe reviewed your models and can print them:\n\n{{files}}\n\nPrice: {{quotedPrice}}\n\nPlease reply to this email to confirm, and we will arrange payment.\n\n{{note}}',
  },
  'customOrder.rejected': {
    subject: 'We can\'t print your request {{orderNumber}}',
    body: 'Hello {{customerName}},\n\nunfortunately we can\'t print your request {{orderNumber}}:\n\n{{note}}',
  },
  'customOrder.printing': {
    subject: 'Your print request {{orderNumber}} is being printed',
    body: 'Hello {{customerName}},\n\nyour models from request {{orderNumber}} are now being printed.\n\n{{note}}',
  },
  'customOrder.shipped': {
    subject: 'Your prints from request {{orderNumber}} have shipped',
    body: 'Hello {{customerName}},\n\nyour prints from request {{orderNumber}} are on their way.\n\n{{note}}',
  },
  'customOrder.delivered': {
    subject: 'Your prints from request {{orderNumber}} were delivered',
    body: 'Hello {{customerName}},\n\nyour prints from request {{orderNumber}} were delivered. We hope you enjoy them!\n\n{{note}}',
  },
  'customOrder.cancelled': {
    subject: 'Your print request {{orderNumber}} was cancelled',
    body: 'Hello {{customerName}},\n\nyour print request {{orderNumber}} was cancelled:\n\n{{note}}',
  },
};

const PL: Record<EmailTemplateKey, EmailTemplate> = {
  'order.pending': {
    subject: 'Otrzymaliśmy Twoje zamówienie {{orderNumber}}',
    body: 'Dzień dobry {{customerName}},\n\ndziękujemy za zamówienie {{orderNumber}} z dnia {{orderDate}}:\n\n{{items}}\n\nRazem: {{total}}\n\nSkontaktujemy się, aby je potwierdzić i ustalić płatność.\n\n{{note}}',
  },
  'order.paid': {
    subject: 'Otrzymaliśmy płatność za zamówienie {{orderNumber}}',
    body: 'Dzień dobry {{customerName}},\n\notrzymaliśmy płatność za zamówienie {{orderNumber}}. Wkrótce rozpoczniemy druk.\n\n{{note}}',
  },
  'order.printing': {
    subject: 'Zamówienie {{orderNumber}} jest w druku',
    body: 'Dzień dobry {{customerName}},\n\nTwoje zamówienie {{orderNumber}} jest właśnie drukowane.\n\n{{note}}',
  },
  'order.shipped': {
    subject: 'Zamówienie {{orderNumber}} zostało wysłane',
    body: 'Dzień dobry {{customerName}},\n\nTwoje zamówienie {{orderNumber}} jest już w drodze.\n\n{{note}}',
  },
  'order.delivered': {
    subject: 'Zamówienie {{orderNumber}} zostało dostarczone',
    body: 'Dzień dobry {{customerName}},\n\nTwoje zamówienie {{orderNumber}} zostało dostarczone. Mamy nadzieję, że wydruki się spodobają!\n\n{{note}}',
  },
  'order.cancelled': {
    subject: 'Zamówienie {{orderNumber}} zostało anulowane',
    body: 'Dzień dobry {{customerName}},\n\nTwoje zamówienie {{orderNumber}} zostało anulowane:\n\n{{note}}',
  },
  'customOrder.submitted': {
    subject: 'Otrzymaliśmy Twoje zlecenie wydruku {{orderNumber}}',
    body: 'Dzień dobry {{customerName}},\n\ndziękujemy za zlecenie wydruku {{orderNumber}} z dnia {{orderDate}}:\n\n{{files}}\n\nSprawdzimy Twoje modele i przed wydrukiem podamy cenę.\n\n{{note}}',
  },
  'customOrder.approved': {
    subject: 'Zlecenie wydruku {{orderNumber}} zostało zaakceptowane',
    body: 'Dzień dobry {{customerName}},\n\nsprawdziliśmy Twoje modele i możemy je wydrukować:\n\n{{files}}\n\nCena: {{quotedPrice}}\n\nOdpowiedz na tę wiadomość, aby potwierdzić, a ustalimy płatność.\n\n{{note}}',
  },
  'customOrder.rejected': {
    subject: 'Nie możemy wykonać zlecenia {{orderNumber}}',
    body: 'Dzień dobry {{customerName}},\n\nniestety nie możemy wykonać zlecenia {{orderNumber}}:\n\n{{note}}',
  },
  'customOrder.printing': {
    subject: 'Zlecenie wydruku {{orderNumber}} jest w druku',
    body: 'Dzień dobry {{customerName}},\n\nmodele ze zlecenia {{orderNumber}} są właśnie drukowane.\n\n{{note}}',
  },
  'customOrder.shipped': {
    subject: 'Wydruki ze zlecenia {{orderNumber}} zostały wysłane',
    body: 'Dzień dobry {{customerName}},\n\nwydruki ze zlecenia {{orderNumber}} są już w drodze.\n\n{{note}}',
  },
  'customOrder.delivered': {
    subject: 'Wydruki ze zlecenia {{orderNumber}} zostały dostarczone',
    body: 'Dzień dobry {{customerName}},\n\nwydruki ze zlecenia {{orderNumber}} zostały dostarczone. Mamy nadzieję, że się spodobają!\n\n{{note}}',
  },
  'customOrder.cancelled': {
    subject: 'Zlecenie wydruku {{orderNumber}} zostało anulowane',
    body: 'Dzień dobry {{customerName}},\n\nTwoje zlecenie wydruku {{orderNumber}} zostało anulowane:\n\n{{note}}',
  },
};

/** The shipped templates in the configured language (`APP_LANGUAGE`), each ending with a sign-off. */
export function defaultTemplates(lang: 'en' | 'pl' = language): Record<EmailTemplateKey, EmailTemplate> {
  const texts = lang === 'pl' ? PL : EN;
  return Object.fromEntries(TEMPLATE_KEYS.map((key) => [key, { ...texts[key], body: texts[key].body + SIGN_OFF[lang] }])) as
    Record<EmailTemplateKey, EmailTemplate>;
}

export const createSeedEmailTemplates = (now = new Date().toISOString()): EmailTemplates => ({ templates: defaultTemplates(), updatedAt: now });

const PLACEHOLDER = /\{\{\s*([A-Za-z]+)\s*\}\}/g;

export const usedVariables = (text: string) => [...text.matchAll(PLACEHOLDER)].map((match) => match[1]);

/** Label of a template in messages, e.g. "Print request — Approved". */
export function templateLabel(key: EmailTemplateKey): string {
  const { kind, status } = TEMPLATE_DEFINITIONS[key];
  return kind === 'order'
    ? `${t('orderKindLabel')} — ${t('orderStatus', status)}`
    : `${t('customOrderKindLabel')} — ${t('customOrderStatus', status)}`;
}

export const TEMPLATE_LIMITS = { subject: 200, body: 10_000 } as const;

/**
 * Checks every status template: it must exist, have a one-line subject and a body, use only its
 * kind's variables and contain all of its required variables (in the subject or the body).
 */
export function validateEmailTemplates(templates: Partial<Record<string, EmailTemplate>>): string[] {
  const problems: string[] = [];
  for (const key of TEMPLATE_KEYS) {
    const label = templateLabel(key);
    const template = templates[key];
    if (!template) {
      problems.push(t('templateMissing', label));
      continue;
    }
    const { variables, required } = TEMPLATE_DEFINITIONS[key];
    if (!template.subject.trim()) problems.push(t('templateSubject', label));
    if (/[\r\n]/.test(template.subject)) problems.push(t('templateSubjectLine', label));
    if (!template.body.trim()) problems.push(t('templateBody', label));
    const used = new Set([...usedVariables(template.subject), ...usedVariables(template.body)]);
    for (const name of used) {
      if (!variables.includes(name as TemplateVariable)) problems.push(t('templateUnknownVariable', label, name, variables.join(', ')));
    }
    for (const name of required) {
      if (!used.has(name)) problems.push(t('templateRequiredVariable', label, name));
    }
  }
  return problems;
}

const price = (amount: number) => new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY }).format(amount);
const date = (iso: string) => new Intl.DateTimeFormat(LOCALE, { dateStyle: 'long' }).format(new Date(iso));
const mm = (value: number, digits: number) =>
  `${new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: 3 }).format(value)} mm`;

export type OrderDocument = { kind: 'order'; order: Order } | { kind: 'customOrder'; order: CustomOrder };

/**
 * Values for an email about `status`. `note` and `quotedPrice` may come from the admin's unsaved
 * form, so the preview and the sent email match what is being saved.
 */
export function templateValues(
  document: OrderDocument,
  { status, note = '', quotedPrice }: { status: string; note?: string; quotedPrice?: number | null },
): Record<TemplateVariable, string> {
  const { order } = document;
  const common = {
    customerName: order.customer.name,
    orderNumber: order.number,
    orderDate: date(order.createdAt),
    shopName: SHOP_NAME,
    note: note.trim(),
  };
  if (document.kind === 'order') {
    return {
      ...common,
      status: t('orderStatus', status),
      total: price(document.order.total),
      items: document.order.items.map((item) => `• ${item.quantity} × ${item.productName} — ${price(item.lineTotal)}`).join('\n'),
      quotedPrice: '',
      files: '',
    };
  }
  const quote = quotedPrice === undefined ? document.order.quotedPrice : quotedPrice;
  return {
    ...common,
    status: t('customOrderStatus', status),
    quotedPrice: quote === null ? '' : price(quote),
    files: document.order.files.map((file) => {
      const options = file.nozzle && file.layerHeight && file.parts
        ? ` (${[
          t('emailNozzleLayers', mm(file.nozzle.diameterMm, 1), mm(file.layerHeight.heightMm, 2)),
          ...file.parts.map((part) => `${file.parts!.length > 1 ? `${part.name}: ` : ''}${part.filament.name} ${part.color.name}`),
        ].join(', ')})`
        : '';
      return `• ${file.fileName} × ${file.quantity}${options}`;
    }).join('\n'),
    total: '',
    items: '',
  };
}

/** Required variables of the template that have no value, e.g. an approval without a quoted price. */
export function missingValues(key: EmailTemplateKey, values: Record<TemplateVariable, string>): TemplateVariable[] {
  return TEMPLATE_DEFINITIONS[key].required.filter((name) => !values[name]?.trim());
}

/** Fills in the variables; empty optional ones leave no gaps of blank lines. */
export function renderTemplate(template: EmailTemplate, values: Record<TemplateVariable, string>): EmailTemplate {
  const fill = (text: string) => text.replace(PLACEHOLDER, (_match, name: string) => values[name as TemplateVariable] ?? '');
  return {
    subject: fill(template.subject).replace(/\s+/g, ' ').trim(),
    body: fill(template.body).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
  };
}

/** Status ids of an order kind, for checking template keys and requests. */
export const statusesOf = (kind: OrderKind): readonly string[] => (kind === 'order' ? ORDER_STATUSES : CUSTOM_ORDER_STATUSES);
export type StatusOf<K extends OrderKind> = K extends 'order' ? OrderStatus : CustomOrderStatus;
