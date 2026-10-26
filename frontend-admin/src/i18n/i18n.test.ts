import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTranslator, en, formatCount, parseLanguage } from './index';
import { pl } from './pl';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('standalone administrator translations', () => {
  it('defaults only an unset language to English and rejects invalid configuration explicitly', () => {
    expect(parseLanguage(undefined)).toBe('en');
    expect(parseLanguage('en')).toBe('en');
    expect(parseLanguage('pl')).toBe('pl');
    for (const value of ['', 'PL', 'de', ' pl ']) {
      expect(() => parseLanguage(value)).toThrow('Unsupported VITE_APP_LANGUAGE');
    }
  });

  it('keeps the existing suite in English independently of the deployment .env', async () => {
    expect((await import('./index')).language).toBe('en');
  });

  it('has complete nonempty dictionaries with matching interpolation parameters', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(pl).sort());
    for (const [message, translation] of Object.entries(pl)) {
      expect(translation.trim(), message).not.toBe('');
      const parameters = (text: string) => [...text.matchAll(/\{(\d+)\}/g)].map((match) => match[1]).sort();
      expect(parameters(translation), message).toEqual(parameters(message));
    }
  });

  it('interpolates original content verbatim without treating it as a dictionary key or replacement pattern', () => {
    const english = createTranslator('en');
    const polish = createTranslator('pl');
    expect(english('Saved “{0}”.', 'Products $& {0}')).toBe('Saved “Products $& {0}”.');
    expect(polish('Saved “{0}”.', 'Products $& {0}')).toBe('Zapisano „Products $& {0}”.');
    expect(polish('Name is required.')).toBe('Nazwa jest wymagana.');
    expect(english('Name is required.')).toBe('Name is required.');
  });

  it('handles Polish one/few/many counts, including teens, without English suffixes', () => {
    expect(formatCount('product', 1, 'en')).toBe('1 product');
    expect(formatCount('product', 2, 'en')).toBe('2 products');
    expect(formatCount('product', 1, 'pl')).toBe('1 produkt');
    expect(formatCount('product', 2, 'pl')).toBe('2 produkty');
    expect(formatCount('product', 5, 'pl')).toBe('5 produktów');
    expect(formatCount('product', 12, 'pl')).toBe('12 produktów');
    expect(formatCount('order', 22, 'pl')).toBe('22 zamówienia');
    expect(formatCount('object', 0, 'pl')).toBe('0 obiektów');
  });

  it.each(['en', 'pl'] as const)('formats quantities, dates and USD prices using %s without changing currency', async (selected) => {
    vi.stubEnv('VITE_APP_LANGUAGE', selected);
    vi.resetModules();
    const { locale } = await import('./index');
    const { CURRENCY } = await import('../config');
    const { formatPrice } = await import('../utils/pricing');
    const { formatDimensions } = await import('../utils/sizing');
    const { formatDateTime } = await import('../pages/admin/orderDisplay');
    const expectedLocale = selected === 'pl' ? 'pl-PL' : 'en-US';
    expect(locale).toBe(expectedLocale);
    expect(CURRENCY).toBe('USD');
    expect(formatPrice(1234.5)).toBe(new Intl.NumberFormat(expectedLocale, { style: 'currency', currency: 'USD' }).format(1234.5));
    expect(formatDimensions({ widthMm: 12.5, depthMm: 10, heightMm: 20 })).toBe(selected === 'pl' ? '12,5 × 10 × 20 mm' : '12.5 × 10 × 20 mm');
    const iso = '2026-10-26T12:30:00Z';
    expect(formatDateTime(iso)).toBe(new Intl.DateTimeFormat(expectedLocale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)));
  });

  it('localizes validation while preserving model/layout identifiers', async () => {
    vi.stubEnv('VITE_APP_LANGUAGE', 'pl');
    vi.resetModules();
    const { createSeedProducts } = await import('../data/seedProducts');
    const { validateProduct, validateEngraving } = await import('../utils/validation');
    const { decorationLayoutErrors } = await import('../utils/decorationLayout');
    const product = createSeedProducts()[0];
    product.name = '';
    product.basePrice = -1;
    expect(validateProduct(product)).toContain('Nazwa jest wymagana.');
    expect(validateProduct(product)).toContain('Cena bazowa musi wynosić co najmniej 0.');
    expect(validateEngraving('a\nb', { maxLength: 20, maxLines: 1 })).toBe('Grawer musi mieścić się w jednym wierszu.');
    const layout = { texture: { centerX: 50, centerY: 50, width: 0, height: 100 } };
    expect(decorationLayoutErrors(layout)).toContain('Tekstura: szerokość musi wynosić od 1 do 100%.');
    expect(layout.texture).toEqual({ centerX: 50, centerY: 50, width: 0, height: 100 });
  });
});
