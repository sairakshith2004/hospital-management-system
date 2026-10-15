import { defineConfig } from 'drizzle-kit';

// Used only by `drizzle-kit generate`, which works offline: no database credentials here.
// Never use `drizzle-kit push` or `drizzle-kit drop` (see README, "Migration rules").
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
});
