import type { EmailTemplate, EmailTemplates, OrderStatus } from '../domain/types';
import { defaultTemplates, validateEmailTemplates } from '../domain/emailTemplates';

/**
 * Status email templates of the versions with separate order kinds: six for catalog orders
 * (`order.<status>`) and seven for print requests (`customOrder.<status>`). Kept to upgrade stored
 * templates: the defaults tell which ones the admin edited.
 */
type LegacyTemplateKey =
  | `order.${'pending' | 'paid' | 'printing' | 'shipped' | 'delivered' | 'cancelled'}`
  | `customOrder.${'submitted' | 'approved' | 'rejected' | 'printing' | 'shipped' | 'delivered' | 'cancelled'}`;

const SIGN_OFF = { en: '\n\nBest regards,\n{{shopName}}', pl: '\n\nPozdrawiamy,\n{{shopName}}' };

const EN: Record<LegacyTemplateKey, EmailTemplate> = {
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

const PL: Record<LegacyTemplateKey, EmailTemplate> = {
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

const legacyDefaults = (lang: 'en' | 'pl') => {
  const texts = lang === 'pl' ? PL : EN;
  return Object.fromEntries(Object.entries(texts).map(([key, template]) => [key, { ...template, body: template.body + SIGN_OFF[lang] }])) as
    Record<LegacyTemplateKey, EmailTemplate>;
};

/** Where each status's template comes from when upgrading; statuses not listed start from the new default. */
const LEGACY_SOURCE: Partial<Record<OrderStatus, LegacyTemplateKey>> = {
  received: 'order.pending',
  quoted: 'customOrder.approved',
  paid: 'order.paid',
  printing: 'order.printing',
  shipped: 'order.shipped',
  delivered: 'order.delivered',
  rejected: 'customOrder.rejected',
  cancelled: 'order.cancelled',
};

/** Variables that were renamed when the order kinds were unified. */
const RENAMED: Record<string, string> = { total: 'price', quotedPrice: 'price', files: 'items' };

const renameVariables = (text: string) =>
  text.replace(/\{\{\s*([A-Za-z]+)\s*\}\}/g, (match, name: string) => (RENAMED[name] ? `{{${RENAMED[name]}}}` : match));

const same = (a: EmailTemplate, b: EmailTemplate) => a.subject === b.subject && a.body === b.body;

/**
 * Templates stored by the versions with separate order kinds, converted to one template per status:
 * a template the admin edited is kept (its variables renamed) when it still satisfies the status's
 * rules; unedited ones, statuses that are new and edited ones that no longer fit get the new default.
 * Returns null when the document is already current.
 */
export function upgradeEmailTemplates(stored: { templates: Record<string, EmailTemplate | undefined>; updatedAt: string }): EmailTemplates | null {
  const keys = Object.keys(stored.templates);
  if (!keys.some((key) => key.includes('.'))) return null;
  const defaults = defaultTemplates();
  const originals = [legacyDefaults('en'), legacyDefaults('pl')];
  const templates = { ...defaults };
  for (const [status, source] of Object.entries(LEGACY_SOURCE) as [OrderStatus, LegacyTemplateKey][]) {
    const old = stored.templates[source];
    if (!old || originals.some((original) => same(original[source], old))) continue;
    const candidate = { subject: renameVariables(old.subject), body: renameVariables(old.body) };
    const problems = validateEmailTemplates({ ...defaults, [status]: candidate });
    if (problems.length === 0) templates[status] = candidate;
  }
  return { templates, updatedAt: stored.updatedAt };
}
