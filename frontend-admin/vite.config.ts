/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { pl } from './src/i18n/pl.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const language = mode === 'test' ? 'en' : env.VITE_APP_LANGUAGE ?? 'en';
  if (language !== 'en' && language !== 'pl') {
    throw new Error(`Unsupported VITE_APP_LANGUAGE "${language}". Expected "en" or "pl".`);
  }
  const target = env.API_PROXY_TARGET || 'http://localhost:3001';
  return {
    plugins: [
      react(),
      {
        name: 'admin-document-language',
        transformIndexHtml: (html) => html
          .replace('<html lang="en">', `<html lang="${language}">`)
          .replace('PrintForge — Administration</title>', `${language === 'pl' ? pl['PrintForge — Administration'] : 'PrintForge — Administration'}</title>`),
      },
    ],
    server: {
      port: 5174,
      strictPort: true,
      proxy: { '/api': target, '/models': target },
    },
    preview: { port: 4174, strictPort: true, proxy: { '/api': target, '/models': target } },
    test: { environment: 'node', env: { VITE_APP_LANGUAGE: 'en' } },
  };
});
