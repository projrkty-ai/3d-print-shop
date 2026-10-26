export function createId(prefix = ''): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}-${random}` : random;
}

/** Letters that Unicode normalization doesn't reduce to ASCII. */
const TRANSLITERATIONS: Record<string, string> = { ł: 'l', đ: 'd', ø: 'o', ß: 'ss', æ: 'ae', œ: 'oe', þ: 'th' };

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[łđøßæœþ]/g, (ch) => TRANSLITERATIONS[ch])
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return slug || 'product';
}

/** URL-friendly id derived from `text` that doesn't collide with `taken`. */
export function uniqueSlug(text: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugify(text);
  let slug = base;
  for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}
