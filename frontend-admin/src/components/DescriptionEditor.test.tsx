// @vitest-environment jsdom
import { act, StrictMode, Suspense, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import type { ProductMedia } from '../types';
import { DescriptionEditor } from './DescriptionEditor';
import { ProductDescription } from './ProductDescription';
import { createSeedProducts } from '../data/seedProducts';

let container: HTMLDivElement;
let root: Root;
const changed = vi.fn();
const busyChanged = vi.fn();
function Harness({ initial = 'Original <literal> text', initialFormat, initialGallery = [], photo = '' }: {
  initial?: string; initialFormat?: 'html'; initialGallery?: ProductMedia[]; photo?: string;
}) {
  const [value, setValue] = useState(initial);
  const [format, setFormat] = useState<'html' | undefined>(initialFormat);
  const [gallery, setGallery] = useState<ProductMedia[]>(initialGallery);
  const [imageUrl, setImageUrl] = useState(photo);
  return <DescriptionEditor value={value} format={format} gallery={gallery}
    imageUrl={imageUrl} onImageUrlChange={setImageUrl}
    onChange={(html) => { changed(html); setValue(html); setFormat('html'); }}
    onGalleryChange={setGallery} onBusyChange={busyChanged} />;
}
function input<T extends HTMLInputElement | HTMLSelectElement>(label: string): T {
  const wrapper = Array.from(container.querySelectorAll('label')).find((node) => node.textContent?.startsWith(label));
  const control = wrapper?.querySelector<T>('input,select');
  if (!control) throw new Error(`Missing control ${label}`);
  return control;
}
async function enter(label: string, value: string) {
  const control = input(label);
  await act(async () => {
    if (control instanceof HTMLSelectElement) {
      control.value = value;
      control.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(control, value);
      control.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}
async function click(text: string) {
  const button = Array.from(container.querySelectorAll('button')).find((node) => node.textContent === text);
  if (!button) throw new Error(`Missing button ${text}`);
  await act(async () => button.click());
}
async function upload(file: File | File[]) {
  const field = container.querySelector<HTMLInputElement>('[aria-label="Upload description image"]')!;
  Object.defineProperty(field, 'files', { configurable: true, value: Array.isArray(file) ? file : [file] });
  await act(async () => field.dispatchEvent(new Event('change', { bubbles: true })));
}
async function manage(url: string, action: string) {
  const row = Array.from(container.querySelectorAll('.product-media-manager__item')).find(
    (item) => item.querySelector<HTMLInputElement>('input[type="url"]')?.value === url,
  );
  const button = Array.from(row?.querySelectorAll('button') ?? []).find((node) => node.textContent === action);
  if (!button) throw new Error(`Missing ${action} for ${url}`);
  await act(async () => button.click());
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  changed.mockClear();
  busyChanged.mockClear();
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
  Reflect.deleteProperty(Range.prototype, 'getClientRects');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('visual product description editor', () => {
  it('restores the editor after a StrictMode Suspense disconnect without using a destroyed instance', async () => {
    let suspended = false;
    let resume: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { resume = resolve; });
    function Suspension() {
      if (suspended) throw pending;
      return null;
    }
    const tree = () => (
      <StrictMode>
        <Suspense fallback={<p>Waiting for editor</p>}>
          <Harness />
          <Suspension />
        </Suspense>
      </StrictMode>
    );
    await act(async () => root.render(tree()));
    expect(container.querySelector('[role="textbox"]')?.textContent).toBe('Original <literal> text');
    suspended = true;
    await act(async () => root.render(tree()));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    suspended = false;
    await act(async () => { resume!(); root.render(tree()); });
    expect(container.querySelector('[role="textbox"]')?.textContent).toBe('Original <literal> text');
    expect(changed).not.toHaveBeenCalled();
    await click('Heading');
    expect(container.querySelector('[role="textbox"] h2')).not.toBeNull();
  });

  it('preserves old plain text until edited, and supports heading formatting', async () => {
    await act(async () => root.render(<Harness />));
    expect(container.querySelector('[role="textbox"]')?.textContent).toBe('Original <literal> text');
    expect(changed).not.toHaveBeenCalled();
    await click('Heading');
    expect(changed).toHaveBeenLastCalledWith(expect.stringContaining('<h2>Original &lt;literal&gt; text</h2>'));
    expect(container.querySelector('[role="textbox"] h2')).not.toBeNull();
    await click('Undo');
    expect(container.querySelector('[role="textbox"] h2')).toBeNull();
    await click('Redo');
    expect(container.querySelector('[role="textbox"] h2')).not.toBeNull();
  });
  it('inserts image links at the editor selection with alternative text', async () => {
    await act(async () => root.render(<Harness />));
    await enter('Media URL', 'https://example.com/photo.png');
    await enter('Media description', 'Side view');
    await click('Add media link');
    expect(container.querySelector('.tiptap img')?.getAttribute('src')).toBe('https://example.com/photo.png');
    expect(changed.mock.lastCall?.[0]).toContain('alt="Side view"');
  });
  it('adds carousel-only media without changing the inline description and allows removal', async () => {
    await act(async () => root.render(<Harness />));
    await enter('Add media to', 'carousel');
    await enter('Media type', 'video');
    expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent === 'Upload image')).toBe(false);
    await enter('Media URL', 'https://vimeo.com/123456');
    await enter('Media description', 'Assembly');
    await click('Add media link');
    expect(container.querySelector('.product-media-manager')?.textContent).toContain('Assembly');
    expect(container.querySelector('.tiptap video,.tiptap iframe')).toBeNull();
    expect(changed).not.toHaveBeenCalled();
    await click('Remove');
    expect(container.querySelector('.product-media-manager')?.textContent).toContain('No media added yet.');
  });
  it('uploads and retains every selected image in the description and media list', async () => {
    const uploadImage = vi.spyOn(api, 'uploadDescriptionImage').mockImplementation(async (file) => ({ url: `/api/media-files/${file.name}` }));
    await act(async () => root.render(<Harness />));
    expect(container.querySelector<HTMLInputElement>('[aria-label="Upload description image"]')?.multiple).toBe(true);
    const files = ['first.png', 'second.png', 'third.png'].map((name) => new File(['image'], name, { type: 'image/png' }));
    await upload(files);
    expect(uploadImage.mock.calls.map(([file]) => file.name)).toEqual(files.map((file) => file.name));
    expect(container.querySelectorAll('.tiptap img')).toHaveLength(3);
    expect(container.querySelectorAll('.product-media-manager__item')).toHaveLength(3);
    for (const file of files) expect(changed.mock.lastCall?.[0]).toContain(`/api/media-files/${file.name}`);
    expect(container.textContent).toContain('Added 3 of 3 images.');
    expect(busyChanged).toHaveBeenLastCalledWith(false);
  });
  it('inserts after a selected image rather than replacing that image', async () => {
    await act(async () => root.render(<Harness initialFormat="html"
      initial='<p>Before</p><img src="https://example.com/first.png" alt="First"><p>After</p>' />));
    await manage('https://example.com/first.png', 'Select in description');
    await enter('Media URL', 'https://example.com/second.png');
    await click('Add media link');
    const html = changed.mock.lastCall?.[0] as string;
    expect(html).toContain('https://example.com/first.png');
    expect(html).toContain('https://example.com/second.png');
    expect(html).toContain('Before');
    expect(html).toContain('After');
    expect(container.querySelectorAll('.tiptap img')).toHaveLength(2);
  });
  it('keeps successful uploads, continues the batch and reports each failed filename', async () => {
    const uploadImage = vi.spyOn(api, 'uploadDescriptionImage')
      .mockResolvedValueOnce({ url: '/api/media-files/first' })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ url: '/api/media-files/third' });
    await act(async () => root.render(<Harness />));
    await upload(['first.png', 'failed.png', 'third.png'].map((name) => new File(['image'], name, { type: 'image/png' })));
    expect(uploadImage).toHaveBeenCalledTimes(3);
    expect(container.querySelectorAll('.tiptap img')).toHaveLength(2);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('failed.png');
    expect(container.textContent).toContain('Added 2 of 3 images.');
    expect(busyChanged).toHaveBeenLastCalledWith(false);
  });
  it('checks the entire batch against the carousel limit before uploading anything', async () => {
    const uploadImage = vi.spyOn(api, 'uploadDescriptionImage');
    await act(async () => root.render(<Harness initialGallery={Array.from({ length: 49 }, (_, index) => ({
      type: 'image', url: `https://example.com/${index}.png`, alt: `Image ${index}`,
    }))} />));
    await enter('Add media to', 'carousel');
    await upload(['first.png', 'second.png'].map((name) => new File(['image'], name, { type: 'image/png' })));
    expect(uploadImage).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('at most 50');
    expect(container.querySelectorAll('.product-media-manager__item')).toHaveLength(49);
  });
  it('edits, moves, reorders and removes media without losing surrounding description text', async () => {
    await act(async () => root.render(<Harness initialFormat="html"
      initial='<p>Before</p><img src="https://example.com/inline.png" alt="Inline"><p>After</p>'
      initialGallery={[
        { type: 'image', url: 'https://example.com/gallery.png', alt: 'Gallery' },
        { type: 'video', url: 'https://example.com/demo.mp4', alt: 'Demo' },
      ]} />));
    expect(container.querySelectorAll('.product-media-manager__item')).toHaveLength(3);
    await enter('Media 3 URL', 'https://example.com/edited.png');
    await enter('Media 3 description', 'Edited label');
    await manage('https://example.com/edited.png', 'Update media');
    expect(changed.mock.lastCall?.[0]).toContain('src="https://example.com/edited.png" alt="Edited label"');
    await manage('https://example.com/edited.png', 'Move to carousel only');
    expect(container.querySelector('.tiptap img')).toBeNull();
    expect(container.querySelector('.tiptap')?.textContent).toBe('BeforeAfter');
    await manage('https://example.com/edited.png', 'Move earlier');
    expect(container.querySelector<HTMLInputElement>('.product-media-manager__item:nth-child(2) input[type="url"]')?.value).toBe('https://example.com/edited.png');
    await manage('https://example.com/edited.png', 'Move into description');
    expect(container.querySelector('.tiptap img')?.getAttribute('src')).toBe('https://example.com/edited.png');
    expect(container.querySelectorAll('.product-media-manager__item')).toHaveLength(3);
    await manage('https://example.com/edited.png', 'Remove');
    expect(container.querySelector('.tiptap img')).toBeNull();
    expect(container.querySelector('.tiptap')?.textContent).toBe('BeforeAfter');
    expect(container.querySelectorAll('.product-media-manager__item')).toHaveLength(2);
  });
  it('includes the original product photo and rejects unsafe media URL edits', async () => {
    await act(async () => root.render(<Harness photo="https://example.com/photo.png"
      initialGallery={[{ type: 'image', url: 'https://example.com/gallery.png', alt: 'Gallery' }]} />));
    expect(container.querySelectorAll('.product-media-manager__item')).toHaveLength(2);
    expect(container.querySelector('a[href="#product-photo"]')).not.toBeNull();
    await enter('Media 2 URL', 'javascript:alert(1)');
    await manage('javascript:alert(1)', 'Update media');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('valid HTTP(S)');
    expect(changed).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Remove media 1"]')!.click());
    expect(container.querySelectorAll('.product-media-manager__item')).toHaveLength(1);
  });
  it('keeps earlier media when adding consecutive images, uploads and video links', async () => {
    vi.spyOn(api, 'uploadDescriptionImage').mockResolvedValueOnce({ url: '/api/media-files/123' });
    await act(async () => root.render(<Harness />));
    await enter('Media URL', 'https://example.com/first.png');
    await click('Add media link');
    await upload(new File(['image'], 'picture.png', { type: 'image/png' }));
    await enter('Media type', 'video');
    await enter('Media URL', 'https://example.com/demo.webm');
    await click('Add media link');
    const html = changed.mock.lastCall?.[0] as string;
    expect(html).toContain('src="https://example.com/first.png"');
    expect(html).toContain('src="/api/media-files/123"');
    expect(html).toContain('src="https://example.com/demo.webm"');
    expect(container.querySelectorAll('.tiptap img')).toHaveLength(2);
    expect(container.querySelectorAll('.tiptap video')).toHaveLength(1);
  });
  it('stores linked videos in HTML and previews recognized providers without accepting raw iframe HTML', async () => {
    await act(async () => root.render(<Harness />));
    await enter('Media type', 'video');
    await enter('Media URL', 'https://youtu.be/dQw4w9WgXcQ');
    await enter('Media description', 'Demo');
    await click('Add media link');
    expect(changed.mock.lastCall?.[0]).toContain('<video');
    expect(changed.mock.lastCall?.[0]).toContain('https://youtu.be/dQw4w9WgXcQ');
    expect(container.querySelector('.tiptap iframe')?.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });
  it.each(['https://example.com/demo.webm', 'https://youtu.be/dQw4w9WgXcQ'])('moves %s between description blocks and saves only video markup', async (url) => {
    await act(async () => root.render(<Harness initialFormat="html"
      initial={`<p>Before</p><video src="${url}" title="Demo"></video><p>After</p>`} />));
    const handle = container.querySelector<HTMLElement>('[data-drag-handle]');
    expect(handle?.draggable).toBe(true);
    await click('Move video up');
    let html = changed.mock.lastCall?.[0] as string;
    expect(html.indexOf('<video')).toBeLessThan(html.indexOf('<p>Before</p>'));
    expect(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Move video up')?.disabled).toBe(true);
    await click('Move video down');
    await click('Move video down');
    html = changed.mock.lastCall?.[0] as string;
    expect(html.indexOf('<video')).toBeGreaterThan(html.indexOf('<p>After</p>'));
    expect(html.match(/<video\b/g)).toHaveLength(1);
    expect(html).toContain(`src="${url}"`);
    expect(html).not.toContain('button');
    expect(html).not.toContain('iframe');
    expect(container.querySelectorAll('.product-media-manager__item')).toHaveLength(1);
    await click('Undo');
    expect(changed.mock.lastCall?.[0]).toContain('<video');
  });
  it('uploads images, reports busy state and preserves newer text while waiting', async () => {
    let finish: ((value: { url: string }) => void) | undefined;
    vi.spyOn(api, 'uploadDescriptionImage').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => root.render(<Harness />));
    await upload(new File(['image'], 'picture.png', { type: 'image/png' }));
    expect(busyChanged).toHaveBeenCalledWith(true);
    await click('Heading');
    await act(async () => finish!({ url: '/api/media-files/123' }));
    expect(busyChanged).toHaveBeenLastCalledWith(false);
    const html = changed.mock.lastCall?.[0] as string;
    expect(html).toContain('<h2>Original &lt;literal&gt; text</h2>');
    expect(html).toContain('src="/api/media-files/123"');
  });
  it('shows upload errors and rejects video files or unsafe links', async () => {
    vi.spyOn(api, 'uploadDescriptionImage').mockRejectedValueOnce(new Error('offline'));
    await act(async () => root.render(<Harness />));
    await enter('Media URL', 'javascript:alert(1)');
    await click('Add media link');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('valid HTTP(S)');
    await upload(new File(['video'], 'video.mp4', { type: 'video/mp4' }));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Videos are added by link only');
    await upload(new File(['image'], 'image.png', { type: 'image/png' }));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not upload');
    expect(busyChanged).toHaveBeenLastCalledWith(false);
  });
  it('renders the admin description preview with both inline and carousel media', async () => {
    const product = { ...createSeedProducts()[0], imageUrl: '', descriptionFormat: 'html' as const,
      description: '<p>Details</p><img src="https://example.com/inline.png" alt="Inline">',
      gallery: [{ type: 'video' as const, url: 'https://vimeo.com/123456', alt: 'Carousel only' }],
    };
    await act(async () => root.render(<ProductDescription product={product} />));
    expect(container.querySelector('.rich-description img')?.getAttribute('alt')).toBe('Inline');
    expect(container.querySelector('.media-carousel iframe')?.getAttribute('src')).toBe('https://player.vimeo.com/video/123456');
    expect(container.querySelector('.rich-description iframe')).toBeNull();
  });
});
