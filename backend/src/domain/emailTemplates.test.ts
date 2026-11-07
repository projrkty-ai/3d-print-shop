import { describe, expect, it } from 'vitest';
import {
  defaultTemplates, missingValues, renderTemplate, TEMPLATE_DEFINITIONS, TEMPLATE_KEYS, templateValues, usedVariables,
  validateEmailTemplates, type TemplateVariable,
} from './emailTemplates';
import type { CustomOrder, Order } from './types';

const customer = { name: 'Anna Nowak', email: 'anna@example.com', address: { line1: 'Długa 1', city: 'Kraków', postalCode: '30-001', country: 'PL' } };
const order: Order = {
  id: 'o1', number: 'PF-261101-ABCD', status: 'pending', customer, total: 78, currency: 'USD', adminNote: '',
  items: [{ productId: 'vase', productName: 'Spiral Vase', quantity: 2, lineTotal: 78, unitPrice: 39 } as Order['items'][number]],
  createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z',
};
const request: CustomOrder = {
  id: 'c1', number: 'CP-261101-WXYZ', status: 'submitted', customer, quotedPrice: null, currency: 'USD', adminNote: '',
  files: [{
    fileId: 'f', fileName: 'vase.stl', format: 'stl', sizeBytes: 1, quantity: 3,
    nozzle: { id: 'n', diameterMm: 0.4, priceMultiplier: 1 }, layerHeight: { id: 'l', heightMm: 0.2, priceMultiplier: 1 },
    parts: [{ key: 'model', name: 'Model', filament: { id: 'pla', name: 'PLA', pricePerKg: 80, densityGPerCm3: 1.24 }, color: { id: 'black', name: 'Black', hex: '#000000' } }],
  }],
  createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z',
};

describe('status email templates', () => {
  it('has a template for every status of both order kinds, and the defaults satisfy their own rules in both languages', () => {
    expect(TEMPLATE_KEYS).toEqual([
      'order.pending', 'order.paid', 'order.printing', 'order.shipped', 'order.delivered', 'order.cancelled',
      'customOrder.submitted', 'customOrder.approved', 'customOrder.rejected', 'customOrder.printing', 'customOrder.shipped',
      'customOrder.delivered', 'customOrder.cancelled',
    ]);
    expect(validateEmailTemplates(defaultTemplates('en'))).toEqual([]);
    expect(validateEmailTemplates(defaultTemplates('pl'))).toEqual([]);
    // Every email names the order; approvals state the price; cancelling and rejecting explain why.
    expect(TEMPLATE_DEFINITIONS['customOrder.approved'].required).toEqual(['orderNumber', 'quotedPrice']);
    expect(TEMPLATE_DEFINITIONS['customOrder.rejected'].required).toEqual(['orderNumber', 'note']);
    expect(TEMPLATE_DEFINITIONS['order.cancelled'].required).toEqual(['orderNumber', 'note']);
    expect(TEMPLATE_KEYS.every((key) => TEMPLATE_DEFINITIONS[key].required.includes('orderNumber'))).toBe(true);
  });

  it('rejects templates without their required variables, with unknown variables or a broken subject', () => {
    const templates = defaultTemplates('en');
    templates['customOrder.approved'] = { subject: 'Approved {{orderNumber}}', body: 'Hello {{customerName}}, see {{total}}.' };
    templates['order.shipped'] = { subject: 'Shipped\nnow', body: ' ' };
    delete (templates as Partial<typeof templates>)['order.paid'];
    expect(validateEmailTemplates(templates)).toEqual([
      'Order — Paid: the template is missing.',
      'Order — Shipped: the subject must be a single line.',
      'Order — Shipped: enter the message.',
      'Order — Shipped: the template must include {{orderNumber}}.',
      'Print request — Approved: unknown variable {{total}}. Available: customerName, orderNumber, status, orderDate, shopName, note, quotedPrice, files.',
      'Print request — Approved: the template must include {{quotedPrice}}.',
    ]);
    expect(usedVariables('{{ orderNumber }} and {{note}}')).toEqual(['orderNumber', 'note']);
  });

  it('fills in the order, leaving no blank gaps for an empty optional note', () => {
    const values = templateValues({ kind: 'order', order }, { status: 'pending' });
    const email = renderTemplate(defaultTemplates('en')['order.pending'], values);
    expect(email.subject).toBe('We received your order PF-261101-ABCD');
    expect(email.body).toBe(
      'Hello Anna Nowak,\n\nthank you for your order PF-261101-ABCD of November 1, 2026:\n\n• 2 × Spiral Vase — $78.00\n\nTotal: $78.00\n\n'
      + 'We will contact you to confirm it and arrange payment.\n\nBest regards,\nPrintForge',
    );
    const shipped = renderTemplate(defaultTemplates('en')['order.shipped'],
      templateValues({ kind: 'order', order }, { status: 'shipped', note: 'Tracking number: 123.' }));
    expect(shipped.body).toContain('is on its way.\n\nTracking number: 123.\n\nBest regards');
  });

  it('lists the files with their print options and reports required values that are missing', () => {
    const values = templateValues({ kind: 'customOrder', order: request }, { status: 'approved' });
    expect(values.files).toBe('• vase.stl × 3 (nozzle 0.4 mm, layers 0.20 mm, PLA Black)');
    expect(missingValues('customOrder.approved', values)).toEqual(['quotedPrice']);
    // The unsaved quote from the admin's form counts.
    const quoted = templateValues({ kind: 'customOrder', order: request }, { status: 'approved', quotedPrice: 24.5 });
    expect(missingValues('customOrder.approved', quoted)).toEqual([]);
    expect(renderTemplate(defaultTemplates('en')['customOrder.approved'], quoted).body).toContain('Price: $24.50');
    const rejected: Record<TemplateVariable, string> = templateValues({ kind: 'customOrder', order: request }, { status: 'rejected', note: '  ' });
    expect(missingValues('customOrder.rejected', rejected)).toEqual(['note']);
    expect(values.status).toBe('Approved');
  });
});
