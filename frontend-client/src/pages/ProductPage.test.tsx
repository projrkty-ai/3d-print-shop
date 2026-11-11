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
      data-texture={props.textureUrl}
      data-lettering={props.extrudedText ? JSON.stringify({ text: props.extrudedText.text, sizeMm: props.extrudedText.sizeMm, z: props.extrudedText.layout.z }) : undefined}
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

describe('shop texture library', () => {
  const marble = { id: 'marble', name: 'Marble', url: '/api/media-files/marble' };
  const waves = { id: 'waves', name: 'Waves', url: '/api/media-files/waves' };

  function textureChoice(name: string, scope: ParentNode = container): HTMLInputElement {
    const label = Array.from(scope.querySelectorAll('label.texture-option'))
      .find((option) => option.querySelector('.texture-option__name')?.textContent === name);
    if (!label) throw new Error(`Missing texture choice: ${name}`);
    return element<HTMLInputElement>('input', label);
  }

  async function uploadPicture(scope: ParentNode, dataUrl: string) {
    vi.mocked(fileToResizedDataUrl).mockResolvedValueOnce(dataUrl);
    const upload = element<HTMLInputElement>('input[type="file"]', scope);
    Object.defineProperty(upload, 'files', { value: [new File(['image'], 'own.png', { type: 'image/png' })] });
    await act(async () => upload.dispatchEvent(new Event('change', { bubbles: true })));
  }

  beforeEach(() => {
    product.texture = { enabled: true, price: 7, options: [marble, waves], allowCustom: true };
  });

  it('previews a shop texture or own picture per plate and snapshots both in the cart', async () => {
    await renderProduct();
    const base = element<HTMLElement>('[aria-label="Configure plate: Base"]');
    const lid = element<HTMLElement>('[aria-label="Configure plate: Lid"]');
    expect(textureChoice('No texture', base).checked).toBe(true);
    expect(base.querySelector('input[type="file"]')).toBeNull();
    await act(async () => textureChoice('Marble', base).click());
    expect(element('[data-preview="1"]').getAttribute('data-texture')).toBe(marble.url);
    expect(element('[data-preview="2"]').hasAttribute('data-texture')).toBe(false);
    expect(base.textContent).toContain('Picture texture: Marble');
    await act(async () => textureChoice('Your picture', lid).click());
    await uploadPicture(lid, 'data:image/png;base64,AQ==');
    expect(element('[data-preview="2"]').getAttribute('data-texture')).toBe('data:image/png;base64,AQ==');
    expect(element('[data-preview="1"]').getAttribute('data-texture')).toBe(marble.url);
    expect(container.textContent).toContain('Marble, Custom picture');

    await act(async () => element<HTMLButtonElement>('.summary__actions button').click());
    const item = addItem.mock.calls[0]?.[0];
    if (!item) throw new Error('The configured set was not added to the cart.');
    expect(item.unitPrice).toBe(29 + 7);
    expect(item.customization.plates?.['1']).toMatchObject({ textureId: 'marble', textureDataUrl: null });
    expect(item.customization.plates?.['2']).toMatchObject({ textureDataUrl: 'data:image/png;base64,AQ==' });
    expect(item.customization.plates?.['2']).not.toHaveProperty('textureId');
    expect(item.plates?.map((plate) => plate.appearance?.texture)).toEqual([
      { source: 'library', ...marble }, { source: 'custom' },
    ]);
    await act(async () => root.render(<ConfigurationDetails item={item} />));
    const baseDetails = element('[aria-label="Plate configuration: Base"]');
    expect(baseDetails.textContent).toContain('Shop texture: Marble');
    expect(element<HTMLImageElement>('img', baseDetails).getAttribute('src')).toBe(marble.url);
    expect(element('[aria-label="Plate configuration: Lid"]').textContent).toContain('Custom picture');
  });

  it('brings back the uploaded picture after trying shop textures, and removes all texture with No texture', async () => {
    product.mesh = null;
    await renderProduct();
    await act(async () => textureChoice('Your picture').click());
    await uploadPicture(container, 'data:image/png;base64,AA==');
    await act(async () => textureChoice('Waves').click());
    expect(element('[data-preview="root"]').getAttribute('data-texture')).toBe(waves.url);
    expect(container.querySelector('input[type="file"]')).toBeNull();
    await act(async () => textureChoice('Your picture').click());
    expect(element('[data-preview="root"]').getAttribute('data-texture')).toBe('data:image/png;base64,AA==');
    await act(async () => textureChoice('No texture').click());
    expect(element('[data-preview="root"]').hasAttribute('data-texture')).toBe(false);
    expect(element('fieldset:has(.texture-options) legend').textContent).not.toContain(':');
  });

  it('offers only shop textures when uploads are disallowed, and the plain upload without a library', async () => {
    product.mesh = null;
    product.texture.allowCustom = false;
    await renderProduct();
    expect(Array.from(container.querySelectorAll('.texture-option__name')).map((option) => option.textContent))
      .toEqual(['No texture', 'Marble', 'Waves']);
    expect(container.querySelector('input[type="file"]')).toBeNull();
    await leaveProduct();
    product.texture = { enabled: true, price: 7 };
    await renderProduct();
    expect(container.querySelector('label.texture-option')).toBeNull();
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
    await leaveProduct();
    product.texture = { enabled: true, price: 7, options: [], allowCustom: false };
    await renderProduct();
    expect(container.textContent).not.toContain('Picture texture');
  });

  it('resets a saved shop texture that the shop has since removed', async () => {
    product.mesh = null;
    await renderProduct();
    await act(async () => textureChoice('Waves').click());
    await leaveProduct();
    product.texture.options = [marble];
    await renderProduct();
    expect(textureChoice('No texture').checked).toBe(true);
    expect(element('[data-preview="root"]').hasAttribute('data-texture')).toBe(false);
    await act(async () => element<HTMLButtonElement>('.summary__actions button').click());
    expect(addItem.mock.calls[0]?.[0].customization).not.toHaveProperty('textureId');
  });

});

describe('3D lettering', () => {
  const lettering = {
    x: 0, y: -48, z: 120, rotationDeg: 0, tiltDeg: 0, sizeMm: 14, depthMm: 1.5, lineSpacing: 1.2,
    horizontalAlign: 'center' as const, verticalAlign: 'middle' as const, defaultText: 'Hello',
  };

  it('shows the suggestion, lets customers change text and size within bounds, and snapshots the result', async () => {
    product.mesh!.plates[0].decorationLayout = { extrudedText: lettering };
    await renderProduct();
    const base = element<HTMLElement>('[aria-label="Configure plate: Base"]');
    const lid = element<HTMLElement>('[aria-label="Configure plate: Lid"]');
    expect(lid.querySelector('[aria-label="3D lettering text"]')).toBeNull();
    const input = element<HTMLTextAreaElement>('[aria-label="3D lettering text"]', base);
    expect(input.value).toBe('Hello');
    expect(element('[data-preview="1"]').getAttribute('data-lettering')).toBe(JSON.stringify({ text: 'Hello', sizeMm: 14, z: 120 }));
    expect(element('[data-preview="2"]').hasAttribute('data-lettering')).toBe(false);

    await act(async () => enterText(input, 'Zażółć'));
    const size = element<HTMLInputElement>('[aria-label="3D lettering size in millimeters"]', base);
    expect([size.min, size.max]).toEqual(['7', '28']);
    await act(async () => enterNumber(size, '20'));
    expect(element('[data-preview="1"]').getAttribute('data-lettering')).toBe(JSON.stringify({ text: 'Zażółć', sizeMm: 20, z: 120 }));

    await act(async () => element<HTMLButtonElement>('.summary__actions button').click());
    const item = addItem.mock.calls[0]?.[0];
    expect(item?.customization.plates?.['1']).toMatchObject({ extrudedText: 'Zażółć', extrudedSizeMm: 20 });
    expect(item?.plates?.[0].appearance?.decorationLayout?.extrudedText).toEqual(lettering);
    await act(async () => root.render(<ConfigurationDetails item={item!} />));
    expect(element('[aria-label="Plate configuration: Base"]').textContent).toContain('“Zażółć” · 20 mm');

    await renderProduct();
    const reset = Array.from(element<HTMLElement>('[aria-label="Configure plate: Base"]').querySelectorAll('button'))
      .find((button) => button.textContent === 'Reset to the suggested lettering');
    await act(async () => reset?.click());
    expect(element<HTMLTextAreaElement>('[aria-label="3D lettering text"]', element('[aria-label="Configure plate: Base"]')).value).toBe('Hello');
  });

  it('blocks ordering unsupported lettering characters and allows clearing the lettering', async () => {
    product.mesh = null;
    product.decorationLayout = { extrudedText: lettering };
    await renderProduct();
    await act(async () => enterText(element('[aria-label="3D lettering text"]'), '№5'));
    expect(container.textContent).toContain('3D lettering supports Latin letters');
    expect(element<HTMLButtonElement>('.summary__actions button').disabled).toBe(true);
    await act(async () => enterText(element('[aria-label="3D lettering text"]'), ''));
    expect(element('[data-preview="root"]').hasAttribute('data-lettering')).toBe(false);
    expect(element<HTMLButtonElement>('.summary__actions button').disabled).toBe(false);
    await act(async () => element<HTMLButtonElement>('.summary__actions button').click());
    expect(addItem.mock.calls[0]?.[0].customization).toMatchObject({ extrudedText: '' });
  });
});

describe('print variants', () => {
  const variant = (id: string, label: string, nozzleMm = 0.4) => ({ id, label, nozzleMm, layerHeightMm: 0.2, material: 'PLA' as const, enabled: true });
  beforeEach(() => {
    product.slicing = [
      { plateId: 1, variants: [variant('fine', 'Fine'), variant('fast', 'Fast', 0.6)], defaultVariantId: 'fast' },
      { plateId: 2, variants: [variant('std', 'Standard')], defaultVariantId: 'std' },
    ];
    product.catalogPricing = {
      ratesPerCm3: { PLA: 0.2145, PETG: 0.2184, ABS: 0.2158, ASA: 0.2236, TPU: 0.234, resin: 0.312 }, handlingFee: 5, updatedAt: null,
      variantPrices: { '1:fine': 6.5, '1:fast': 3, '2:std': 1.5 },
    };
  });
  const printLine = () => element('.summary__lines tbody tr').textContent;

  it('lets customers choose how each plate is printed, with prices at the chosen size, and snapshots the choice', async () => {
    await renderProduct();
    const base = element<HTMLElement>('[aria-label="Configure plate: Base"]');
    const lid = element<HTMLElement>('[aria-label="Configure plate: Lid"]');
    expect(base.querySelectorAll('.variant-option')).toHaveLength(2);
    expect(element('.variant-option.is-selected', base).textContent).toBe('Fast0.6 mm nozzle · 0.2 mm layers · PLA$3.00');
    expect(lid.querySelectorAll('.variant-option')).toHaveLength(1);
    expect(printLine()).toContain('$4.50');

    await act(async () => element<HTMLInputElement>('input[value="fine"]', base).click());
    expect(printLine()).toContain('$8.00');
    expect(printLine()).toContain('Base: Fine ($6.50); Lid: Standard ($1.50)');

    await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('.size-preset'))
      .find((button) => button.textContent?.startsWith('50%'))!.click());
    expect(element('.variant-option.is-selected', base).textContent).toContain('$0.81');
    expect(printLine()).toContain('$1.00');

    await act(async () => element<HTMLButtonElement>('.summary__actions button').click());
    const item = addItem.mock.calls[0][0];
    expect(item.customization.plates?.[1].variantId).toBe('fine');
    expect(item.plates?.map((plate) => plate.appearance?.printVariant?.label)).toEqual(['Fine', 'Standard']);
    await act(async () => root.render(<ConfigurationDetails item={item} />));
    expect(container.textContent).toContain('Print qualityFine');
  });

  it('keeps the choice when returning to the product', async () => {
    await renderProduct();
    await act(async () => element<HTMLInputElement>('input[value="fine"]').click());
    await leaveProduct();
    await renderProduct();
    expect(element<HTMLInputElement>('input[value="fine"]').checked).toBe(true);
    expect(printLine()).toContain('$8.00');
  });
});

describe('scaling', () => {
  it('sells fixed-size products at their original size without a size picker', async () => {
    product.scaling = { enabled: false, minScale: 0.5, maxScale: 1.5 };
    const { defaultCustomization } = await import('../utils/customization');
    localStorage.setItem(`printforge.productDraft:${product.id}`, JSON.stringify({
      version: 1, quantity: 1, customization: { ...defaultCustomization(product), dimensions: { widthMm: 10, depthMm: 10, heightMm: 18.8 } },
    }));
    await renderProduct();
    expect(container.querySelector('[aria-label="Size as a percentage of the original"]')).toBeNull();
    expect(element('.fixed-size').textContent).toBe('Size: 95.9 × 95.9 × 180 mm (printed at the original size)');
    await act(async () => element<HTMLButtonElement>('.summary__actions button').click());
    expect(addItem.mock.calls[0][0].customization.dimensions).toEqual({ widthMm: 95.9, depthMm: 95.9, heightMm: 180 });
  });

  it('offers only the sizes the shop allows', async () => {
    product.scaling = { enabled: true, minScale: 0.6, maxScale: 1.4 };
    await renderProduct();
    const slider = element<HTMLInputElement>('[aria-label="Size as a percentage of the original"]');
    expect([slider.min, slider.max]).toEqual(['60', '140']);
    expect(Array.from(container.querySelectorAll('.size-preset__label')).map((label) => label.textContent)).toEqual(['Min', '75%', 'Original', '125%', 'Max']);
    await act(async () => enterNumber(element<HTMLInputElement>('.dimensions input'), '50'));
    expect(element('#dimensions-help').textContent).toBe('Choose a size from 60% to 140% of the original.');
    expect(element<HTMLButtonElement>('.summary__actions button').disabled).toBe(true);
  });

  it('prices print variants at other sizes from the prices the shop sliced at the ends of the range', async () => {
    product.scaling = { enabled: true, minScale: 0.6, maxScale: 1.4 };
    const variant = (id: string, label: string) => ({ id, label, nozzleMm: 0.4, layerHeightMm: 0.2, material: 'PLA' as const, enabled: true });
    product.slicing = [
      { plateId: 1, variants: [variant('fine', 'Fine')], defaultVariantId: 'fine' },
      { plateId: 2, variants: [variant('std', 'Standard')], defaultVariantId: 'std' },
    ];
    product.catalogPricing = {
      ratesPerCm3: { PLA: 0.2145, PETG: 0.2184, ABS: 0.2158, ASA: 0.2236, TPU: 0.234, resin: 0.312 }, handlingFee: 5, updatedAt: null,
      variantPrices: { '1:fine': 6.5, '2:std': 1.5 },
      variantScalePrices: { '1:fine': [{ scale: 0.6, price: 2 }, { scale: 1.4, price: 16 }], '2:std': [{ scale: 0.6, price: 0.5 }, { scale: 1.4, price: 4 }] },
    };
    await renderProduct();
    expect(element('.summary__lines tbody tr').textContent).toContain('$8.00');
    await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('.size-preset'))
      .find((button) => button.textContent?.startsWith('Max'))!.click());
    expect(element('.summary__lines tbody tr').textContent).toContain('$20.00');
    expect(element('.summary__lines tbody tr').textContent).toContain('Base: Fine ($16.00); Lid: Standard ($4.00) at 140% of the original size');
    expect(element('[aria-label="Configure plate: Base"] .variant-option__price').textContent).toBe('$16.00');
  });
});
