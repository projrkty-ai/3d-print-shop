import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('customer language environment', () => {
  it.each([
    ['pl', 'pl-PL', 'Koszyk'],
    ['en', 'en-US', 'Cart'],
    [undefined, 'en-US', 'Cart'],
  ])('uses VITE_APP_LANGUAGE=%s for copy and formatting', async (language, locale, cart) => {
    vi.stubEnv('VITE_APP_LANGUAGE', language);
    vi.resetModules();
    const { LOCALE, t } = await import('./index');
    const { formatPrice } = await import('../utils/pricing');
    expect(LOCALE).toBe(locale);
    expect(t('Cart')).toBe(cart);
    expect(formatPrice(12.5)).toBe(new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(12.5));
  });

  it('rejects invalid environment values at startup rather than silently changing languages', async () => {
    vi.stubEnv('VITE_APP_LANGUAGE', 'de');
    vi.resetModules();
    await expect(import('./index')).rejects.toThrow('Unsupported VITE_APP_LANGUAGE');
  });
});
