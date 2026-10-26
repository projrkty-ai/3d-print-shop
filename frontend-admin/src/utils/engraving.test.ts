import { describe, expect, it } from 'vitest';
import { engravingCharCount, engravingLines, normalizeEngravingText } from './engraving';

describe('engravingLines', () => {
  it('trims trailing spaces and blank edge lines but keeps inner blank lines', () => {
    expect(engravingLines('\n  \nHappy  \n\nBirthday\n \n')).toEqual(['Happy', '', 'Birthday']);
  });

  it('keeps leading indentation and handles Windows line breaks', () => {
    expect(engravingLines('  To Anna\r\nLove, Mom')).toEqual(['  To Anna', 'Love, Mom']);
  });

  it('returns no lines for whitespace-only text', () => {
    expect(engravingLines(' \n \n')).toEqual([]);
  });
});

describe('normalizeEngravingText / engravingCharCount', () => {
  it('joins the cleaned lines and counts characters without line breaks', () => {
    expect(normalizeEngravingText('Happy \r\nBirthday\n')).toBe('Happy\nBirthday');
    expect(engravingCharCount('ab\ncd\r\nef')).toBe(6);
  });
});
