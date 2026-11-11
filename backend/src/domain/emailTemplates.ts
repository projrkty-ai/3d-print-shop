import { language, t } from '../i18n';
import { CURRENCY, LOCALE, SHOP_NAME } from './config';
import { ORDER_STATUSES, type EmailTemplate, type EmailTemplates, type Order, type OrderItem, type OrderStatus } from './types';

/**
 * Values templates can use as `{{name}}` — the same for every order, whatever its models. `note` is
 * the admin's optional message for that email; `price` is the order's price (or says it will be
 * quoted); `items` lists what is printed, one line per item. While the order is in a printer's
 * queue, `printStart` is when its print is expected to start (or started), `printDuration` how long
 * it prints and `printEnd` when it should be printed.
 */
export const TEMPLATE_VARIABLES = [
  'customerName', 'orderNumber', 'status', 'orderDate', 'shopName', 'note', 'price', 'items', 'printStart', 'printDuration', 'printEnd',
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export interface TemplateDefinition {
  status: OrderStatus;
  /** Variables the template may use. */
  variables: readonly TemplateVariable[];
  /**
   * Variables the template must contain, and which must have a value when the email is sent:
   * every email names the order; the first one lists it; a quote states the price; rejecting or
   * cancelling explains why.
   */
  required: readonly TemplateVariable[];
}

const REQUIRED: Record<OrderStatus, readonly TemplateVariable[]> = {
  received: ['orderNumber', 'items'],
  quoted: ['orderNumber', 'price'],
  accepted: ['orderNumber'],
  paid: ['orderNumber'],
  queued: ['orderNumber', 'printStart', 'printDuration'],
  printing: ['orderNumber'],
  done: ['orderNumber'],
  shipped: ['orderNumber'],
  delivered: ['orderNumber'],
  rejected: ['orderNumber', 'note'],
  cancelled: ['orderNumber', 'note'],
};

export const TEMPLATE_DEFINITIONS = Object.fromEntries(
  ORDER_STATUSES.map((status): [OrderStatus, TemplateDefinition] => [status, { status, variables: TEMPLATE_VARIABLES, required: REQUIRED[status] }]),
) as Record<OrderStatus, TemplateDefinition>;

export const TEMPLATE_KEYS: readonly OrderStatus[] = ORDER_STATUSES;

const SIGN_OFF = { en: '\n\nBest regards,\n{{shopName}}', pl: '\n\nPozdrawiamy,\n{{shopName}}' };

const EN: Record<OrderStatus, EmailTemplate> = {
  received: {
    subject: 'We received your order {{orderNumber}}',
    body: 'Hello {{customerName}},\n\nthank you for your order {{orderNumber}} of {{orderDate}}:\n\n{{items}}\n\nPrice: {{price}}\n\nWe will contact you to confirm it and arrange payment.\n\n{{note}}',
  },
  quoted: {
    subject: 'Your price for order {{orderNumber}}',
    body: 'Hello {{customerName}},\n\nwe reviewed your order {{orderNumber}} and can print it:\n\n{{items}}\n\nPrice: {{price}}\n\nPlease reply to this email to accept it, and we will arrange payment.\n\n{{note}}',
  },
  accepted: {
    subject: 'Order {{orderNumber}} confirmed',
    body: 'Hello {{customerName}},\n\nthank you for accepting the price of order {{orderNumber}} ({{price}}). We will send you the payment details.\n\n{{note}}',
  },
  paid: {
    subject: 'Payment received for order {{orderNumber}}',
    body: 'Hello {{customerName}},\n\nwe received your payment for order {{orderNumber}}. We will start printing soon.\n\n{{note}}',
  },
  queued: {
    subject: 'Your order {{orderNumber}} is in the print queue',
    body: 'Hello {{customerName}},\n\nyour order {{orderNumber}} is in our print queue. We expect to start printing it around {{printStart}}. Printing takes about {{printDuration}}, so it should be printed by {{printEnd}}.\n\n{{note}}',
  },
  done: {
    subject: 'Your order {{orderNumber}} has been printed',
    body: 'Hello {{customerName}},\n\nyour order {{orderNumber}} has been printed. We will pack it and let you know when it ships.\n\n{{note}}',
  },
  printing: {
    subject: 'Your order {{orderNumber}} is being printed',
    body: 'Hello {{customerName}},\n\nyour order {{orderNumber}} is now being printed.\n\n{{note}}',
  },
  shipped: {
    subject: 'Your order {{orderNumber}} has shipped',
    body: 'Hello {{customerName}},\n\nyour order {{orderNumber}} is on its way.\n\n{{note}}',
  },
  delivered: {
    subject: 'Your order {{orderNumber}} was delivered',
    body: 'Hello {{customerName}},\n\nyour order {{orderNumber}} was delivered. We hope you enjoy your prints!\n\n{{note}}',
  },
  rejected: {
    subject: 'We can\'t print your order {{orderNumber}}',
    body: 'Hello {{customerName}},\n\nunfortunately we can\'t print your order {{orderNumber}}:\n\n{{note}}',
  },
  cancelled: {
    subject: 'Your order {{orderNumber}} was cancelled',
    body: 'Hello {{customerName}},\n\nyour order {{orderNumber}} was cancelled:\n\n{{note}}',
  },
};

const PL: Record<OrderStatus, EmailTemplate> = {
  received: {
    subject: 'Otrzymaliśmy Twoje zamówienie {{orderNumber}}',
    body: 'Dzień dobry {{customerName}},\n\ndziękujemy za zamówienie {{orderNumber}} z dnia {{orderDate}}:\n\n{{items}}\n\nCena: {{price}}\n\nSkontaktujemy się, aby je potwierdzić i ustalić płatność.\n\n{{note}}',
  },
  quoted: {
    subject: 'Wycena zamówienia {{orderNumber}}',
    body: 'Dzień dobry {{customerName}},\n\nsprawdziliśmy zamówienie {{orderNumber}} i możemy je wydrukować:\n\n{{items}}\n\nCena: {{price}}\n\nOdpowiedz na tę wiadomość, aby zaakceptować wycenę, a ustalimy płatność.\n\n{{note}}',
  },
  accepted: {
    subject: 'Zamówienie {{orderNumber}} zostało potwierdzone',
    body: 'Dzień dobry {{customerName}},\n\ndziękujemy za akceptację ceny zamówienia {{orderNumber}} ({{price}}). Prześlemy dane do płatności.\n\n{{note}}',
  },
  paid: {
    subject: 'Otrzymaliśmy płatność za zamówienie {{orderNumber}}',
    body: 'Dzień dobry {{customerName}},\n\notrzymaliśmy płatność za zamówienie {{orderNumber}}. Wkrótce rozpoczniemy druk.\n\n{{note}}',
  },
  queued: {
    subject: 'Zamówienie {{orderNumber}} czeka w kolejce do druku',
    body: 'Dzień dobry {{customerName}},\n\nTwoje zamówienie {{orderNumber}} jest w naszej kolejce druku. Spodziewamy się rozpocząć druk około {{printStart}}. Drukowanie potrwa około {{printDuration}}, więc zamówienie powinno być wydrukowane do {{printEnd}}.\n\n{{note}}',
  },
  done: {
    subject: 'Zamówienie {{orderNumber}} zostało wydrukowane',
    body: 'Dzień dobry {{customerName}},\n\nTwoje zamówienie {{orderNumber}} zostało wydrukowane. Zapakujemy je i damy znać, gdy zostanie wysłane.\n\n{{note}}',
  },
  printing: {
    subject: 'Zamówienie {{orderNumber}} jest w druku',
    body: 'Dzień dobry {{customerName}},\n\nTwoje zamówienie {{orderNumber}} jest właśnie drukowane.\n\n{{note}}',
  },
  shipped: {
    subject: 'Zamówienie {{orderNumber}} zostało wysłane',
    body: 'Dzień dobry {{customerName}},\n\nTwoje zamówienie {{orderNumber}} jest już w drodze.\n\n{{note}}',
  },
  delivered: {
    subject: 'Zamówienie {{orderNumber}} zostało dostarczone',
    body: 'Dzień dobry {{customerName}},\n\nTwoje zamówienie {{orderNumber}} zostało dostarczone. Mamy nadzieję, że wydruki się spodobają!\n\n{{note}}',
  },
  rejected: {
    subject: 'Nie możemy wykonać zamówienia {{orderNumber}}',
    body: 'Dzień dobry {{customerName}},\n\nniestety nie możemy wykonać zamówienia {{orderNumber}}:\n\n{{note}}',
  },
  cancelled: {
    subject: 'Zamówienie {{orderNumber}} zostało anulowane',
    body: 'Dzień dobry {{customerName}},\n\nTwoje zamówienie {{orderNumber}} zostało anulowane:\n\n{{note}}',
  },
};

/** The shipped templates in the configured language (`APP_LANGUAGE`), each ending with a sign-off. */
export function defaultTemplates(lang: 'en' | 'pl' = language): Record<OrderStatus, EmailTemplate> {
  const texts = lang === 'pl' ? PL : EN;
  return Object.fromEntries(TEMPLATE_KEYS.map((key) => [key, { ...texts[key], body: texts[key].body + SIGN_OFF[lang] }])) as
    Record<OrderStatus, EmailTemplate>;
}

export const createSeedEmailTemplates = (now = new Date().toISOString()): EmailTemplates => ({ templates: defaultTemplates(), updatedAt: now });

const PLACEHOLDER = /\{\{\s*([A-Za-z]+)\s*\}\}/g;

export const usedVariables = (text: string) => [...text.matchAll(PLACEHOLDER)].map((match) => match[1]);

/** Label of a template in messages: its status, e.g. "Quoted". */
export const templateLabel = (status: OrderStatus): string => t('orderStatus', status);

export const TEMPLATE_LIMITS = { subject: 200, body: 10_000 } as const;

/**
 * Checks every status template: it must exist, have a one-line subject and a body, use only known
 * variables and contain all of its required variables (in the subject or the body).
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

const money = (amount: number) => new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY }).format(amount);
/** A moment in the server's time zone (`TZ`), named, e.g. "November 5, 2026 at 02:30 PM UTC". */
export const formatMoment = (time: number) => new Intl.DateTimeFormat(LOCALE, {
  year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
}).format(new Date(time));
/** A print time, e.g. "3 h 20 min". */
export const printDuration = (minutes: number) => t('printDuration', Math.floor(Math.round(minutes) / 60), Math.round(minutes) % 60);
const date = (iso: string) => new Intl.DateTimeFormat(LOCALE, { dateStyle: 'long' }).format(new Date(iso));
const mm = (value: number, digits: number) =>
  `${new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: 3 }).format(value)} mm`;

/** What is printed, in one line: the only part of an email that depends on the order's source. */
export function itemLine(item: OrderItem, order: Pick<Order, 'project'>): string {
  const { model, quantity } = item;
  const price = item.lineTotal === null ? '' : ` — ${money(item.lineTotal)}`;
  switch (model.source) {
    case 'catalog':
      return `• ${quantity} × ${model.productName}${price}`;
    case 'printOnDemand':
      return `• ${quantity} × ${model.title}${price}`;
    case 'upload': {
      const options = [
        ...(model.nozzle && model.layerHeight ? [t('emailNozzleLayers', mm(model.nozzle.diameterMm, 1), mm(model.layerHeight.heightMm, 2))] : []),
        ...(model.parts ?? []).map((part) => `${model.parts!.length > 1 ? `${part.name}: ` : ''}${part.filament.name} ${part.color.name}`),
      ];
      return `• ${model.fileName} × ${quantity}${options.length > 0 ? ` (${options.join(', ')})` : ''}${price}`;
    }
    case 'project': {
      const filaments = model.filaments.map((filament) => [filament.material === 'any' ? '' : filament.material, filament.color].filter(Boolean).join(' '))
        .filter(Boolean);
      const options = [`${model.scalePercent}%`, ...filaments];
      return `• ${model.file?.name ?? order.project?.title ?? ''} × ${quantity} (${options.join(', ')})${price}`;
    }
  }
}

/**
 * Values for an email about `status`. `note` and `price` may come from the admin's unsaved form,
 * so the preview and the sent email match what is being saved. `price` is empty (and so missing)
 * while the order has none; the rendered text then says it will be quoted.
 */
export function templateValues(
  order: Order,
  { status, note = '', price }: { status: OrderStatus; note?: string; price?: number | null },
): Record<TemplateVariable, string> {
  const total = price === undefined ? order.price.total : price;
  const job = order.printJob;
  const start = job ? Date.parse(job.startedAt ?? job.estimatedStart) : null;
  return {
    customerName: order.customer.name,
    orderNumber: order.number,
    status: t('orderStatus', status),
    orderDate: date(order.createdAt),
    shopName: SHOP_NAME,
    note: note.trim(),
    price: total === null ? '' : money(total),
    items: order.items.map((item) => itemLine(item, order)).join('\n'),
    printStart: job && start !== null ? formatMoment(start) : '',
    printDuration: job ? printDuration(job.printMinutes) : '',
    printEnd: job && start !== null ? formatMoment(start + job.printMinutes * 60_000) : '',
  };
}

/** Required variables of the template that have no value, e.g. a quote without a price. */
export function missingValues(status: OrderStatus, values: Record<TemplateVariable, string>): TemplateVariable[] {
  return TEMPLATE_DEFINITIONS[status].required.filter((name) => !values[name]?.trim());
}

/** Fills in the variables; empty optional ones leave no gaps of blank lines, and a missing price says it will be quoted. */
export function renderTemplate(template: EmailTemplate, values: Record<TemplateVariable, string>): EmailTemplate {
  const filled: Record<TemplateVariable, string> = { ...values, price: values.price || t('priceToBeQuoted') };
  const fill = (text: string) => text.replace(PLACEHOLDER, (_match, name: string) => filled[name as TemplateVariable] ?? '');
  return {
    subject: fill(template.subject).replace(/\s+/g, ' ').trim(),
    body: fill(template.body).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
  };
}
