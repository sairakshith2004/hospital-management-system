/**
 * Helpers for *.db.test.ts. Connections go through the db-env guards, so they can
 * only reach hms_test, as hms_app or hms_owner. Each test runs in a transaction
 * that is always rolled back.
 */
import pg from 'pg';
import { expect } from 'vitest';
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
