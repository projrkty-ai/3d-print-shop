// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client';
import { createSeedProducts } from '../data/seedProducts';
import type { Product } from '../types';
import { defaultCustomization } from '../utils/customization';
import { CartProvider, useCart } from './CartContext';
import { ProductsProvider, useProducts } from './ProductsContext';

let root: Root;
let container: HTMLDivElement;
let product: Product;

function CartProbe() {
  const { items, total, handlingFee, clear } = useCart();
  const { load } = useProducts();
  return <div>
    <output>{JSON.stringify({ prices: items.map((item) => item.unitPrice), total, handlingFee, load })}</output>
    <button onClick={clear}>Clear</button>
  </div>;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  product = { ...createSeedProducts().find((product) => product.id === 'spiral-vase')!, catalogPricing: {
    ratesPerCm3: { PLA: 0.2145, PETG: 0, ABS: 0, ASA: 0, TPU: 0, resin: 0 }, handlingFee: 7, updatedAt: null,
  } };
  const item = {
    id: 'first', productId: product.id, productName: product.name, customization: defaultCustomization(product),
    unitPrice: 999, quantity: 2, sizeLabel: '', colorName: '', colorHex: '', addedAt: '',
  };
  localStorage.setItem('printforge.cart', JSON.stringify([item, { ...item, id: 'second', quantity: 1 }]));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function render() {
  await act(async () => root.render(<ProductsProvider><CartProvider><CartProbe /></CartProvider></ProductsProvider>));
}
const result = () => JSON.parse(container.querySelector('output')!.textContent!);

describe('dynamic catalog cart', () => {
  it('reprices existing cart entries from current rates and adds handling once across quantities and lines', async () => {
    vi.spyOn(api, 'listProducts').mockImplementation(async () => [product]);
    await render();
    expect(result()).toMatchObject({ prices: [20.38, 20.38], total: 68.14, handlingFee: 7 });
    expect(JSON.parse(localStorage.getItem('printforge.cart')!)[0].unitPrice).toBe(999);
    product = { ...product, catalogPricing: { ...product.catalogPricing!, ratesPerCm3: { ...product.catalogPricing!.ratesPerCm3, PLA: 0.4095 }, handlingFee: 9 } };
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(result()).toMatchObject({ prices: [38.9, 38.9], total: 125.7, handlingFee: 9 });
    await act(async () => container.querySelector('button')!.click());
    expect(result()).toMatchObject({ prices: [], total: 0, handlingFee: 0 });
  });

  it('refreshes visible storefront rates every 15 seconds and surfaces refresh errors', async () => {
    vi.useFakeTimers();
    const list = vi.spyOn(api, 'listProducts').mockImplementation(async () => [product]);
    await render();
    product = { ...product, catalogPricing: { ...product.catalogPricing!, handlingFee: 10 } };
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(list).toHaveBeenCalledTimes(2);
    expect(result().total).toBe(71.14);
    list.mockRejectedValue(new ApiError(500, 'Rates unavailable'));
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(result().load).toEqual({ status: 'error', message: 'Rates unavailable' });
  });
});
