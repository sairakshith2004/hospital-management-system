/**
 * Database connection settings for the db:* scripts, with target guards.
 *
 * Each URL must connect as the expected role to the expected database, so a
 * mistyped .env can never point migrations at the wrong database or run the
 * API as a superuser. Errors name the variable and the rule, never the value.
 */

export const OWNER_ROLE = 'hms_owner';
export const APP_ROLE = 'hms_app';
export const DATABASES = { dev: 'hms_dev', test: 'hms_test' } as const;
export type DbMode = keyof typeof DATABASES;

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

const MIGRATION_VARS: Record<DbMode, string> = {
  dev: 'MIGRATION_DATABASE_URL',
  test: 'TEST_MIGRATION_DATABASE_URL',
};
const APP_VARS: Record<DbMode, string> = { dev: 'DATABASE_URL', test: 'TEST_DATABASE_URL' };

/** Every variable the db:* scripts read, in the order db:env:check reports them. */
export const DB_ENV_VARS = [
  'ADMIN_DATABASE_URL',
  MIGRATION_VARS.dev,
  MIGRATION_VARS.test,
  APP_VARS.dev,
  APP_VARS.test,
] as const;

export class DbConfigError extends Error {
  override name = 'DbConfigError';
}

type Env = Record<string, string | undefined>;

export function parseMode(arg: string | undefined): DbMode {
  if (arg === 'dev' || arg === 'test') return arg;
  throw new DbConfigError('Database mode must be "dev" or "test".');
}

function readUrl(env: Env, name: string): URL {
  const raw = env[name];
  if (!raw) throw new DbConfigError(`${name} is not set.`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DbConfigError(`${name} is not a valid URL.`);
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new DbConfigError(`${name} must be a postgres:// URL.`);
  }
  if (!url.password) throw new DbConfigError(`${name} must include a password.`);
  return url;
}

export function databaseOf(url: URL): string {
  return decodeURIComponent(url.pathname.replace(/^\//, ''));
}

function expectTarget(name: string, url: URL, user: string, database: string): URL {
  if (decodeURIComponent(url.username) !== user || databaseOf(url) !== database) {
    throw new DbConfigError(`${name} must connect as ${user} to ${database}.`);
  }
  return url;
}

const TEST_PORT = '5432';

/**
 * Test URLs must be this machine's PostgreSQL on 5432, with nothing that could
 * redirect them: no port means PGPORT applies, and a ?host= parameter overrides
 * the host in the URL.
 */
function expectLocalTest(name: string, url: URL): void {
  if (!LOCAL_HOSTS.has(url.hostname) || url.port !== TEST_PORT) {
    throw new DbConfigError(`${name} must point at 127.0.0.1:5432 or localhost:5432.`);
  }
  if (url.search !== '') {
    throw new DbConfigError(`${name} must not have query parameters.`);
  }
}

/** Schema-owner URL for migrations and seeds: hms_owner on hms_dev or hms_test. */
export function migrationUrl(mode: DbMode, env: Env = process.env): URL {
  const name = MIGRATION_VARS[mode];
  const url = expectTarget(name, readUrl(env, name), OWNER_ROLE, DATABASES[mode]);
  if (mode === 'test') expectLocalTest(name, url);
  return url;
}

/** Application URL for the API and database tests: hms_app on hms_dev or hms_test. */
export function appUrl(mode: DbMode, env: Env = process.env): URL {
  const name = APP_VARS[mode];
  const url = expectTarget(name, readUrl(env, name), APP_ROLE, DATABASES[mode]);
  if (mode === 'test') expectLocalTest(name, url);
  return url;
}

/** Local superuser URL, used only by db:roles. Must point at this machine. */
export function adminUrl(env: Env = process.env): URL {
  const name = 'ADMIN_DATABASE_URL';
  const url = readUrl(env, name);
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new DbConfigError(`${name} must point at 127.0.0.1 or localhost.`);
  }
  if (databaseOf(url) !== DATABASES.dev) {
    throw new DbConfigError(`${name} must connect to ${DATABASES.dev}.`);
  }
  return url;
}

export type DbRole = 'owner' | 'app';
const ROLES: Record<DbRole, string> = { owner: OWNER_ROLE, app: APP_ROLE };

/** The one query assertConnectedTarget needs; pg.Client satisfies it. */
interface TargetProbe {
  query(text: string): Promise<{ rows: unknown[] }>;
}

/**
 * Asks the connected server which database and role this session really uses, and
 * refuses unless they are exactly the expected ones for `mode` and `role`. The URL
 * guards above only check what the caller configured; this checks what the server
 * reports, against fixed names, not anything taken from the URL. Call it after
 * connecting and before any write. Fails closed: a query error, no row, or any other
 * value refuses. The message never echoes what the server returned.
 */
export async function assertConnectedTarget(
  client: TargetProbe,
  mode: DbMode,
  role: DbRole,
): Promise<void> {
  const expected = { database: DATABASES[mode], user: ROLES[role] };
  const refuse = () =>
    new DbConfigError(
      `Refused: could not confirm the connection is ${expected.user} on ${expected.database}. Nothing was changed.`,
    );
  let row: unknown;
  try {
    ({
      rows: [row],
    } = await client.query('SELECT current_database() AS database, current_user AS "user"'));
  } catch {
    throw refuse();
  }
  const { database, user } = (row ?? {}) as { database?: unknown; user?: unknown };
  if (database !== expected.database || user !== expected.user) throw refuse();
}

/** A printable description of a connection target. Never includes the password. */
export function describeTarget(url: URL): string {
  return `${decodeURIComponent(url.username)}@${url.host}/${databaseOf(url)}`;
}

/** Checks one variable by name, for db:env:check. Returns a reason, never the value. */
export function checkVar(name: (typeof DB_ENV_VARS)[number], env: Env = process.env): string {
  if (!env[name]) return 'missing';
  try {
    if (name === 'ADMIN_DATABASE_URL') adminUrl(env);
    else if (name === MIGRATION_VARS.dev) migrationUrl('dev', env);
    else if (name === MIGRATION_VARS.test) migrationUrl('test', env);
    else if (name === APP_VARS.dev) appUrl('dev', env);
    else appUrl('test', env);
    return 'set';
  } catch (err) {
    return `invalid: ${(err as Error).message}`;
  }
}

/**
 * Runs a db:* script's main function. Configuration errors print their message;
 * anything else prints "Failed: <message>". Either way the exit code becomes 1.
 */
export function runScript(main: () => Promise<void>): void {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(err instanceof DbConfigError ? message : `Failed: ${message}`);
    process.exitCode = 1;
  });
}
