import { t } from '../i18n';
import DOMPurify from 'dompurify';
import { resolveAssetUrl } from '../api/urls';
import type { Product, ProductMedia } from '../types';

export function isMediaUrl(value: string): boolean {
  return /^\/(?!\/)\S+$/.test(value) || (/^https?:\/\//i.test(value) && URL.canParse(value) && !/\s/.test(value));
}

export function videoEmbedUrl(value: string): string | null {
  if (!/^https?:\/\//i.test(value) || !URL.canParse(value)) return null;
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:embed|shorts)\/([^/]+)/.exec(url.pathname)?.[1] ?? null;
  } else if (host === 'youtu.be') id = url.pathname.slice(1);
  if (id && /^[\w-]{11}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
  if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(host)) {
    const video = /^\/(?:video\/)?(\d+)\/?$/.exec(url.pathname)?.[1];
    if (video) return `https://player.vimeo.com/video/${video}`;
  }
  return null;
}

export function sanitizeDescription(html: string): string {
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'h2', 'h3', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'a', 'img', 'video', 'source'],
    ALLOWED_ATTR: ['href', 'title', 'src', 'alt', 'controls', 'preload', 'poster', 'type', 'start'],
    ALLOW_DATA_ATTR: false,
  });
  const document = new DOMParser().parseFromString(sanitized, 'text/html');
  for (const node of document.querySelectorAll('img,video,source')) {
    for (const attribute of ['src', 'poster']) {
      const value = node.getAttribute(attribute);
      if (value && !isMediaUrl(value)) node.removeAttribute(attribute);
    }
  }
  return document.body.innerHTML;
}

export function editorDescription(product: Pick<Product, 'description' | 'descriptionFormat'>): string {
  if (product.descriptionFormat === 'html') return sanitizeDescription(product.description);
  const node = document.createElement('p');
  node.textContent = product.description;
  return node.outerHTML.replace(/\r?\n/g, '<br>');
}

export function prepareDescription(product: Pick<Product, 'description' | 'descriptionFormat' | 'gallery' | 'imageUrl' | 'name'>) {
  const document = new DOMParser().parseFromString(editorDescription(product), 'text/html');
  const media: ProductMedia[] = [];
  if (product.imageUrl) media.push({ type: 'image', url: product.imageUrl, alt: t("{0} printed example", product.name) });
  for (const item of product.gallery ?? []) {
    if (isMediaUrl(item.url)) media.push(item);
  }
  for (const node of document.querySelectorAll('img,video')) {
    const url = node.getAttribute('src') || node.querySelector('source')?.getAttribute('src');
    if (!url || !isMediaUrl(url)) { node.remove(); continue; }
    const video = node.tagName === 'VIDEO';
    const alt = node.getAttribute(video ? 'title' : 'alt') || product.name;
    media.push({ type: video ? 'video' : 'image', url, alt });
    if (video) {
      const embed = videoEmbedUrl(url);
      if (embed) {
        const frame = document.createElement('iframe');
        frame.src = embed;
        frame.title = alt;
        frame.loading = 'lazy';
        frame.setAttribute('allowfullscreen', '');
        frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        node.replaceWith(frame);
      } else {
        node.setAttribute('controls', '');
        node.setAttribute('preload', 'metadata');
        node.setAttribute('src', resolveAssetUrl(url));
        const poster = node.getAttribute('poster');
        if (poster) node.setAttribute('poster', resolveAssetUrl(poster));
        node.querySelectorAll('source').forEach((source) => source.remove());
      }
    } else {
      node.setAttribute('src', resolveAssetUrl(url));
      node.setAttribute('loading', 'lazy');
    }
  }
  for (const link of document.querySelectorAll('a')) link.setAttribute('rel', 'noopener noreferrer');
  return {
    html: document.body.innerHTML,
    media: media.filter((item, index) => media.findIndex((other) => other.type === item.type && other.url === item.url) === index),
  };
}
