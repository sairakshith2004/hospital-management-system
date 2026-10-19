/**
 * npm run db:bootstrap-admin -- --username <name>
 *
 * Creates the first administrator in hms_dev, as hms_app. The password is typed twice
 * at a hidden prompt: it is never an argument, never read from a pipe, never printed or
 * logged, and only its argon2id hash is stored. Refuses in production and whenever an
 * administrator already exists.
 */
import pg from 'pg';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, hashPassword } from '../../lib/password.js';
import { DbConfigError, appUrl, describeTarget, runScript } from '../db-env.js';
import { BootstrapError, USERNAME_PATTERN, bootstrapAdmin } from './bootstrap-admin.js';
import { PromptCancelled, promptHidden } from './prompt.js';

function parseUsername(argv: string[]): string {
  const i = argv.indexOf('--username');
  const username = i >= 0 ? argv[i + 1] : undefined;
  if (!username || !USERNAME_PATTERN.test(username)) {
    throw new DbConfigError(
      'Usage: npm run db:bootstrap-admin -- --username <name> (3–50 characters: a-z, 0-9, . _ -, starting with a letter)',
    );
  }
  return username;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new DbConfigError('Refused: db:bootstrap-admin is for development only.');
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new DbConfigError(
      'Refused: run this in an interactive terminal. The password is never read from a pipe or a file.',
    );
  }
  const username = parseUsername(process.argv.slice(2));
  const url = appUrl('dev');

  const password = await promptHidden(`Password for ${username} (input hidden): `);
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
    application_name: 'hms-bootstrap-admin',
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    try {
      await bootstrapAdmin(client, { username, passwordHash });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    await client.end();
  }
  console.log(`Created administrator "${username}" in ${describeTarget(url)}.`);
}

runScript(async () => {
  try {
    await main();
  } catch (err) {
    // Expected refusals print their own message, without the "Failed:" prefix.
    if (err instanceof BootstrapError || err instanceof PromptCancelled) {
      throw new DbConfigError(err.message);
    }
    throw err;
  }
});
