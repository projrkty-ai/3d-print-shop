import { describe, expect, it } from 'vitest';
import { upgradeEmailTemplates } from '../storage/legacyEmailTemplates';
import {
  defaultTemplates, missingValues, renderTemplate, TEMPLATE_DEFINITIONS, TEMPLATE_KEYS, templateValues, usedVariables,
  validateEmailTemplates, type TemplateVariable,
} from './emailTemplates';
import type { Order } from './types';

const customer = { name: 'Anna Nowak', email: 'anna@example.com', address: { line1: 'Długa 1', city: 'Kraków', postalCode: '30-001', country: 'PL' } };
const base = { customer, customerNote: '', currency: 'USD', adminNote: '', createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z' };
const order: Order = {
  ...base, id: 'o1', number: 'PF-261101-ABCD', status: 'received', source: 'catalog',
  items: [{ model: { source: 'catalog', productId: 'vase', productName: 'Spiral Vase' } as Extract<Order['items'][number]['model'], { source: 'catalog' }>, quantity: 2, lineTotal: 78, unitPrice: 39 }],
  price: { mode: 'fixed', handlingFee: 0, estimated: null, reviewed: null, total: 78 },
};
const uploads: Order = {
  ...base, id: 'c1', number: 'CP-261101-WXYZ', status: 'received', source: 'upload',
  items: [{
    model: {
      source: 'upload', fileId: 'f', fileName: 'vase.stl', format: 'stl', sizeBytes: 1,
      nozzle: { id: 'n', diameterMm: 0.4, priceMultiplier: 1 }, layerHeight: { id: 'l', heightMm: 0.2, priceMultiplier: 1 },
      parts: [{ key: 'model', name: 'Model', filament: { id: 'pla', name: 'PLA', pricePerKg: 80, densityGPerCm3: 1.24 }, color: { id: 'black', name: 'Black', hex: '#000000' } }],
    },
    quantity: 3, unitPrice: null, lineTotal: null,
  }],
  price: { mode: 'quote', handlingFee: 5, estimated: null, reviewed: null, total: null },
};
const project: Order = {
  ...uploads, id: 'p1', number: 'PJ-261101-QRST', source: 'project',
  project: { source: 'printables', id: '1', title: 'Planter', description: '', thumbnailUrl: null, url: 'https://www.printables.com/model/1', author: null, license: null, verified: true, sameSettingsForAll: true },
  items: [
    { model: { source: 'project', file: { id: '9', name: 'planter.stl', sizeBytes: null, thumbnailUrl: null }, scalePercent: 120, filaments: [{ material: 'PETG', color: 'red' }, { material: 'any', color: '' }] }, quantity: 2, unitPrice: null, lineTotal: null },
    { model: { source: 'project', file: null, scalePercent: 100, filaments: [{ material: 'any', color: 'blue' }] }, quantity: 1, unitPrice: null, lineTotal: null },
  ],
};

describe('status email templates', () => {
  it('has one template per status for every order, and the defaults satisfy their own rules in both languages', () => {
    expect(TEMPLATE_KEYS).toEqual(['received', 'quoted', 'accepted', 'paid', 'queued', 'printing', 'done', 'shipped', 'delivered', 'rejected', 'cancelled']);
    expect(validateEmailTemplates(defaultTemplates('en'))).toEqual([]);
    expect(validateEmailTemplates(defaultTemplates('pl'))).toEqual([]);
    // Every email names the order; the first lists it; a quote states the price; cancelling and rejecting explain why.
    expect(TEMPLATE_DEFINITIONS.received.required).toEqual(['orderNumber', 'items']);
    expect(TEMPLATE_DEFINITIONS.quoted.required).toEqual(['orderNumber', 'price']);
    expect(TEMPLATE_DEFINITIONS.rejected.required).toEqual(['orderNumber', 'note']);
    expect(TEMPLATE_DEFINITIONS.cancelled.required).toEqual(['orderNumber', 'note']);
    expect(TEMPLATE_KEYS.every((key) => TEMPLATE_DEFINITIONS[key].required.includes('orderNumber'))).toBe(true);
  });

  it('rejects templates without their required variables, with unknown variables or a broken subject', () => {
    const templates = defaultTemplates('en');
    templates.quoted = { subject: 'Quote {{orderNumber}}', body: 'Hello {{customerName}}, see {{total}}.' };
    templates.shipped = { subject: 'Shipped\nnow', body: ' ' };
    delete (templates as Partial<typeof templates>).paid;
    expect(validateEmailTemplates(templates)).toEqual([
      'Quoted: unknown variable {{total}}. Available: customerName, orderNumber, status, orderDate, shopName, note, price, items, printStart, printDuration, printEnd.',
      'Quoted: the template must include {{price}}.',
      'Paid: the template is missing.',
      'Shipped: the subject must be a single line.',
      'Shipped: enter the message.',
      'Shipped: the template must include {{orderNumber}}.',
    ]);
    expect(usedVariables('{{ orderNumber }} and {{note}}')).toEqual(['orderNumber', 'note']);
  });

  it('fills in the order, leaving no blank gaps for an empty optional note', () => {
    const email = renderTemplate(defaultTemplates('en').received, templateValues(order, { status: 'received' }));
    expect(email.subject).toBe('We received your order PF-261101-ABCD');
    expect(email.body).toBe(
      'Hello Anna Nowak,\n\nthank you for your order PF-261101-ABCD of November 1, 2026:\n\n• 2 × Spiral Vase — $78.00\n\nPrice: $78.00\n\n'
      + 'We will contact you to confirm it and arrange payment.\n\nBest regards,\nPrintForge',
    );
    const shipped = renderTemplate(defaultTemplates('en').shipped, templateValues(order, { status: 'shipped', note: 'Tracking number: 123.' }));
    expect(shipped.body).toContain('is on its way.\n\nTracking number: 123.\n\nBest regards');
  });

  it('lists what is printed by source and reports required values that are missing', () => {
    const values = templateValues(uploads, { status: 'quoted' });
    expect(values.items).toBe('• vase.stl × 3 (nozzle 0.4 mm, layers 0.20 mm, PLA Black)');
    expect(templateValues(project, { status: 'received' }).items).toBe('• planter.stl × 2 (120%, PETG red)\n• Planter × 1 (100%, blue)');
    // Without a price the quote can't be sent; the first email says it will be quoted.
    expect(missingValues('quoted', values)).toEqual(['price']);
    expect(renderTemplate(defaultTemplates('en').received, templateValues(uploads, { status: 'received' })).body)
      .toContain('Price: to be quoted after we review your order');
    // The unsaved price from the admin's form counts.
    const quoted = templateValues(uploads, { status: 'quoted', price: 24.5 });
    expect(missingValues('quoted', quoted)).toEqual([]);
    expect(renderTemplate(defaultTemplates('en').quoted, quoted).body).toContain('Price: $24.50');
    const rejected: Record<TemplateVariable, string> = templateValues(uploads, { status: 'rejected', note: '  ' });
    expect(missingValues('rejected', rejected)).toEqual(['note']);
    expect(values.status).toBe('Quoted');
  });
});

describe('upgrading templates of separate order kinds', () => {
  const legacyDefaults = {
    'order.pending': {
      subject: 'We received your order {{orderNumber}}',
      body: 'Hello {{customerName}},\n\nthank you for your order {{orderNumber}} of {{orderDate}}:\n\n{{items}}\n\nTotal: {{total}}\n\nWe will contact you to confirm it and arrange payment.\n\n{{note}}\n\nBest regards,\n{{shopName}}',
    },
    'order.paid': {
      subject: 'Payment received for order {{orderNumber}}',
      body: 'Hello {{customerName}},\n\nwe received your payment for order {{orderNumber}}. We will start printing soon.\n\n{{note}}\n\nBest regards,\n{{shopName}}',
    },
  };

  it('keeps edited templates of the matching status, with renamed variables, and uses the new defaults for the rest', () => {
    const upgraded = upgradeEmailTemplates({
      templates: {
        ...legacyDefaults,
        'customOrder.approved': { subject: 'Your quote {{orderNumber}}', body: 'We can print:\n{{files}}\nFor {{quotedPrice}}.' },
        'order.shipped': { subject: 'On its way!', body: 'Order {{orderNumber}} left us. {{note}}' },
        // Edited without the reason ({{note}}) a rejection must give: replaced by the default.
        'customOrder.rejected': { subject: 'Sorry', body: 'Order {{orderNumber}} can\'t be printed.' },
      },
      updatedAt: '2026-11-01T00:00:00.000Z',
    })!;
    const defaults = defaultTemplates('en');
    expect(upgraded.updatedAt).toBe('2026-11-01T00:00:00.000Z');
    expect(upgraded.templates.quoted).toEqual({ subject: 'Your quote {{orderNumber}}', body: 'We can print:\n{{items}}\nFor {{price}}.' });
    expect(upgraded.templates.shipped).toEqual({ subject: 'On its way!', body: 'Order {{orderNumber}} left us. {{note}}' });
    // Unedited templates take the new wording; new statuses get their default.
    expect(upgraded.templates.received).toEqual(defaults.received);
    expect(upgraded.templates.paid).toEqual(defaults.paid);
    expect(upgraded.templates.accepted).toEqual(defaults.accepted);
    expect(upgraded.templates.rejected).toEqual(defaults.rejected);
    expect(validateEmailTemplates(upgraded.templates)).toEqual([]);
    expect(upgradeEmailTemplates({ templates: defaults, updatedAt: 'x' })).toBeNull();
  });
});
