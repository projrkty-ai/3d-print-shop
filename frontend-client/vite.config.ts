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
    // Modules only the slicing Web Worker and the lazily loaded model readers import: bundled up front,
    // so the dev server doesn't discover them on first use and reload the page (losing the work).
    optimizeDeps: {
      include: [
        'clipper-lib', 'fflate', 'three/examples/jsm/libs/fflate.module.js', 'three/examples/jsm/loaders/3MFLoader.js',
        'three/examples/jsm/loaders/STLLoader.js', 'three/examples/jsm/loaders/FontLoader.js', 'three/examples/jsm/utils/BufferGeometryUtils.js',
      ],
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: { '/api': target, '/models': target },
    },
    preview: { port: 4173, strictPort: true, proxy: { '/api': target, '/models': target } },
    test: { environment: 'node', env: { VITE_APP_LANGUAGE: 'en' } },
  };
});
