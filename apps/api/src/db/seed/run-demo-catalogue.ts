/**
 * npm run db:seed:demo:catalogue
 *
 * Adds the synthetic operating data (demo-catalogue.ts) to hms_dev, as hms_app, in one
 * transaction. Refuses in production, and unless explicitly run for "dev" and the server
 * confirms the session is hms_app on hms_dev. Needs the demo accounts (db:seed:demo) for
 * opening stock. Prints the target and counts only.
 */
import pg from 'pg';
import {
  DbConfigError,
  appUrl,
  assertConnectedTarget,
  describeTarget,
  runScript,
} from '../db-env.js';
import { seedDemoCatalogue } from './demo-catalogue.js';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new DbConfigError('Refused: db:seed:demo:catalogue is for development only.');
  }
  if (process.argv[2] !== 'dev' || process.argv.length !== 3) {
    throw new DbConfigError('Refused: this seed only targets hms_dev and must be run with "dev".');
  }
  const url = appUrl('dev');
  const client = new pg.Client({
    connectionString: url.href,
    application_name: 'hms-demo-catalogue',
  });
  await client.connect();
  try {
    await assertConnectedTarget(client, 'dev', 'app');
    await client.query('BEGIN');
    try {
      const r = await seedDemoCatalogue(client);
      await client.query('COMMIT');
      console.log(`Demo catalogue on ${describeTarget(url)}:`);
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
