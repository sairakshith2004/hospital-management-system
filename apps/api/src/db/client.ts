/**
 * The API's database access: one pg pool connecting as hms_app (never the owner or a
 * superuser), plus a transaction helper. Repositories take a `Queryable`, so the same
 * code runs on the pool, inside a transaction, or inside a rolled-back test transaction.
 */
import pg from 'pg';
import type { Logger } from 'pino';

export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<pg.QueryResult<R>>;
}

export interface TxClient extends Queryable {
  release(err?: Error | boolean): void;
}

export interface Database extends Queryable {
  connect(): Promise<TxClient>;
}

export function createPool(connectionString: string, logger: Logger): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'hospitalos-api',
  });
  // An idle client lost its connection. Logged through the error serializer, which
  // never includes connection strings; the pool replaces the client on next use.
  pool.on('error', (err) => logger.error({ err }, 'database pool error'));
  return pool;
}

/** Refuses to run the API as a superuser: hms_app is the only intended role. */
export async function assertNotSuperuser(db: Queryable): Promise<void> {
  const { rows } = await db.query<{ superuser: boolean }>(
    'SELECT rolsuper AS superuser FROM pg_roles WHERE rolname = current_user',
  );
  if (rows[0]?.superuser !== false) {
    throw new Error('DATABASE_URL must not connect as a superuser; use hms_app.');
  }
}

/** Runs `work` in one transaction: COMMIT if it resolves, ROLLBACK if it throws. */
export async function withTransaction<T>(
  db: Database,
  work: (tx: Queryable) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    try {
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    client.release();
  }
}
