import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { environment: 'node', env: { APP_LANGUAGE: 'en' } } });
