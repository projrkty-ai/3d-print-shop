import { pl } from './pl';

export type Language = 'en' | 'pl';
export type Message = keyof typeof pl;
type Value = string | number;
type MessageValues<S extends string> = S extends `${string}{${number}}${infer Rest}`
  ? [Value, ...MessageValues<Rest>]
  : [];

export const en = Object.fromEntries(Object.keys(pl).map((message) => [message, message])) as { [K in Message]: K };

export function parseLanguage(value: string | undefined): Language {
  if (value === undefined) return 'en';
  if (value === 'en' || value === 'pl') return value;
  throw new Error(`Unsupported VITE_APP_LANGUAGE "${value}". Expected "en" or "pl".`);
}

export function createTranslator(language: Language) {
  return <K extends Message>(message: K, ...values: MessageValues<K>): string => {
    const template = language === 'pl' ? pl[message] : en[message];
    return template.replace(/\{(\d+)\}/g, (_, index: string) => {
      const value = values[Number(index)];
      if (value === undefined) throw new Error(`Missing translation parameter ${index}: ${message}`);
      return String(value);
    });
  };
}

export const language = parseLanguage(import.meta.env.VITE_APP_LANGUAGE);
export const locale = language === 'pl' ? 'pl-PL' : 'en-US';
export const t = createTranslator(language);

export const formatNumber = (value: number, options?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat(locale, options).format(value);

const countWords = {
  en: {
    product: { one: 'product', few: 'products', other: 'products' },
    order: { one: 'order', few: 'orders', other: 'orders' },
    object: { one: 'object', few: 'objects', other: 'objects' },
  },
  pl: {
    product: { one: 'produkt', few: 'produkty', other: 'produktów' },
    order: { one: 'zamówienie', few: 'zamówienia', other: 'zamówień' },
    object: { one: 'obiekt', few: 'obiekty', other: 'obiektów' },
  },
} as const;

export function formatCount(kind: keyof typeof countWords.en, count: number, selectedLanguage: Language = language): string {
  const selectedLocale = selectedLanguage === 'pl' ? 'pl-PL' : 'en-US';
  const category = new Intl.PluralRules(selectedLocale).select(count);
  const words = countWords[selectedLanguage][kind];
  const word = category === 'one' ? words.one : category === 'few' ? words.few : words.other;
  return `${new Intl.NumberFormat(selectedLocale).format(count)} ${word}`;
}

export function alignmentLabel(value: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'): string {
  const labels = { left: t('Left'), center: t('Center'), right: t('Right'), top: t('Top'), middle: t('Middle'), bottom: t('Bottom') };
  return labels[value];
}
