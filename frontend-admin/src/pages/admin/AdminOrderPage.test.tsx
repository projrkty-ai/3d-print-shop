// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { ProductPreview } from '../../components/ProductPreview';
import { createSeedProducts } from '../../data/seedProducts';
import type { Order, OrderItem, Product, SurfaceCustomization } from '../../types';
import { AdminOrderPage } from './AdminOrderPage';

// A stable sign-out, as the real context provides; useAdminData reloads when it changes.
const auth = vi.hoisted(() => ({ signOut: () => undefined }));
vi.mock('../../store/AdminAuthContext', () => ({ useAdminAuth: () => auth }));
const catalog = vi.hoisted(() => ({ products: [] as Product[] }));
vi.mock('../../store/ProductsContext', () => ({
  useProducts: () => ({ getProduct: (id: string) => catalog.products.find((product) => product.id === id) }),
}));
vi.mock('../../components/LazyProductPreview', () => ({
  LazyProductPreview: (props: ComponentProps<typeof ProductPreview>) => (
    <div
      data-preview={props.meshPlate ?? 'root'}
      data-texture={props.textureUrl ?? undefined}
      data-lettering={props.extrudedText ? `${props.extrudedText.text}/${props.extrudedText.sizeMm}` : undefined}
      data-text={props.engravingText}
      data-font={props.engravingFont}
      data-text-color={props.engravingColor ?? undefined}
      data-parts={JSON.stringify(props.partColors)}
      data-layout={JSON.stringify(props.decorationLayout)}
      data-caption={props.caption}
    />
  ),
}));

const PICTURE = 'data:image/png;base64,AA==';
const marble = { id: 'marble', name: 'Marble', url: '/api/media-files/marble' };

const surface = (patch: Partial<SurfaceCustomization> = {}): SurfaceCustomization => ({
  colorId: 'white', partColors: {}, engravingText: '', engravingFont: 'Arial', engravingColorId: null, textureDataUrl: null, ...patch,
});
const appearance = { colorName: 'Arctic White', colorHex: '#f4f4f2' };
const baseItem = {
  productId: 'vase', productName: 'Vase', sizeLabel: '100 × 100 × 100 mm', ...appearance,
  unitPrice: 39, quantity: 1, lineTotal: 39, priceLines: [{ label: 'Picture texture', amount: 7, note: 'Marble, Custom picture' }],
};

/** A two-plate set (shop texture + customer picture) and an order line saved before the texture library. */
function order(): Order {
  const set: OrderItem = {
    ...baseItem,
    texture: { source: 'library', ...marble },
    customization: {
      ...surface(), dimensions: { widthMm: 100, depthMm: 100, heightMm: 100 },
      plates: { 1: surface({ textureId: 'marble' }), 2: surface({ textureDataUrl: PICTURE }) },
    },
    plates: [
      { id: 1, name: 'Base', objectCount: 1, appearance: { ...appearance, texture: { source: 'library', ...marble } } },
      { id: 2, name: 'Lid', objectCount: 1, appearance: { ...appearance, texture: { source: 'custom' } } },
    ],
  };
  const legacy: OrderItem = {
    ...baseItem, productId: 'deleted-lamp', productName: 'Lamp',
    customization: { ...surface({ textureDataUrl: 'data:image/jpeg;base64,AQ==' }), dimensions: { widthMm: 100, depthMm: 100, heightMm: 100 } },
  };
  return {
    id: 'order-1', number: 'PF-261101-ABCD', status: 'pending', items: [set, legacy], total: 78, currency: 'USD', adminNote: '',
    customer: { name: 'Anna', email: 'anna@example.com', address: { line1: 'Długa 1', city: 'Kraków', postalCode: '30-001', country: 'PL' } },
    createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z',
  };
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const vase = createSeedProducts()[0];
  catalog.products = [{
    ...vase, id: 'vase',
    model: { widthMm: 100, depthMm: 100, heightMm: 100, volumeCm3: 12 },
    mesh: {
      ...vase.mesh!, plate: 1, selectedPlates: [1, 2],
      plates: [
        { id: 1, name: 'Base', objectCount: 1, model: { widthMm: 100, depthMm: 100, heightMm: 100, volumeCm3: 10 } },
        { id: 2, name: 'Lid', objectCount: 1, model: { widthMm: 100, depthMm: 100, heightMm: 20, volumeCm3: 2 } },
      ],
    },
  }];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('admin order textures', () => {
  it('shows every surface texture with its source, a fulfilment link and the ordered configuration', async () => {
    vi.spyOn(api, 'getOrder').mockResolvedValue(order());
    await act(async () => root.render(
      <MemoryRouter initialEntries={['/admin/orders/order-1']}>
        <Routes><Route path="/admin/orders/:orderId" element={<AdminOrderPage />} /></Routes>
      </MemoryRouter>,
    ));
    const figures = Array.from(container.querySelectorAll('.order-item__texture'));
    expect(figures.map((figure) => figure.querySelector('figcaption')?.textContent)).toEqual([
      'Base: Shop texture: Marble · Open original',
      "Lid: Customer's texture picture · Download",
      "Customer's texture picture · Download",
    ]);
    expect(figures.map((figure) => figure.querySelector('img')?.getAttribute('src'))).toEqual([marble.url, PICTURE, 'data:image/jpeg;base64,AQ==']);
    expect(figures[0].querySelector('img')?.getAttribute('alt')).toBe('Shop texture Marble for Vase, Base');
    expect(figures[0].querySelector('a')?.getAttribute('href')).toBe(marble.url);
    expect(figures[1].querySelector('a')?.getAttribute('download')).toBe('PF-261101-ABCD-1-plate-2-texture.png');
    expect(figures[2].querySelector('a')?.getAttribute('download')).toBe('PF-261101-ABCD-2-texture.jpg');

    const base = container.querySelector('[aria-label="Plate configuration: Base"]');
    expect(base?.textContent).toContain('Shop texture: Marble');
    expect(container.querySelector('[aria-label="Plate configuration: Lid"]')?.textContent).toContain('Custom picture');
    expect(container.querySelector('.cart-item__swatch img')?.getAttribute('src')).toBe(marble.url);
  });

  it('opens the ordered print in 3D with every plate decorated as ordered, next to all parameters', async () => {
    const ordered = order();
    const set = ordered.items[0];
    set.customization.plates![2] = { ...set.customization.plates![2], engravingText: 'For Anna', engravingFont: 'Georgia', engravingColorId: 'gold' };
    set.plates![1].appearance = {
      ...set.plates![1].appearance!,
      engravingColor: { name: 'Silk Gold', hex: '#c9a227' },
      decorationLayout: {
        texture: { centerX: 30, centerY: 40, width: 20, height: 30 },
        extrudedText: {
          x: 0, y: -50, z: 10, rotationDeg: 0, tiltDeg: 0, sizeMm: 8, depthMm: 1, lineSpacing: 1.2,
          horizontalAlign: 'center', verticalAlign: 'middle', defaultText: 'With love',
        },
      },
    };
    set.customization.plates![2].extrudedText = 'Ani';
    set.customization.plates![2].extrudedSizeMm = 12;
    vi.spyOn(api, 'getOrder').mockResolvedValue(ordered);
    await act(async () => root.render(
      <MemoryRouter initialEntries={['/admin/orders/order-1']}>
        <Routes><Route path="/admin/orders/:orderId" element={<AdminOrderPage />} /></Routes>
      </MemoryRouter>,
    ));
    const open = container.querySelectorAll<HTMLButtonElement>('button[aria-label="Show the configured print in 3D"]');
    expect(open).toHaveLength(2);
    await act(async () => open[0].click());
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.querySelector('h2')?.textContent).toBe('Vase');
    expect(dialog.textContent).toContain('Order PF-261101-ABCD, item 1');
    const base = dialog.querySelector('[data-preview="1"]')!;
    const lid = dialog.querySelector('[data-preview="2"]')!;
    expect(base.getAttribute('data-texture')).toBe(marble.url);
    expect(base.getAttribute('data-text')).toBe('');
    expect(base.getAttribute('data-caption')).toBe('100 × 100 × 100 mm');
    expect(lid.getAttribute('data-texture')).toBe(PICTURE);
    expect(lid.getAttribute('data-text')).toBe('For Anna');
    expect(lid.getAttribute('data-font')).toBe('Georgia');
    expect(lid.getAttribute('data-text-color')).toBe('#c9a227');
    expect(JSON.parse(lid.getAttribute('data-layout')!)).toMatchObject({ texture: { centerX: 30, centerY: 40, width: 20, height: 30 } });
    expect(lid.getAttribute('data-caption')).toBe('100 × 100 × 20 mm');
    // The ordered 3D lettering is drawn and listed with the other parameters.
    expect(base.hasAttribute('data-lettering')).toBe(false);
    expect(lid.getAttribute('data-lettering')).toBe('Ani/12');
    expect(dialog.textContent).toContain('“Ani” · 12 mm');
    // Every order parameter for the item sits next to the models.
    for (const text of ['Order parameters', 'Quantity', 'Unit price', '$39.00', 'Line total', 'Marble, Custom picture', 'Shop texture: Marble', 'For Anna']) {
      expect(dialog.textContent).toContain(text);
    }
    expect(dialog.querySelector('a[download="PF-261101-ABCD-1-plate-2-texture.png"]')).not.toBeNull();
    expect(document.activeElement?.textContent).toBe('Close');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => open[1].click());
    const missing = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(missing.textContent).toContain("This product no longer exists, so its 3D model can't be shown.");
    expect(missing.querySelector('[data-preview]')).toBeNull();
    expect(missing.textContent).toContain("Customer's texture picture");
    await act(async () => missing.querySelector<HTMLButtonElement>('.viewer__header button')!.click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
