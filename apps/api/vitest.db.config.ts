import { defineConfig } from 'vitest/config';

// `npm run test:db`: database tests only. Connections go through the db-env guards,
// so they can reach only hms_test. Files run one at a time because they share it.
export default defineConfig({
  test: {
    include: ['src/**/*.db.test.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
