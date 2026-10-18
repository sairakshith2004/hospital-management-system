/**
 * npm run db:seed:demo:schedules
 *
 * Adds the demonstration doctor sessions (demo-schedules.ts) to hms_dev, as hms_app, in
 * one transaction. Refuses in production, and unless it is explicitly asked for "dev"
 * and the server confirms the session is hms_app on hms_dev. Needs no password: it creates
 * schedules only. Prints the target and table counts before and after, never data.
 */
import pg from 'pg';
import {
  DbConfigError,
  appUrl,
  assertConnectedTarget,
  describeTarget,
  runScript,
} from '../db-env.js';
import { seedDemoSchedules } from './demo-schedules.js';

/** Tables whose counts are reported; only doctor_schedules and audit_logs may change. */
const COUNTED = [
  'doctor_schedules',
  'audit_logs',
  'doctor_profiles',
  'appointments',
  'patients',
  'users',
  'user_roles',
  'roles',
  'permissions',
  'role_permissions',
] as const;

async function counts(client: pg.Client): Promise<Record<string, number>> {
  const { rows } = await client.query<Record<string, number>>(
    `SELECT ${COUNTED.map((t) => `(SELECT count(*)::int FROM ${t}) AS ${t}`).join(', ')}`,
  );
  return rows[0]!;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new DbConfigError('Refused: db:seed:demo:schedules is for development only.');
  }
  if (process.argv[2] !== 'dev' || process.argv.length !== 3) {
    throw new DbConfigError('Refused: this seed only targets hms_dev and must be run with "dev".');
  }
  const url = appUrl('dev');
  const client = new pg.Client({
    connectionString: url.href,
    application_name: 'hms-demo-schedules',
  });
  await client.connect();
  try {
    await assertConnectedTarget(client, 'dev', 'app');
    const before = await counts(client);
    await client.query('BEGIN');
    let result;
    try {
      result = await seedDemoSchedules(client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    const after = await counts(client);
    console.log(`Demo schedules on ${describeTarget(url)}:`);
    console.log(
      `  doctors: ${result.doctors}, sessions inserted: ${result.inserted}, already present: ${result.skipped}`,
    );
    for (const table of COUNTED) {
      const delta = after[table]! - before[table]!;
      console.log(
        `  ${table}: ${before[table]} -> ${after[table]}${delta ? ` (${delta > 0 ? '+' : ''}${delta})` : ''}`,
      );
    }
  } finally {
    await client.end();
  }
}

runScript(main);
