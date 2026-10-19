/**
 * npm run db:reset-password -- --username <name>
 *
 * Sets a new password for one existing account in hms_dev, as hms_app. The password is
 * typed twice at a hidden prompt: it is never an argument, never read from a pipe, never
 * printed or logged, and only its argon2id hash is stored. Refuses in production, and
 * unless the server confirms the session is hms_app on hms_dev. Ends that account's
 * sessions and writes a user.password_reset audit row.
 */
import pg from 'pg';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, hashPassword } from '../../lib/password.js';
import {
  DbConfigError,
  appUrl,
  assertConnectedTarget,
  describeTarget,
  runScript,
} from '../db-env.js';
import { USERNAME_PATTERN } from './bootstrap-admin.js';
import { PromptCancelled, promptHidden } from './prompt.js';
import { ResetPasswordError, resetPasswordByUsername } from './reset-password.js';

function parseUsername(argv: string[]): string {
  const i = argv.indexOf('--username');
  const username = i >= 0 ? argv[i + 1] : undefined;
  if (!username || !USERNAME_PATTERN.test(username)) {
    throw new DbConfigError('Usage: npm run db:reset-password -- --username <name>');
  }
  return username;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new DbConfigError('Refused: db:reset-password is for development only.');
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new DbConfigError(
      'Refused: run this in an interactive terminal. The password is never read from a pipe or a file.',
    );
  }
  const username = parseUsername(process.argv.slice(2));
  const url = appUrl('dev');

  const password = await promptHidden(`New password for ${username} (input hidden): `);
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new DbConfigError(
      `Refused: the password must be ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters.`,
    );
  }
  if ((await promptHidden('Repeat the password: ')) !== password) {
    throw new DbConfigError('Refused: the two passwords differ. Nothing was changed.');
  }
  const passwordHash = await hashPassword(password);

  const client = new pg.Client({
    connectionString: url.href,
    application_name: 'hms-reset-password',
  });
  await client.connect();
  let sessionsEnded: number;
  try {
    await assertConnectedTarget(client, 'dev', 'app');
    await client.query('BEGIN');
    try {
      ({ sessionsEnded } = await resetPasswordByUsername(client, { username, passwordHash }));
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    await client.end();
  }
  console.log(
    `Password for "${username}" changed in ${describeTarget(url)}; ${sessionsEnded} session(s) ended.`,
  );
}

runScript(async () => {
  try {
    await main();
  } catch (err) {
    // Expected refusals print their own message, without the "Failed:" prefix.
    if (err instanceof ResetPasswordError || err instanceof PromptCancelled) {
      throw new DbConfigError(err.message);
    }
    throw err;
  }
});
