import { configDefaults, defineConfig } from 'vitest/config';

// Database tests (*.db.test.ts) need hms_test, so they run only with `npm run test:db`.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, '**/*.db.test.ts'] },
});
