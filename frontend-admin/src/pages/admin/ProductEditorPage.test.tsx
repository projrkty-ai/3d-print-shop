// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductPreview } from '../../components/ProductPreview';
import { createSeedProducts } from '../../data/seedProducts';
import type { Product } from '../../types';
import type { MeshAnalysis } from '../../utils/mesh';
import type { ModelFileCard } from './ModelFileCard';
import { ProductEditorPage } from './ProductEditorPage';
import { api, ApiError } from '../../api/client';

let product: Product;
const updateProduct = vi.fn(async (_id: string, body: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => ({ ...product, ...body }));
const createProduct = vi.fn(async (body: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => {
  product = { ...product, ...body, id: 'created-product' };
  return product;
});
const analysis: MeshAnalysis = {
  widthMm: 110, depthMm: 110, heightMm: 200, volumeCm3: 100, triangleCount: 12, parts: [], plate: 1,
  plates: [{ id: 1, name: 'Base', objectCount: 1 }, { id: 2, name: 'Lid', objectCount: 1 }],
};

vi.mock('../../store/ProductsContext', () => ({
  useProducts: () => ({ getProduct: () => product, load: { status: 'ready' }, updateProduct, createProduct }),
}));
vi.mock('../../components/LazyProductPreview', () => ({
  LazyProductPreview: (props: ComponentProps<typeof ProductPreview>) => (
    <div data-preview={props.meshPlate ?? 'root'} data-plates={JSON.stringify(props.meshPlates)} data-layout={JSON.stringify(props.decorationLayout)} />
  ),
}));
vi.mock('./ModelFileCard', () => ({
  ModelFileCard: ({ onPlateChanged, onLoaded }: ComponentProps<typeof ModelFileCard>) => (
    <div>
      <button type="button" onClick={() => onPlateChanged([1, 2], analysis)}>Reanalyze plates</button>
      <button type="button" onClick={() => onLoaded(new File(['3mf'], 'replacement.3mf'), '3mf', analysis)}>Replace model</button>
    </div>
  ),
}));

let container: HTMLDivElement;
let root: Root;
function element<T extends Element>(selector: string): T {
  const found = container.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element: ${selector}`);
  return found;
}
function control(label: string): HTMLInputElement | HTMLSelectElement {
  const wrapper = Array.from(container.querySelectorAll('label')).find((node) => node.textContent?.startsWith(label));
  const input = wrapper?.querySelector('input,select');
  if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) throw new Error(`Missing control: ${label}`);
  return input;
}
async function change(label: string, value: string) {
  const input = control(label);
  await act(async () => {
    if (input instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!setter) throw new Error('Input setter is unavailable.');
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}
async function click(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find((node) => node.textContent === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => button.click());
}
function LocationProbe() {
  return <span data-path={useLocation().pathname} />;
}
async function renderEditor(path = `/admin/products/${product.id}`) {
  await import('../../components/DescriptionEditor');
  await act(async () => root.render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/admin/products/new" element={<ProductEditorPage />} />
        <Route path="/admin/products/:productId" element={<ProductEditorPage />} />
        <Route path="/admin" element={<div>Saved products</div>} />
      </Routes>
    </MemoryRouter>,
  ));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:replacement');
    static revokeObjectURL = vi.fn();
  });
  updateProduct.mockClear();
  createProduct.mockClear();
  product = createSeedProducts()[0];
  product.engraving.enabled = true;
  product.texture.enabled = true;
  product.mesh = {
    url: '/model.3mf', fileName: 'model.3mf', format: '3mf', sizeBytes: 100, triangleCount: 12, parts: [],
    plates: structuredClone(analysis.plates), selectedPlates: [1, 2], plate: 1,
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
  Reflect.deleteProperty(Range.prototype, 'getClientRects');
  vi.unstubAllGlobals();
});

describe('admin decoration placement', () => {
  it('saves in place, shows confirmation and allows further saves without losing the draft', async () => {
    await renderEditor();
    await change('Name', 'Updated name');
    await click('Save product');
    expect(element('[data-path]').getAttribute('data-path')).toBe(`/admin/products/${product.id}`);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Saved “Updated name”.');
    expect(control('Name').value).toBe('Updated name');
    await change('Name', 'Another edit');
    expect(container.querySelector('.banner--success')).toBeNull();
    await click('Save product');
    expect(updateProduct).toHaveBeenCalledTimes(2);
    expect(updateProduct.mock.calls[1][1].name).toBe('Another edit');
  });
  it('saves and exits only after a successful API response', async () => {
    let finish: ((saved: Product) => void) | undefined;
    updateProduct.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await renderEditor();
    await click('Save and exit');
    expect(element('[data-path]').getAttribute('data-path')).toBe(`/admin/products/${product.id}`);
    expect(control('Name').matches(':disabled')).toBe(true);
    expect(element('[contenteditable]').getAttribute('contenteditable')).toBe('false');
    expect(element<HTMLButtonElement>('.admin__header-actions button:last-child').disabled).toBe(true);
    await act(async () => finish!(product));
    expect(element('[data-path]').getAttribute('data-path')).toBe('/admin');
    expect(container.textContent).toBe('Saved products');
  });
  it('keeps failed saves in the editor and shows the API error', async () => {
    updateProduct.mockRejectedValueOnce(new ApiError(500, 'Save failed'));
    await renderEditor();
    await click('Save and exit');
    expect(element('[data-path]').getAttribute('data-path')).toBe(`/admin/products/${product.id}`);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Save failed');
    expect(control('Name').matches(':disabled')).toBe(false);
    expect(container.querySelector('.banner--success')).toBeNull();
  });
  it('creates once and continues editing the newly created product on Save product', async () => {
    await renderEditor('/admin/products/new');
    await change('Name', 'Created name');
    await click('Save product');
    expect(createProduct).toHaveBeenCalledOnce();
    expect(element('[data-path]').getAttribute('data-path')).toBe('/admin/products/created-product');
    expect(control('Name').value).toBe('Created name');
    await change('Name', 'Edited after creation');
    await click('Save product');
    expect(createProduct).toHaveBeenCalledOnce();
    expect(updateProduct).toHaveBeenCalledOnce();
    expect(updateProduct.mock.calls[0][0]).toBe('created-product');
  });
  it('creates and exits with the separate action, and validates before either action', async () => {
    await renderEditor('/admin/products/new');
    await click('Save and exit');
    expect(createProduct).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Name is required');
    await change('Name', 'Created and closed');
    await click('Save and exit');
    expect(createProduct).toHaveBeenCalledOnce();
    expect(element('[data-path]').getAttribute('data-path')).toBe('/admin');
  });
  it('does not reupload a replacement model after saving in place or retrying failed metadata', async () => {
    const uploadModel = vi.spyOn(api, 'uploadModelFile').mockResolvedValue({ url: '/api/model-files/permanent' });
    updateProduct.mockRejectedValueOnce(new ApiError(500, 'Retry metadata'));
    await renderEditor();
    await click('Replace model');
    await click('Save product');
    expect(uploadModel).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Retry metadata');
    await click('Save product');
    await click('Save product');
    expect(uploadModel).toHaveBeenCalledOnce();
    expect(updateProduct).toHaveBeenCalledTimes(3);
    expect(updateProduct.mock.calls.every(([, body]) => body.mesh?.url === '/api/model-files/permanent')).toBe(true);
  });

  it('blocks saving during description upload and persists inline HTML with carousel-only media', async () => {
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
    await import('../../components/DescriptionEditor');
    const finishes: ((value: { url: string }) => void)[] = [];
    vi.spyOn(api, 'uploadDescriptionImage').mockImplementation(() => new Promise((resolve) => { finishes.push(resolve); }));
    await renderEditor();
    await change('Add media to', 'carousel');
    await change('Media type', 'video');
    await change('Media URL', 'https://vimeo.com/123456');
    await click('Add media link');
    await change('Media type', 'image');
    await change('Add media to', 'description');
    const upload = element<HTMLInputElement>('[aria-label="Upload description image"]');
    Object.defineProperty(upload, 'files', { configurable: true, value: [
      new File(['image'], 'first.png', { type: 'image/png' }),
      new File(['image'], 'second.png', { type: 'image/png' }),
    ] });
    await act(async () => upload.dispatchEvent(new Event('change', { bubbles: true })));
    const save = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Save product')!;
    expect(save.disabled).toBe(true);
    expect(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Save and exit')?.disabled).toBe(true);
    await act(async () => save.click());
    expect(updateProduct).not.toHaveBeenCalled();
    await act(async () => finishes[0]({ url: '/api/media-files/123' }));
    expect(save.disabled).toBe(true);
    await act(async () => finishes[1]({ url: '/api/media-files/456' }));
    expect(save.disabled).toBe(false);
    await click('Save product');
    const body = updateProduct.mock.calls[0][1];
    expect(body.descriptionFormat).toBe('html');
    expect(body.description).toContain('src="/api/media-files/123"');
    expect(body.description).toContain('src="/api/media-files/456"');
    expect(body.description).not.toContain('vimeo.com');
    expect(body.gallery).toEqual([{ type: 'video', url: 'https://vimeo.com/123456', alt: '' }]);
    product = { ...product, ...body };
    await act(async () => root.render(<div />));
    await renderEditor();
    expect(container.querySelectorAll('.tiptap img')).toHaveLength(2);
    expect(container.querySelectorAll('.product-media-manager__item')).toHaveLength(3);
    const saveAgain = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Save product')!;
    await change('Media 2 description', 'Unapplied label');
    expect(saveAgain.disabled).toBe(true);
    await click('Cancel edits');
    expect(saveAgain.disabled).toBe(false);
    await change('Media 2 URL', 'https://example.com/updated.png');
    expect(saveAgain.disabled).toBe(true);
    const row = container.querySelectorAll('.product-media-manager__item')[1];
    const apply = Array.from(row.querySelectorAll('button')).find((button) => button.textContent === 'Update media')!;
    await act(async () => apply.click());
    expect(saveAgain.disabled).toBe(false);
    await click('Save product');
    expect(updateProduct.mock.calls[1][1].description).toContain('src="https://example.com/updated.png"');
    expect(updateProduct.mock.calls[1][1].description).toContain('src="/api/media-files/456"');
  });

  it('links texture axes by default, allows independent sizing and matches height to width when relinked', async () => {
    await renderEditor();
    expect(control('Scale both axes together').matches(':checked')).toBe(true);
    await change('Text horizontal anchor:', '20');
    await change('Texture horizontal center:', '70');
    await change('Texture width:', '40');
    expect(control('Texture height:').value).toBe('40');
    await change('Texture height:', '60');
    expect(control('Texture width:').value).toBe('60');
    await act(async () => control('Scale both axes together').click());
    await change('Texture width:', '25');
    expect(control('Texture height:').value).toBe('60');
    await change('Texture height:', '80');
    expect(control('Texture width:').value).toBe('25');
    await act(async () => control('Scale both axes together').click());
    expect(control('Texture height:').value).toBe('25');
    const first = JSON.parse(element('[data-preview]').getAttribute('data-layout')!);
    expect(first).toEqual({
      text: { centerX: 20, centerY: 50, horizontalAlign: 'center', verticalAlign: 'middle' },
      texture: { centerX: 70, centerY: 50, width: 25, height: 25 },
    });
    await change('Texture plate', '2');
    expect(element('[data-preview]').hasAttribute('data-layout')).toBe(false);
    await change('Texture plate', '1');
    expect(JSON.parse(element('[data-preview]').getAttribute('data-layout')!)).toEqual(first);
    await click('Save product');
    expect(updateProduct.mock.calls[0]?.[1].mesh?.plates[0].decorationLayout).toEqual(first);
  });

  it('does not overwrite saved independent dimensions on initial render', async () => {
    product.mesh!.plates[0].decorationLayout = {
      texture: { centerX: 50, centerY: 50, width: 35, height: 70 },
    };
    await renderEditor();
    expect(control('Scale both axes together').matches(':checked')).toBe(true);
    expect(control('Texture width:').value).toBe('35');
    expect(control('Texture height:').value).toBe('70');
    await change('Texture width:', '45');
    expect(control('Texture height:').value).toBe('45');
  });

  it('groups formatting in its corresponding section and keeps both plate selectors synchronized with the preview', async () => {
    await renderEditor();
    const engraving = element<HTMLElement>('[aria-label="Engraving settings"]');
    const texture = element<HTMLElement>('[aria-label="Picture texture settings"]');
    expect(container.textContent).not.toContain('Decoration placement');
    expect(engraving.textContent).toContain('Text placement');
    expect(engraving.textContent).not.toContain('Texture placement');
    expect(texture.textContent).toContain('Texture placement');
    expect(texture.textContent).not.toContain('Text placement');
    expect(control('Horizontal text alignment').closest('section')).toBe(engraving);
    expect(control('Texture width:').closest('section')).toBe(texture);
    await change('Texture plate', '2');
    expect(control('Engraving plate').value).toBe('2');
    expect(element('[data-preview]').getAttribute('data-preview')).toBe('2');
    await change('Engraving plate', '1');
    expect(control('Texture plate').value).toBe('1');
    expect(element('[data-preview]').getAttribute('data-preview')).toBe('1');
  });

  it('hides disabled formatting without losing settings or blocking the other section', async () => {
    await renderEditor();
    await change('Text horizontal anchor:', '30');
    await act(async () => element<HTMLInputElement>('[aria-label="Enable engraving"]').click());
    expect(element('[aria-label="Engraving settings"]').textContent).not.toContain('Text placement');
    expect(element('[aria-label="Picture texture settings"]').textContent).toContain('Texture placement');
    await change('Texture plate', '2');
    expect(element('[data-preview]').getAttribute('data-preview')).toBe('2');
    await act(async () => element<HTMLInputElement>('[aria-label="Enable engraving"]').click());
    await change('Engraving plate', '1');
    expect(control('Text horizontal anchor:').value).toBe('30');
    await act(async () => element<HTMLInputElement>('[aria-label="Enable picture texture"]').click());
    expect(element('[aria-label="Picture texture settings"]').textContent).not.toContain('Texture placement');
    expect(element('[aria-label="Engraving settings"]').textContent).toContain('Text placement');
  });

  it('edits, previews and saves independent plate layouts and preserves them across reanalysis', async () => {
    await renderEditor();
    expect(element('[data-preview]').getAttribute('data-preview')).toBe('1');
    expect(element('[data-preview]').hasAttribute('data-plates')).toBe(false);
    for (const slider of container.querySelectorAll<HTMLInputElement>('input[type="range"]')) {
      expect(slider.labels?.[0]?.control).toBe(slider);
    }
    await change('Text horizontal anchor:', '20');
    await change('Horizontal text alignment', 'left');
    await change('Vertical text alignment', 'top');
    await change('Texture horizontal center:', '70');
    await change('Texture width:', '40');
    const first = JSON.parse(element('[data-preview]').getAttribute('data-layout')!);
    expect(first).toEqual({
      text: { centerX: 20, centerY: 50, horizontalAlign: 'left', verticalAlign: 'top' },
      texture: { centerX: 70, centerY: 50, width: 40, height: 40 },
    });
    await change('Engraving plate', '2');
    expect(element('[data-preview]').getAttribute('data-preview')).toBe('2');
    expect(element('[data-preview]').hasAttribute('data-layout')).toBe(false);
    await change('Text vertical anchor:', '80');
    const second = JSON.parse(element('[data-preview]').getAttribute('data-layout')!);
    await change('Engraving plate', '1');
    expect(JSON.parse(element('[data-preview]').getAttribute('data-layout')!)).toEqual(first);
    await click('Reanalyze plates');
    expect(JSON.parse(element('[data-preview]').getAttribute('data-layout')!)).toEqual(first);
    await click('Save product');
    expect(updateProduct).toHaveBeenCalledOnce();
    expect(updateProduct.mock.calls[0]?.[1].mesh?.plates.map((plate) => plate.decorationLayout)).toEqual([first, second]);
    expect(element('[data-path]').getAttribute('data-path')).toBe(`/admin/products/${product.id}`);
    expect(container.querySelector('.banner--success')?.textContent).toContain('Saved');
  });

  it('resets text and texture independently and clears old plate settings when replacing the file', async () => {
    await renderEditor();
    await change('Text horizontal anchor:', '30');
    await change('Texture height:', '25');
    await click('Reset text placement');
    expect(JSON.parse(element('[data-preview]').getAttribute('data-layout')!)).toEqual({
      texture: { centerX: 50, centerY: 50, width: 25, height: 25 },
    });
    await click('Reset to repeating texture');
    expect(element('[data-preview]').hasAttribute('data-layout')).toBe(false);
    await change('Text vertical anchor:', '75');
    await click('Replace model');
    expect(element('[data-preview]').hasAttribute('data-layout')).toBe(false);
  });

  it('edits product-level placement for products without plates', async () => {
    product.mesh = null;
    await renderEditor();
    expect(container.textContent).not.toContain('Engraving plate');
    expect(container.textContent).not.toContain('Texture plate');
    await change('Texture width:', '35');
    expect(element('[data-preview]').getAttribute('data-preview')).toBe('root');
    expect(JSON.parse(element('[data-preview]').getAttribute('data-layout')!)).toEqual({
      texture: { centerX: 50, centerY: 50, width: 35, height: 35 },
    });
    await click('Save product');
    expect(updateProduct.mock.calls[0]?.[1].decorationLayout?.texture?.width).toBe(35);
  });
});
