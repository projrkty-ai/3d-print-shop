import sanitizeHtml from 'sanitize-html';

function safeMediaUrl(url: string | undefined): string | undefined {
  const value = url?.trim();
  return value && (/^\/(?!\/)\S+$/.test(value) || (/^https?:\/\//i.test(value) && URL.canParse(value) && !/\s/.test(value))) ? value : undefined;
}

export function sanitizeDescription(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'h2', 'h3', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li',
      'blockquote', 'pre', 'code', 'hr', 'a', 'img', 'video', 'source'],
    allowedAttributes: {
      a: ['href', 'title', 'rel'],
      img: ['src', 'alt', 'title'],
      video: ['src', 'title', 'controls', 'preload', 'poster'],
      source: ['src', 'type'],
      ol: ['start'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'iframe'],
    transformTags: {
      a: (_tag, attributes) => ({ tagName: 'a', attribs: { ...attributes, rel: 'noopener noreferrer' } }),
      img: (_tag, attributes) => ({
        tagName: 'img', attribs: { ...attributes, src: safeMediaUrl(attributes.src) ?? '' },
      }),
      video: (_tag, attributes) => ({
        tagName: 'video',
        attribs: {
          ...attributes, src: safeMediaUrl(attributes.src) ?? '', poster: safeMediaUrl(attributes.poster) ?? '',
          controls: '', preload: 'metadata',
        },
      }),
      source: (_tag, attributes) => ({
        tagName: 'source', attribs: { ...attributes, src: safeMediaUrl(attributes.src) ?? '' },
      }),
    },
    exclusiveFilter: (frame) => (frame.tag === 'img' || frame.tag === 'source') && !frame.attribs.src,
  });
}
