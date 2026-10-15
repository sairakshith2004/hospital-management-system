/**
 * npm run db:seed (hms_dev) / npm run db:seed:test (hms_test)
 *
 * Seeds reference data as hms_owner in one transaction. Prints the target as
 * role@host:port/database and counts only.
 */
import pg from 'pg';
import { describeTarget, migrationUrl, parseMode, runScript } from '../db-env.js';
import { seedReferenceData, type UpsertCounts } from './seed.js';

const show = (c: UpsertCounts) =>
  `${c.inserted} inserted, ${c.updated} updated, ${c.unchanged} unchanged`;

async function main(): Promise<void> {
  const url = migrationUrl(parseMode(process.argv[2]));
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  try {
    await client.query('BEGIN');
    try {
      const r = await seedReferenceData(client);
      await client.query('COMMIT');
      console.log(`Seed on ${describeTarget(url)}:`);
      console.log(`  settings: ${r.settings}`);
      console.log(`  permissions: ${show(r.permissions)}`);
      console.log(`  roles: ${show(r.roles)}`);
      console.log(
        `  role permissions: ${r.rolePermissions.inserted} inserted, ${r.rolePermissions.unchanged} unchanged`,
      );
      console.log(`  audit row: ${r.audited ? 'written' : 'not needed (no changes)'}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    await client.end();
  }
}

runScript(main);
