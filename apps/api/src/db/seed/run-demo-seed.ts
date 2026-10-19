/**
 * npm run db:seed:demo
 *
 * Adds the synthetic demo data to hms_dev, as hms_app. Asks once, at a hidden prompt, for
 * the password shared by all new demo accounts; only its argon2id hash is stored. Refuses
 * in production and without an interactive terminal. Existing rows are never changed.
 */
import pg from 'pg';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, hashPassword } from '../../lib/password.js';
import { DbConfigError, appUrl, describeTarget, runScript } from '../db-env.js';
import { DEMO_STAFF, seedDemoData } from './demo-data.js';
import { PromptCancelled, promptHidden } from './prompt.js';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new DbConfigError('Refused: db:seed:demo is for development only.');
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new DbConfigError(
      'Refused: run this in an interactive terminal. The password is never read from a pipe or a file.',
    );
  }
  const url = appUrl('dev');
  console.log(
    `Demo accounts: ${DEMO_STAFF.map((s) => s.username).join(', ')}. Existing accounts keep their passwords.`,
  );
  const password = await promptHidden('Password for the new demo accounts (input hidden): ');
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new DbConfigError(
      `Refused: the password must be ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters.`,
    );
  }
  if ((await promptHidden('Repeat the password: ')) !== password) {
    throw new DbConfigError('Refused: the two passwords differ. Nothing was changed.');
  }
  const passwordHash = await hashPassword(password);

  const client = new pg.Client({ connectionString: url.href, application_name: 'hms-demo-seed' });
  await client.connect();
  try {
    await client.query('BEGIN');
    try {
      const result = await seedDemoData(client, { passwordHash });
      await client.query('COMMIT');
      console.log(
        `Demo seed on ${describeTarget(url)}: inserted ${Object.entries(result)
          .map(([k, n]) => `${k}=${n}`)
          .join(', ')}.`,
      );
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    await client.end();
  }
}

runScript(async () => {
  try {
    await main();
  } catch (err) {
    if (err instanceof PromptCancelled) throw new DbConfigError(err.message);
    throw err;
  }
});
