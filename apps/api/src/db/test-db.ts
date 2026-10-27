/**
 * Helpers for *.db.test.ts. Connections go through the db-env guards, so they can
 * only reach hms_test, as hms_app or hms_owner. Each test runs in a transaction
 * that is always rolled back.
 */
import type { Express, RequestHandler } from 'express';
import pg from 'pg';
import { expect } from 'vitest';
import { createApp } from '../app.js';
import { createLogger } from '../lib/logger.js';
import { hashPassword } from '../lib/password.js';
import { createSession } from '../middleware/session.js';
import type { EventHub } from '../modules/communication/event-hub.js';
import type { Sfu } from '../modules/communication/sfu.js';
import type { Database, Queryable, TxClient } from './client.js';
import { appUrl, migrationUrl } from './db-env.js';

export async function connectTest(role: 'app' | 'owner'): Promise<pg.Client> {
  const url = role === 'app' ? appUrl('test') : migrationUrl('test');
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  return client;
}

/** Runs `work` in a transaction that is always rolled back, whatever happens. */
export async function inRollback<T>(client: pg.Client, work: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    return await work();
  } finally {
    await client.query('ROLLBACK');
  }
}

/** Expects `sql` to fail with `sqlstate`. A savepoint keeps the transaction usable. */
export async function expectSqlError(
  client: pg.Client,
  sql: string,
  sqlstate: string,
  message?: RegExp,
  params: unknown[] = [],
): Promise<void> {
  await client.query('SAVEPOINT expect_error');
  try {
    await client.query(sql, params);
    throw new Error(`Expected SQLSTATE ${sqlstate}, but the statement succeeded: ${sql}`);
  } catch (err) {
    const { code, message: text } = err as { code?: string; message: string };
    if (code === undefined) throw err;
    expect(code, sql).toBe(sqlstate);
    if (message) expect(text).toMatch(message);
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expect_error');
  }
}

/**
 * A Database for the API that runs everything on one test client, inside the test's
 * own rolled-back transaction. The app's BEGIN / COMMIT / ROLLBACK become savepoints,
 * so nothing the app does can ever commit. Requests must run one at a time.
 */
export function transactionalDb(client: pg.Client): Database {
  let depth = 0;
  const query = <R extends pg.QueryResultRow>(text: string, params?: unknown[]) =>
    client.query<R>(text, params);
  const txClient: TxClient = {
    query: <R extends pg.QueryResultRow>(text: string, params?: unknown[]) => {
      const statement = text.trim().toUpperCase();
      if (statement === 'BEGIN') {
        depth += 1;
        return client.query<R>(`SAVEPOINT app_tx_${depth}`);
      }
      if (statement === 'COMMIT') {
        depth -= 1;
        return client.query<R>(`RELEASE SAVEPOINT app_tx_${depth + 1}`);
      }
      if (statement === 'ROLLBACK') {
        depth -= 1;
        return client.query<R>(`ROLLBACK TO SAVEPOINT app_tx_${depth + 1}`);
      }
      return client.query<R>(text, params);
    },
    release: () => {},
  };
  return { query, connect: async () => txClient };
}

// Synthetic only.
export const TEST_SESSION_SECRET = 'test-session-secret-not-used-anywhere-else-0123456789';
export const TEST_PASSWORD = 'Synthetic-Passw0rd-for-tests';

/** The API wired to the test transaction: real sessions table, no pruning timer. */
export function createTestApp(
  client: pg.Client,
  options: {
    loginLimiter?: RequestHandler;
    events?: EventHub;
    sfu?: Sfu;
  } = {},
): { app: Express; db: Database } {
  const db = transactionalDb(client);
  const session = createSession({
    pool: db as unknown as pg.Pool,
    secret: TEST_SESSION_SECRET,
    production: false,
    logger: createLogger({ level: 'silent' }),
    prune: false,
  });
  const app = createApp({
    db,
    session: session.middleware,
    loginLimiter: options.loginLimiter ?? ((_req, _res, next) => next()),
    events: options.events,
    ...(options.sfu && { sfu: options.sfu }),
  });
  return { app, db };
}

let testUserCounter = 0;
let cachedHash: Promise<string> | undefined;

/** A synthetic active user with the given role codes (none = awaiting assignment). */
export async function createTestUser(
  db: Queryable,
  { roles = [] as string[], username }: { roles?: string[]; username?: string } = {},
): Promise<{ id: string; username: string }> {
  testUserCounter += 1;
  const tag = `${process.pid}_${testUserCounter}`;
  const name = username ?? `zz_user_${tag}`;
  cachedHash ??= hashPassword(TEST_PASSWORD);
  const { rows: dept } = await db.query<{ id: string }>(
    `INSERT INTO departments (code, name) VALUES ($1, $1) RETURNING id`,
    [`ZZ_T${tag}`.toUpperCase().slice(0, 20)],
  );
  const { rows: emp } = await db.query<{ id: string }>(
    `INSERT INTO employees (employee_no, full_name, department_id, designation)
     VALUES ($1, 'Test Person', $2, 'Tester') RETURNING id`,
    [`ZZ-${tag}`, dept[0]!.id],
  );
  const { rows: user } = await db.query<{ id: string }>(
    'INSERT INTO users (employee_id, username, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [emp[0]!.id, name, await cachedHash],
  );
  if (roles.length > 0) {
    await db.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE code = ANY($2::text[])`,
      [user[0]!.id, roles],
    );
  }
  return { id: user[0]!.id, username: name };
}

/** Signs a test user in through the real login route; returns the cookie and CSRF token. */
export async function signIn(
  app: Express,
  username: string,
): Promise<{ cookie: string; csrf: string }> {
  const { default: request } = await import('supertest');
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username, password: TEST_PASSWORD });
  if (res.status !== 200) throw new Error(`test sign-in failed: ${res.status}`);
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = cookies.find((c) => c.startsWith('hms.sid='))?.split(';')[0];
  if (!cookie) throw new Error('test sign-in set no session cookie');
  return { cookie, csrf: (res.body as { csrfToken: string }).csrfToken };
}
