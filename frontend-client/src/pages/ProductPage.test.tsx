// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductPreview } from '../components/ProductPreview';
import { ConfigurationDetails } from '../components/ConfiguredItem';
import { createSeedProducts } from '../data/seedProducts';
import type { CartItem, Product } from '../types';
import { fileToResizedDataUrl } from '../utils/image';
import { ProductPage } from './ProductPage';

const addItem = vi.fn<(item: Omit<CartItem, 'id' | 'addedAt'>) => void>();
let product: Product;

vi.mock('../store/CartContext', () => ({ useCart: () => ({ addItem }) }));
vi.mock('../store/ProductsContext', () => ({
  useProducts: () => ({ getProduct: () => product, load: { status: 'ready' } }),
}));
vi.mock('../components/LazyProductPreview', () => ({
  LazyProductPreview: (props: ComponentProps<typeof ProductPreview>) => (
    <div
      data-preview={props.meshPlate ?? 'root'}
      data-scale={JSON.stringify(props.scale)}
      data-text={props.engravingText}
      data-font={props.engravingFont}
      data-color={props.color}
      data-text-color={props.engravingColor}
      data-parts={JSON.stringify(props.partColors)}
      data-texture={props.textureDataUrl}
      data-layout={JSON.stringify(props.decorationLayout)}
    />
  ),
}));
vi.mock('../utils/image', () => ({
  fileToResizedDataUrl: vi.fn(),
  ImageUploadError: class extends Error {},
}));

let container: HTMLDivElement;
let root: Root;

function element<T extends Element>(selector: string, scope: ParentNode = container): T {
  const found = scope.querySelector<T>(selector);
  if (!found) throw new Error(`Missing test element: ${selector}`);
  return found;
}

function enterText(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Textarea value setter is unavailable.');
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function enterNumber(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Input value setter is unavailable.');
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function leaveProduct() {
  await act(async () => root.render(<p>Another page</p>));
}

async function renderProduct() {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[`/product/${product.id}`]}>
      <Routes><Route path="/product/:productId" element={<ProductPage />} /></Routes>
    </MemoryRouter>,
  ));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  addItem.mockClear();
  vi.mocked(fileToResizedDataUrl).mockReset();
  product = createSeedProducts()[0];
  product.texture = { enabled: true, price: 7 };
  product.mesh = {
    ...product.mesh!,
    selectedPlates: [1, 2], plate: 1,
    plates: [
      { id: 1, name: 'Base', objectCount: 1, parts: [] },
      { id: 2, name: 'Lid', objectCount: 1, parts: [] },
    ],
  };
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
});

describe('per-plate product configurator', () => {
  it('places description and its carousel in the left column and every order control in the right column', async () => {
    product.descriptionFormat = 'html';
    product.description = '<h2>Product details</h2><img src="https://example.com/photo.png" alt="Photo"><p>Rich text</p>';
    await renderProduct();
    const information = element('[aria-label="Product description"]');
    const configuration = element('[aria-label="Order configuration"]');
    expect(information.compareDocumentPosition(configuration) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(information.querySelector('.media-carousel')).not.toBeNull();
    expect(information.querySelector('.rich-description h2')?.textContent).toBe('Product details');
    expect(information.querySelector('textarea,input[type="range"],.summary')).toBeNull();
    expect(configuration.querySelectorAll('.plate-configurator')).toHaveLength(2);
    expect(configuration.querySelectorAll('textarea')).toHaveLength(2);
    expect(configuration.querySelector('.quantity input')).not.toBeNull();
    expect(configuration.querySelector('.summary__actions button')).not.toBeNull();
    expect(configuration.querySelector('[aria-label="Size as a percentage of the original"]')).not.toBeNull();
  });

  it('restores scale, quantity, text, font, text color, filament and texture for each plate after leaving', async () => {
    await renderProduct();
    const base = element<HTMLElement>('[aria-label="Configure plate: Base"]');
    const lid = element<HTMLElement>('[aria-label="Configure plate: Lid"]');
    await act(async () => element<HTMLInputElement>('input[value="gold"]', base).click());
    await act(async () => element<HTMLInputElement>('input[value="red"]', lid).click());
    await act(async () => enterText(element('textarea', base), 'Saved base'));
    await act(async () => enterText(element('textarea', lid), 'Saved lid'));
    await act(async () => {
      const font = element<HTMLSelectElement>('select', base);
      font.value = 'Arial';
      font.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => element<HTMLInputElement>('.engraving__color input[value="red"]', base).click());
    vi.mocked(fileToResizedDataUrl).mockResolvedValueOnce('data:image/png;base64,AA==');
    const upload = element<HTMLInputElement>('input[type="file"]', base);
    Object.defineProperty(upload, 'files', { value: [new File(['image'], 'saved.png', { type: 'image/png' })] });
    await act(async () => upload.dispatchEvent(new Event('change', { bubbles: true })));
    await act(async () => enterNumber(element('input[type="range"]'), '50'));
    await act(async () => enterNumber(element('.quantity input'), '3'));
    const scale = element('[data-preview="1"]').getAttribute('data-scale');
    await leaveProduct();
    await renderProduct();
    expect(element('[data-preview="1"]').getAttribute('data-text')).toBe('Saved base');
    expect(element('[data-preview="2"]').getAttribute('data-text')).toBe('Saved lid');
    expect(element('[data-preview="1"]').getAttribute('data-color')).toBe('#c9a227');
    expect(element('[data-preview="2"]').getAttribute('data-color')).toBe('#d33a2c');
    expect(element('[data-preview="1"]').getAttribute('data-font')).toBe('Arial');
    expect(element('[data-preview="1"]').getAttribute('data-text-color')).toBe('#d33a2c');
    expect(element('[data-preview="1"]').getAttribute('data-texture')).toBe('data:image/png;base64,AA==');
    expect(element('[data-preview="2"]').hasAttribute('data-texture')).toBe(false);
    expect(element('[data-preview="1"]').getAttribute('data-scale')).toBe(scale);
    expect(element('[data-preview="2"]').getAttribute('data-scale')).toBe(scale);
    expect(element<HTMLInputElement>('.quantity input').value).toBe('3');
    await act(async () => element<HTMLButtonElement>('.summary__actions button').click());
    expect(addItem.mock.calls[0]?.[0]).toMatchObject({ quantity: 3, customization: { plates: { '1': { engravingText: 'Saved base' } } } });
    await leaveProduct();
    await renderProduct();
    expect(element('[data-preview="1"]').getAttribute('data-text')).toBe('Saved base');
    expect(container.textContent).not.toContain('Added to your cart.');
  });

  it('keeps independent drafts for different products, including products without plates', async () => {
    product.mesh = null;
    const firstProduct = product;
    await renderProduct();
    await act(async () => enterText(element('textarea'), 'First product'));
    await leaveProduct();
    product = { ...firstProduct, id: 'another-product' };
    await renderProduct();
    expect(element('[data-preview="root"]').getAttribute('data-text')).toBe('');
    await act(async () => enterText(element('textarea'), 'Other product'));
    await leaveProduct();
    product = firstProduct;
    await renderProduct();
    expect(element('[data-preview="root"]').getAttribute('data-text')).toBe('First product');
  });

  it('preserves cleared dimension fields and invalid text without losing the rest of the draft', async () => {
    await renderProduct();
    await act(async () => enterText(element('textarea'), '<bad>'));
    await act(async () => enterNumber(element('.dimensions input'), ''));
    await leaveProduct();
    await renderProduct();
    expect(element<HTMLInputElement>('.dimensions input').value).toBe('');
    expect(element('[data-preview="1"]').getAttribute('data-text')).toBe('<bad>');
    expect(element<HTMLButtonElement>('.summary__actions button').disabled).toBe(true);
  });

  it('repairs obsolete saved choices when the product changes and drops deselected plates', async () => {
    const part = { key: 'filament:1', name: 'Paint', fileColor: '#123456' };
    product.mesh!.parts = [part];
    product.mesh!.plates[1].parts = [part];
    await renderProduct();
    const lid = element<HTMLElement>('[aria-label="Configure plate: Lid"]');
    await act(async () => element<HTMLInputElement>('input[value="gold"]', lid).click());
    await act(async () => enterText(element('textarea', lid), 'Keep me'));
    await leaveProduct();
    product.colors = product.colors.filter((color) => color.id !== 'gold');
    product.mesh!.selectedPlates = [2, 3];
    product.mesh!.plates.push({ id: 3, name: 'New plate', objectCount: 1, parts: [] });
    await renderProduct();
    expect(container.querySelector('[data-preview="1"]')).toBeNull();
    expect(element('[data-preview="2"]').getAttribute('data-text')).toBe('Keep me');
    expect(element('[data-preview="2"]').getAttribute('data-parts')).toBe('{"filament:1":"#123456"}');
    expect(element('[data-preview="3"]').getAttribute('data-text')).toBe('');
  });

  it.each(['not JSON', '{"version":2}', '{"version":1,"quantity":1,"customization":{"plates":{"1":null}}}'])(
    'recovers safely from corrupt or unsupported browser drafts: %s', async (raw) => {
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorage.setItem(`printforge.productDraft:${product.id}`, raw);
      await renderProduct();
      expect(element('[data-preview="1"]').getAttribute('data-text')).toBe('');
      expect(element<HTMLInputElement>('.quantity input').value).toBe('1');
      expect(warning).toHaveBeenCalled();
    },
  );

  it('shows a storage warning while retaining editable state and recovers after a successful write', async () => {
    await renderProduct();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is full', 'QuotaExceededError');
    });
    await act(async () => enterText(element('textarea'), 'Still editable'));
    expect(element('[role="alert"]').textContent).toContain('could not be saved');
    expect(element('[data-preview="1"]').getAttribute('data-text')).toBe('Still editable');
    expect(warning).toHaveBeenCalled();
    write.mockRestore();
    await act(async () => enterText(element('textarea'), 'Saved after recovery'));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await leaveProduct();
    await renderProduct();
    expect(element('[data-preview="1"]').getAttribute('data-text')).toBe('Saved after recovery');
  });

  it('applies and snapshots each plate’s administrator-owned layout without exposing layout controls', async () => {
    const layouts = [
      { text: { centerX: 20, centerY: 70, horizontalAlign: 'left', verticalAlign: 'top' } },
      { texture: { centerX: 80, centerY: 30, width: 40, height: 25 } },
    ] as const;
    product.mesh!.plates.forEach((plate, index) => { plate.decorationLayout = layouts[index]; });
    await renderProduct();
    expect(JSON.parse(element('[data-preview="1"]').getAttribute('data-layout')!)).toEqual(layouts[0]);
    expect(JSON.parse(element('[data-preview="2"]').getAttribute('data-layout')!)).toEqual(layouts[1]);
    expect(container.textContent).not.toContain('Horizontal text alignment');
    await act(async () => element<HTMLButtonElement>('.summary__actions button').click());
    const snapshot = addItem.mock.calls[0]?.[0];
    expect(snapshot?.plates?.map((plate) => plate.appearance?.decorationLayout)).toEqual(layouts);
  });

  it('renders separate, accessibly associated controls and previews with one shared scale', async () => {
    await renderProduct();
    expect(container.querySelectorAll('.plate-configurator')).toHaveLength(2);
    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(1);
    const ids = Array.from(container.querySelectorAll('[id]')).map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    const base = element<HTMLElement>('[aria-label="Configure plate: Base"]');
    const lid = element<HTMLElement>('[aria-label="Configure plate: Lid"]');
    expect(element<HTMLInputElement>('input[type="radio"]', base).name)
      .not.toBe(element<HTMLInputElement>('input[type="radio"]', lid).name);
    const half = Array.from(container.querySelectorAll<HTMLButtonElement>('.size-preset'))
      .find((button) => button.textContent?.startsWith('50%'));
    if (!half) throw new Error('Missing 50% size preset.');
    await act(async () => half.click());
    const scale = element('[data-preview="1"]').getAttribute('data-scale');
    expect(element('[data-preview="2"]').getAttribute('data-scale')).toBe(scale);
    const axes: unknown = JSON.parse(scale ?? 'null');
    if (!Array.isArray(axes) || axes.length !== 3) throw new Error('Missing shared preview scale.');
    for (const axis of axes) {
      if (typeof axis !== 'number') throw new Error('Preview scale must be numeric.');
      expect(Math.abs(axis - 0.5)).toBeLessThan(0.001);
    }
  });

  it('keeps text and filament choices local and does not reset newer edits when an image finishes loading', async () => {
    await renderProduct();
    const base = element<HTMLElement>('[aria-label="Configure plate: Base"]');
    const lid = element<HTMLElement>('[aria-label="Configure plate: Lid"]');
    await act(async () => element<HTMLInputElement>('input[value="gold"]', base).click());
    await act(async () => element<HTMLInputElement>('input[value="red"]', lid).click());
    let finishImage: ((value: string) => void) | undefined;
    vi.mocked(fileToResizedDataUrl).mockImplementationOnce(() => new Promise((resolve) => { finishImage = resolve; }));
    const upload = element<HTMLInputElement>('input[type="file"]', base);
    Object.defineProperty(upload, 'files', { value: [new File(['image'], 'base.png', { type: 'image/png' })] });
    await act(async () => upload.dispatchEvent(new Event('change', { bubbles: true })));
    await act(async () => enterText(element('textarea', base), 'First plate'));
    await act(async () => enterText(element('textarea', lid), 'Second plate'));
    if (!finishImage) throw new Error('Image upload did not start.');
    await act(async () => finishImage?.('data:image/png;base64,AA=='));
    expect(element('[data-preview="1"]').getAttribute('data-text')).toBe('First plate');
    expect(element('[data-preview="2"]').getAttribute('data-text')).toBe('Second plate');
    expect(element('[data-preview="1"]').getAttribute('data-color')).toBe('#c9a227');
    expect(element('[data-preview="2"]').getAttribute('data-color')).toBe('#d33a2c');
    expect(element('[data-preview="1"]').getAttribute('data-texture')).toBe('data:image/png;base64,AA==');
    expect(element('[data-preview="2"]').hasAttribute('data-texture')).toBe(false);
    await act(async () => element<HTMLButtonElement>('.summary__actions button').click());
    const item = addItem.mock.calls[0]?.[0];
    if (!item) throw new Error('The configured set was not added to the cart.');
    expect(item.unitPrice).toBe(29 + 3 + 5 + 7);
    expect(item.customization.plates?.['1']).toMatchObject({ colorId: 'gold', engravingText: 'First plate', textureDataUrl: 'data:image/png;base64,AA==' });
    expect(item.customization.plates?.['2']).toMatchObject({ colorId: 'red', engravingText: 'Second plate', textureDataUrl: null });
    await act(async () => root.render(<ConfigurationDetails item={item} />));
    expect(element('[aria-label="Plate configuration: Base"]').textContent).toContain('First plate');
    expect(element('[aria-label="Plate configuration: Lid"]').textContent).toContain('Second plate');
    expect(element('[aria-label="Plate configuration: Lid"]').textContent).not.toContain('Custom picture');
  });

  it('blocks adding the set if any included plate has invalid text', async () => {
    await renderProduct();
    const lid = element<HTMLElement>('[aria-label="Configure plate: Lid"]');
    await act(async () => enterText(element('textarea', lid), '<bad>'));
    expect(element<HTMLButtonElement>('.summary__actions button').disabled).toBe(true);
    expect(lid.textContent).toContain('Lid: Use letters');
    expect(addItem).not.toHaveBeenCalled();
  });

  it('recolors and resets the same painted part independently on each plate', async () => {
    const part = { key: 'filament:1', name: 'Paint', fileColor: '#123456' };
    if (!product.mesh) throw new Error('Missing fixture model.');
    product.mesh.parts = [part];
    product.mesh.plates.forEach((plate) => { plate.parts = [part]; });
    await renderProduct();
    const base = element<HTMLElement>('[aria-label="Configure plate: Base"]');
    const lid = element<HTMLElement>('[aria-label="Configure plate: Lid"]');
    await act(async () => element<HTMLInputElement>('input[value="gold"]', base).click());
    await act(async () => element<HTMLInputElement>('input[value="red"]', lid).click());
    expect(element('[data-preview="1"]').getAttribute('data-parts')).toBe('{"filament:1":"#c9a227"}');
    expect(element('[data-preview="2"]').getAttribute('data-parts')).toBe('{"filament:1":"#d33a2c"}');
    const reset = Array.from(base.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Reset to original colors');
    if (!reset) throw new Error('Missing color reset.');
    await act(async () => reset.click());
    expect(element('[data-preview="1"]').getAttribute('data-parts')).toBe('{"filament:1":"#123456"}');
    expect(element('[data-preview="2"]').getAttribute('data-parts')).toBe('{"filament:1":"#d33a2c"}');
  });

  it('preserves the original single-preview configurator for products without plates', async () => {
    product.mesh = null;
    await renderProduct();
    expect(container.querySelectorAll('[data-preview]')).toHaveLength(1);
    expect(container.querySelectorAll('.plate-configurator')).toHaveLength(0);
    await act(async () => enterText(element('textarea'), 'Legacy'));
    expect(element('[data-preview="root"]').getAttribute('data-text')).toBe('Legacy');
  });
});
