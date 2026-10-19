/**
 * npm run db:seed:demo:specialists
 *
 * Adds more clinical departments and doctors (demo-specialists.ts) to hms_dev, as hms_app, in
 * one transaction. The new doctor accounts get the same password as the existing demo doctors:
 * the stored hash of the first demo doctor (DEMO-101) is reused, so no password is typed,
 * printed or written to a file. Refuses in production, unless explicitly run for "dev" and the
 * server confirms the session is hms_app on hms_dev, and when the demo doctors are missing
 * (run db:seed:demo first). Prints the target and counts only.
 */
import pg from 'pg';
import {
  DbConfigError,
  appUrl,
  assertConnectedTarget,
  describeTarget,
  runScript,
} from '../db-env.js';
import { seedDemoSpecialists } from './demo-specialists.js';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new DbConfigError('Refused: db:seed:demo:specialists is for development only.');
  }
  if (process.argv[2] !== 'dev' || process.argv.length !== 3) {
    throw new DbConfigError('Refused: this seed only targets hms_dev and must be run with "dev".');
  }
  const url = appUrl('dev');
  const client = new pg.Client({
    connectionString: url.href,
    application_name: 'hms-demo-specialists',
  });
  await client.connect();
  try {
    await assertConnectedTarget(client, 'dev', 'app');
    const { rows } = await client.query<{ hash: string }>(
      `SELECT u.password_hash AS hash FROM users u JOIN employees e ON e.id = u.employee_id
       WHERE e.employee_no = 'DEMO-101' AND u.status = 'active'`,
    );
    if (!rows[0]) {
      throw new DbConfigError(
        'Refused: the demo doctors are missing. Run db:seed:demo first so the new doctors can share their password.',
      );
    }
    await client.query('BEGIN');
    try {
      const r = await seedDemoSpecialists(client, { passwordHash: rows[0].hash });
      await client.query('COMMIT');
      console.log(`Demo departments and doctors on ${describeTarget(url)}:`);
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
