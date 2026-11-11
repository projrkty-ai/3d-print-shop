import pl from './pl.json' with { type: 'json' };

export type Language = 'en' | 'pl';
export type MessageKey = keyof typeof pl;
type Placeholder<Key extends string> = Key extends `${string}{${infer Name}}${infer Rest}` ? Name | Placeholder<Rest> : never;
type Arguments<Key extends MessageKey> = [Placeholder<Key>] extends [never]
  ? [values?: undefined]
  : [values: Record<Placeholder<Key>, string | number>];
type PluralMessage = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

const englishPlurals: Partial<Record<MessageKey, PluralMessage>> = {
  '{count} objects': { one: '{count} object', other: '{count} objects' },
  '{count} business days': { one: '{count} business day', other: '{count} business days' },
  '{count} plates': { one: '{count} plate', other: '{count} plates' },
  '{count} copies': { one: '{count} copy', other: '{count} copies' },
  '{count} files': { one: '{count} file', other: '{count} files' },
  '{count} prints in total': { one: '{count} print in total', other: '{count} prints in total' },
  '≈ {value0} for {count} copies': { one: '≈ {value0} for {count} copy', other: '≈ {value0} for {count} copies' },
  '{count} results': { one: '{count} result', other: '{count} results' },
  '{count}+ results': { one: '{count}+ results', other: '{count}+ results' },
  'Showing {count} models': { one: 'Showing {count} model', other: 'Showing {count} models' },
};

export function resolveLanguage(value: string | undefined): Language {
  if (value === undefined) return 'en';
  if (value === 'en' || value === 'pl') return value;
  throw new Error(`Unsupported VITE_APP_LANGUAGE "${value}". Use "en" or "pl".`);
}

export function localeFor(language: Language): string {
  return language === 'pl' ? 'pl-PL' : 'en-US';
}

export function createTranslator(language: Language) {
  const plurals = new Intl.PluralRules(localeFor(language));
  const numbers = new Intl.NumberFormat(localeFor(language));
  return function translate<Key extends MessageKey>(key: Key, ...[values]: Arguments<Key>): string {
    const message: string | PluralMessage = language === 'pl' ? pl[key] : englishPlurals[key] ?? key;
    const parameters: Record<string, string | number> = { ...values };
    let template: string;
    if (typeof message === 'string') template = message;
    else {
      if (typeof parameters.count !== 'number' || !Number.isFinite(parameters.count)) {
        throw new Error(`A finite numeric count is required for "${key}".`);
      }
      template = message[plurals.select(parameters.count)] ?? message.other;
      // Counts are quantities, shown with the locale's digit grouping (1,843 / 1843 / 12 345).
      parameters.count = numbers.format(parameters.count);
    }
    return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
      if (!(name in parameters)) throw new Error(`Missing translation parameter "${name}" for "${key}".`);
      return String(parameters[name]);
    });
  };
}
