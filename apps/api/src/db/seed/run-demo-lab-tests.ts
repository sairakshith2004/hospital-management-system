/**
 * npm run db:seed:demo:lab-tests
 *
 * Adds the synthetic lab test catalogue (demo-lab-tests.ts) to hms_dev, as hms_app, in one
 * transaction. Refuses in production, and unless explicitly run for "dev" and the server
 * confirms the session is hms_app on hms_dev. Needs nothing else seeded first. Prints the
 * target and counts only.
 */
import pg from 'pg';
import {
  DbConfigError,
  appUrl,
  assertConnectedTarget,
  describeTarget,
  runScript,
} from '../db-env.js';
import { seedDemoLabTests } from './demo-lab-tests.js';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new DbConfigError('Refused: db:seed:demo:lab-tests is for development only.');
  }
  if (process.argv[2] !== 'dev' || process.argv.length !== 3) {
    throw new DbConfigError('Refused: this seed only targets hms_dev and must be run with "dev".');
  }
  const url = appUrl('dev');
  const client = new pg.Client({
    connectionString: url.href,
    application_name: 'hms-demo-lab-tests',
  });
  await client.connect();
  try {
    await assertConnectedTarget(client, 'dev', 'app');
    await client.query('BEGIN');
    try {
      const r = await seedDemoLabTests(client);
      await client.query('COMMIT');
      console.log(`Demo lab tests on ${describeTarget(url)}:`);
      for (const [k, v] of Object.entries(r)) console.log(`  ${k}: ${String(v)}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    await client.end();
  }
}

runScript(main);
