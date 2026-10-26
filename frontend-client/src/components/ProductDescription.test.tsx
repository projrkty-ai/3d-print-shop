// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeedProducts } from '../data/seedProducts';
import type { Product } from '../types';
import { prepareDescription, videoEmbedUrl } from '../utils/productDescription';
import { ProductDescription } from './ProductDescription';

let container: HTMLDivElement;
let root: Root;
let product: Product;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  product = { ...createSeedProducts()[0], imageUrl: '' };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('product description and media carousel', () => {
  it('uses only side arrows and an overlaid count, with directional wraparound and decorative outgoing images', async () => {
    product.gallery = ['first', 'second', 'third'].map((name) => ({ type: 'image', url: `https://example.com/${name}.png`, alt: name }));
    await act(async () => root.render(<ProductDescription product={product} />));
    const carousel = container.querySelector('.media-carousel')!;
    const viewport = carousel.querySelector('.media-carousel__viewport')!;
    expect(carousel.querySelectorAll('button')).toHaveLength(2);
    expect(carousel.querySelector('.media-carousel__pages,.media-carousel__navigation')).toBeNull();
    expect(carousel.querySelector('.media-carousel__slide--incoming')).toBeNull();
    expect(viewport.querySelectorAll(':scope > button')).toHaveLength(2);
    const previous = carousel.querySelector<HTMLButtonElement>('[aria-label="Previous media"]')!;
    const next = carousel.querySelector<HTMLButtonElement>('[aria-label="Next media"]')!;
    await act(async () => previous.click());
    expect(carousel.getAttribute('data-direction')).toBe('previous');
    expect(carousel.querySelector('[data-active="true"] img')?.getAttribute('alt')).toBe('third');
    expect(carousel.querySelector('.media-carousel__counter')?.textContent).toBe('3 / 3');
    const outgoing = carousel.querySelector('.media-carousel__slide--outgoing')!;
    expect(outgoing.getAttribute('aria-hidden')).toBe('true');
    expect(outgoing.hasAttribute('inert')).toBe(true);
    expect(outgoing.querySelector('img')?.getAttribute('alt')).toBe('');
    await act(async () => outgoing.dispatchEvent(new Event('animationend', { bubbles: true })));
    expect(carousel.querySelector('.media-carousel__slide--outgoing')).toBeNull();
    await act(async () => next.click());
    expect(carousel.getAttribute('data-direction')).toBe('next');
    expect(carousel.querySelector('[data-active="true"] img')?.getAttribute('alt')).toBe('first');
    expect(carousel.querySelector('.media-carousel__counter')?.textContent).toBe('1 / 3');
  });
  it('handles rapid navigation without stale indices or accumulating outgoing slides', async () => {
    product.gallery = ['first', 'second', 'third'].map((name) => ({ type: 'image', url: `https://example.com/${name}.png`, alt: name }));
    await act(async () => root.render(<ProductDescription product={product} />));
    const next = container.querySelector<HTMLButtonElement>('[aria-label="Next media"]')!;
    await act(async () => { next.click(); next.click(); });
    expect(container.querySelector('.media-carousel__counter')?.textContent).toBe('3 / 3');
    expect(container.querySelector('[data-active="true"] img')?.getAttribute('alt')).toBe('third');
    expect(container.querySelectorAll('.media-carousel__slide--outgoing')).toHaveLength(1);
    expect(container.querySelector('.media-carousel__slide--outgoing img')?.getAttribute('src')).toBe('https://example.com/second.png');
    await act(async () => next.click());
    expect(container.querySelector('.media-carousel__counter')?.textContent).toBe('1 / 3');
    expect(container.querySelectorAll('.media-carousel__slide')).toHaveLength(2);
  });
  it.each(['https://example.com/demo.webm', 'https://youtu.be/dQw4w9WgXcQ'])('immediately unmounts outgoing video %s instead of keeping a hidden playing slide', async (url) => {
    product.gallery = [
      { type: 'video', url, alt: 'Demo' },
      { type: 'image', url: 'https://example.com/photo.png', alt: 'Photo' },
    ];
    await act(async () => root.render(<ProductDescription product={product} />));
    const player = container.querySelector('.media-carousel video,.media-carousel iframe')!;
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Next media"]')!.click());
    expect(player.isConnected).toBe(false);
    expect(container.querySelector('.media-carousel__slide--outgoing')).toBeNull();
    expect(container.querySelector('[data-active="true"] img')?.getAttribute('alt')).toBe('Photo');
  });
  it('omits navigation controls for a single image', async () => {
    product.gallery = [{ type: 'image', url: 'https://example.com/only.png', alt: 'Only' }];
    await act(async () => root.render(<ProductDescription product={product} />));
    expect(container.querySelectorAll('.media-carousel button')).toHaveLength(0);
    expect(container.querySelector('.media-carousel__counter')).toBeNull();
    expect(container.querySelector('.media-carousel--multiple')).toBeNull();
  });
  it('keeps inline media in place and adds all description media and carousel-only entries without duplicates', async () => {
    product.descriptionFormat = 'html';
    product.description = '<h2>Features</h2><p>Before</p><img src="https://example.com/photo.png" alt="Front"><p>Between</p><video src="https://example.com/demo.mp4" title="Demo"></video><img src="https://example.com/photo.png" alt="Duplicate">';
    product.gallery = [{ type: 'image', url: '/api/media-files/one', alt: 'Gallery only' }];
    const prepared = prepareDescription(product);
    expect(prepared.media).toHaveLength(3);
    expect(prepared.html).not.toContain('/api/media-files/one');
    await act(async () => root.render(<ProductDescription product={product} />));
    expect(container.querySelectorAll('.rich-description img')).toHaveLength(2);
    expect(container.querySelector('.rich-description video')).not.toBeNull();
    expect(container.querySelector('.media-carousel')?.nextElementSibling?.className).toBe('rich-description');
    const next = container.querySelector<HTMLButtonElement>('[aria-label="Next media"]')!;
    await act(async () => next.click());
    expect(container.querySelector('.media-carousel__slide img')?.getAttribute('src')).toBe('https://example.com/photo.png');
    await act(async () => next.click());
    const video = container.querySelector('.media-carousel__slide video');
    expect(video?.getAttribute('src')).toBe('https://example.com/demo.mp4');
    expect(video?.hasAttribute('controls')).toBe(true);
    expect(video?.hasAttribute('autoplay')).toBe(false);
    await act(async () => next.click());
    expect(video?.isConnected).toBe(false);
    expect(container.querySelector('.media-carousel__slide img')?.getAttribute('alt')).toBe('Gallery only');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Previous media"]')!.click());
    expect(container.querySelector('.media-carousel__slide video')).not.toBeNull();
  });
  it('treats old descriptions as text and preserves line breaks, not executable HTML', async () => {
    product.description = 'Literal <strong>text</strong>\nSecond line';
    await act(async () => root.render(<ProductDescription product={product} />));
    expect(container.querySelector('strong')).toBeNull();
    expect(container.textContent).toContain('<strong>text</strong>');
    expect(container.querySelector('.rich-description br')).not.toBeNull();
    expect(container.querySelector('.media-carousel')).toBeNull();
  });
  it('sanitizes rich content and generates only trusted YouTube/Vimeo embeds', async () => {
    product.descriptionFormat = 'html';
    product.description = '<p onclick="evil()">Safe</p><script>evil()</script><iframe src="https://evil.example"></iframe><img src="javascript:evil()" onerror="evil()"><video src="https://youtu.be/dQw4w9WgXcQ" title="YouTube demo"></video>';
    await act(async () => root.render(<ProductDescription product={product} />));
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[onclick],[onerror]')).toBeNull();
    expect(container.querySelector('.rich-description iframe')?.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(container.innerHTML).not.toContain('https://evil.example');
    expect(container.querySelector('.media-carousel iframe')?.getAttribute('title')).toBe('YouTube demo');
    expect(videoEmbedUrl('https://vimeo.com/123456')).toBe('https://player.vimeo.com/video/123456');
    expect(videoEmbedUrl('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(videoEmbedUrl('https://%')).toBeNull();
  });
  it('resets the carousel when media changes and reports broken image loads', async () => {
    product.gallery = [{ type: 'image', url: 'https://example.com/broken.png', alt: 'Broken' }];
    await act(async () => root.render(<ProductDescription product={product} />));
    await act(async () => container.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
    product = { ...product, gallery: [] };
    await act(async () => root.render(<ProductDescription product={product} />));
    expect(container.querySelector('.media-carousel')).toBeNull();
  });
});
