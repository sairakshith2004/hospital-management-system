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

/** Reads one line from the terminal without echoing it. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    let value = '';
    const finish = (err?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stdout.write('\n');
      if (err) reject(err);
      else resolve(value);
    };
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return finish();
        if (ch === '\u0003') return finish(new BootstrapError('Cancelled.')); // Ctrl-C
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

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
    if (err instanceof BootstrapError) throw new DbConfigError(err.message);
    throw err;
  }
});
