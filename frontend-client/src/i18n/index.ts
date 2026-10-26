import { createTranslator, localeFor, resolveLanguage } from './translator';

export const LANGUAGE = resolveLanguage(import.meta.env.VITE_APP_LANGUAGE);
export const LOCALE = localeFor(LANGUAGE);
export const t = createTranslator(LANGUAGE);
