import { describe, expect, it } from 'vitest';
import pl from './pl.json';
import { createTranslator, localeFor, resolveLanguage } from './translator';

describe('customer translations', () => {
  it('selects supported environment languages and fails explicitly for invalid configuration', () => {
    expect(resolveLanguage(undefined)).toBe('en');
    expect(resolveLanguage('pl')).toBe('pl');
    expect(resolveLanguage('en')).toBe('en');
    expect(localeFor('pl')).toBe('pl-PL');
    expect(localeFor('en')).toBe('en-US');
    for (const value of ['', 'de', 'PL', 'pl-PL']) {
      expect(() => resolveLanguage(value)).toThrow('Unsupported VITE_APP_LANGUAGE');
    }
  });

  it('translates complete source messages without translating interpolated product content', () => {
    const polish = createTranslator('pl');
    const english = createTranslator('en');
    expect(polish('Add to cart')).toBe('Dodaj do koszyka');
    expect(english('Add to cart')).toBe('Add to cart');
    const name = 'Custom Vase {value0} <script>';
    expect(polish('Configure plate: {value0}', { value0: name })).toBe(`Konfiguruj płytę: ${name}`);
    expect(english('Configure plate: {value0}', { value0: name })).toBe(`Configure plate: ${name}`);
  });

  it.each([
    [0, '0 obiektów', '0 objects'],
    [1, '1 obiekt', '1 object'],
    [2, '2 obiekty', '2 objects'],
    [5, '5 obiektów', '5 objects'],
    [12, '12 obiektów', '12 objects'],
    [22, '22 obiekty', '22 objects'],
    [21, '21 obiektów', '21 objects'],
  ])('uses Polish and English plural rules for %i objects', (count, polish, english) => {
    expect(createTranslator('pl')('{count} objects', { count })).toBe(polish);
    expect(createTranslator('en')('{count} objects', { count })).toBe(english);
  });

  it('uses the correct shipping-day forms', () => {
    expect(createTranslator('pl')('{count} business days', { count: 1 })).toBe('1 dnia roboczego');
    expect(createTranslator('pl')('{count} business days', { count: 3 })).toBe('3 dni roboczych');
    expect(createTranslator('en')('{count} business days', { count: 1 })).toBe('1 business day');
  });

  it('requires a finite numeric count rather than silently returning broken plural copy', () => {
    expect(() => createTranslator('pl')('{count} objects', { count: NaN })).toThrow('finite numeric count');
    expect(() => createTranslator('pl')('{count} objects', { count: 'two' })).toThrow('finite numeric count');
  });

  it('has a nonempty Polish translation with exactly matching placeholders for every message and plural form', () => {
    const placeholders = (text: string) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();
    for (const [key, message] of Object.entries(pl)) {
      for (const translation of typeof message === 'string' ? [message] : Object.values(message)) {
        expect(translation.trim(), key).not.toBe('');
        expect(placeholders(translation), key).toEqual(placeholders(key));
      }
    }
  });
});
