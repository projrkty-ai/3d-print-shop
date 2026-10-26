// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeedProducts } from '../data/seedProducts';
import { createTranslator, localeFor } from './translator';
import type { Language } from './translator';

let language: Language = 'pl';
vi.mock('./index', () => ({
  get LANGUAGE() { return language; },
  get LOCALE() { return localeFor(language); },
  t: (...args: Parameters<ReturnType<typeof createTranslator>>) => createTranslator(language)(...args),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  language = 'pl';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('localized customer UI', () => {
  it('renders Polish carousel controls and keeps actual product text unchanged', async () => {
    const { ProductDescription } = await import('../components/ProductDescription');
    const product = {
      ...createSeedProducts()[0],
      imageUrl: '',
      name: 'English product name',
      description: 'Original English description.',
      gallery: [
        { type: 'image' as const, url: '/one.png', alt: 'Original image label' },
        { type: 'image' as const, url: '/two.png', alt: 'Second original label' },
      ],
    };
    await act(async () => root.render(<ProductDescription product={product} />));
    expect(container.querySelector('[aria-label="Zdjęcia i filmy produktu"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Poprzednie zdjęcie lub film"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Następne zdjęcie lub film"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="1 z 2"]')).not.toBeNull();
    expect(container.querySelector('img')?.alt).toBe('Original image label');
    expect(container.querySelector('.rich-description')?.textContent).toBe('Original English description.');
  });

  it('renders Polish checkout labels and has an independent English rendering', async () => {
    const { CheckoutForm } = await import('../pages/CheckoutForm');
    await act(async () => root.render(<MemoryRouter><CheckoutForm items={[]} onPlaced={vi.fn()} onCancel={vi.fn()} /></MemoryRouter>));
    expect(container.querySelector('h2')?.textContent).toBe('Zamówienie');
    expect(container.querySelector('button[type="submit"]')?.textContent).toBe('Złóż zamówienie');
    expect(container.textContent).toContain('Imię i nazwisko');
    expect(container.textContent).toContain('Kod pocztowy');
    expect(container.textContent).not.toContain('Full name');
    language = 'en';
    await act(async () => root.render(<MemoryRouter><CheckoutForm items={[]} onPlaced={vi.fn()} onCancel={vi.fn()} /></MemoryRouter>));
    expect(container.querySelector('h2')?.textContent).toBe('Checkout');
    expect(container.querySelector('button[type="submit"]')?.textContent).toBe('Place order');
  });

  it('localizes configurator labels and accessible names without changing input behavior', async () => {
    const { DimensionsInput } = await import('../components/customization/DimensionsInput');
    await act(async () => root.render(
      <DimensionsInput model={createSeedProducts()[0].model} value={createSeedProducts()[0].model}
        error={null} onChange={vi.fn()} priceLabel={() => '10 USD'} />,
    ));
    expect(container.querySelector('[aria-label="Gotowe rozmiary"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Rozmiar jako procent oryginału"]')).not.toBeNull();
    expect(container.textContent).toContain('Szerokość');
    expect(container.textContent).toContain('Głębokość');
    expect(container.querySelectorAll('input[type="number"]')).toHaveLength(3);
  });
});
