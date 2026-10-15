/**
 * npm run db:roles — local development only.
 *
 * Creates (or updates) the hms_owner and hms_app login roles, removes PUBLIC's
 * default CONNECT/TEMPORARY on hms_dev and hms_test, and gives the two roles
 * explicit connect/schema grants there. Runs only the statements in roles-sql.ts:
 * it never drops, truncates or deletes anything, never creates a database, and
 * revokes nothing except that PUBLIC default. Passwords come from .env and never
 * appear in SQL or output.
 */
import pg from 'pg';
import {
  APP_ROLE,
  DbConfigError,
  OWNER_ROLE,
  adminUrl,
  appUrl,
  describeTarget,
  migrationUrl,
  runScript,
} from './db-env.js';
import {
  MANAGED_DATABASES,
  PASSWORD_SETTING,
  SCHEMA_GRANTS_SQL,
  databaseAccessSql,
  ensureRoleSql,
} from './roles-sql.js';

function sameCredentials(a: URL, b: URL): boolean {
  return a.username === b.username && a.password === b.password && a.host === b.host;
}

async function connect(url: URL, database?: string): Promise<pg.Client> {
  const target = new URL(url.href);
  if (database) target.pathname = `/${database}`;
  const client = new pg.Client({ connectionString: target.href });
  await client.connect();
  return client;
}

/** Keeps this session's statements out of the server log. Needs a superuser. */
async function quietLogging(client: pg.Client): Promise<void> {
  await client.query("SET log_statement = 'none'");
}

async function inTransaction(client: pg.Client, work: () => Promise<void>): Promise<void> {
  await client.query('BEGIN');
  try {
    await work();
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new DbConfigError('db:roles is for local development only.');
  }
  const admin = adminUrl();
  const owner = migrationUrl('dev');
  const app = appUrl('dev');
  // One PostgreSQL role serves both databases, so dev and test must share credentials.
  if (!sameCredentials(owner, migrationUrl('test'))) {
    throw new DbConfigError(
      'MIGRATION_DATABASE_URL and TEST_MIGRATION_DATABASE_URL must use the same hms_owner password and host.',
    );
  }
  if (!sameCredentials(app, appUrl('test'))) {
    throw new DbConfigError(
      'DATABASE_URL and TEST_DATABASE_URL must use the same hms_app password and host.',
    );
  }

  const client = await connect(admin);
  try {
    const su = await client.query<{ rolsuper: boolean }>(
      'SELECT rolsuper FROM pg_roles WHERE rolname = current_user',
    );
    if (!su.rows[0]?.rolsuper) {
      throw new DbConfigError('ADMIN_DATABASE_URL must connect as a superuser.');
    }
    // Only after the superuser check, so a wrong URL gets the clear message above.
    await quietLogging(client);
    const found = await client.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datname = ANY($1)',
      [MANAGED_DATABASES],
    );
    const present = new Set(found.rows.map((r) => r.datname));
    for (const db of MANAGED_DATABASES) {
      if (!present.has(db)) {
        throw new DbConfigError(`Database ${db} does not exist. db:roles never creates databases.`);
      }
    }

    await inTransaction(client, async () => {
      for (const [role, url] of [
        [OWNER_ROLE, owner],
        [APP_ROLE, app],
      ] as const) {
        await client.query('SELECT set_config($1, $2, true)', [
          PASSWORD_SETTING,
          decodeURIComponent(url.password),
        ]);
        await client.query(ensureRoleSql(role));
      }
      for (const db of MANAGED_DATABASES) {
        for (const sql of databaseAccessSql(db)) await client.query(sql);
      }
    });
  } finally {
    await client.end();
  }

  for (const db of MANAGED_DATABASES) {
    const dbClient = await connect(admin, db);
    try {
      await quietLogging(dbClient);
      await inTransaction(dbClient, async () => {
        for (const sql of SCHEMA_GRANTS_SQL) await dbClient.query(sql);
      });
    } finally {
      await dbClient.end();
    }
  }

  console.log(
    `Roles ready: ${OWNER_ROLE}, ${APP_ROLE}. Grants applied on ${MANAGED_DATABASES.join(' and ')} via ${describeTarget(admin)}.`,
  );
}

runScript(main);
