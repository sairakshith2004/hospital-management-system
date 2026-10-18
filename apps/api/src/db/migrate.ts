/**
 * npm run db:migrate (hms_dev) / npm run db:migrate:test (hms_test)
 *
 * Applies pending migrations from src/db/migrations as hms_owner. Forward-only:
 * Drizzle runs all pending migrations in one transaction and records them in
 * drizzle.__drizzle_migrations. An advisory lock stops two runs from overlapping.
 * Before anything else the server must confirm the session is hms_owner on the expected
 * database. Prints the target as role@host/database, never the connection string.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
  assertConnectedTarget,
  describeTarget,
  migrationUrl,
  parseMode,
  runScript,
} from './db-env.js';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('./migrations', import.meta.url));
// Arbitrary constant shared by every db:migrate run.
const MIGRATION_LOCK_KEY = 4_200_401;

async function appliedCount(client: pg.Client): Promise<number> {
  const exists = await client.query<{ present: boolean }>(
    "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present",
  );
  if (!exists.rows[0]?.present) return 0;
  const result = await client.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
  );
  return result.rows[0]?.n ?? 0;
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv[2]);
  const url = migrationUrl(mode);
  if (!existsSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`)) {
    console.log(`No migrations yet; nothing to apply to ${describeTarget(url)}.`);
    return;
  }

  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  try {
    await assertConnectedTarget(client, mode, 'owner');
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      const before = await appliedCount(client);
      await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_FOLDER });
      const after = await appliedCount(client);
      console.log(
        `Migrations on ${describeTarget(url)}: ${after - before} applied, ${after} in total.`,
      );
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}

runScript(main);
