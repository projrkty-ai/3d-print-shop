import { defineConfig } from 'vitest/config';

/** Tests that use a database run once per store; `npm run test:sqlite` needs no MongoDB download. */
const STORAGE_TESTS = ['src/api.test.ts', 'src/customOrders.test.ts', 'src/logBook.test.ts', 'src/i18n.test.ts', 'src/projectOrders.test.ts', 'src/storage/storage.test.ts'];

export default defineConfig({
  test: {
    environment: 'node',
    env: { APP_LANGUAGE: 'en' },
    projects: [
      { extends: true, test: { name: 'sqlite', env: { TEST_DATABASE: 'sqlite' } } },
      { extends: true, test: { name: 'mongodb', env: { TEST_DATABASE: 'mongodb' }, include: STORAGE_TESTS } },
    ],
  },
});
