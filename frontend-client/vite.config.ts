/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createTranslator, resolveLanguage } from './src/i18n/translator.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.API_PROXY_TARGET || 'http://localhost:3001';
  const language = resolveLanguage(mode === 'test' ? 'en' : env.VITE_APP_LANGUAGE);
  return {
    plugins: [react(), {
      name: 'document-language',
      transformIndexHtml: (html) => html
        .replace('<html lang="en">', `<html lang="${language}">`)
        .replace('<title>PrintForge — Custom 3D Prints</title>', `<title>${createTranslator(language)('PrintForge — Custom 3D Prints')}</title>`),
    }],
    server: {
      port: 5173,
      strictPort: true,
      proxy: { '/api': target, '/models': target },
    },
    preview: { port: 4173, strictPort: true, proxy: { '/api': target, '/models': target } },
    test: { environment: 'node', env: { VITE_APP_LANGUAGE: 'en' } },
  };
});
