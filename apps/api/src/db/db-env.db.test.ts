/**
 * assertConnectedTarget against a real server: hms_test only, read-only (one SELECT).
 * Shows that a session the URL guards accepted is still refused when the expected
 * database or role differs from what the server reports.
 */
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DbConfigError, assertConnectedTarget } from './db-env.js';
import { connectTest } from './test-db.js';

let owner!: pg.Client;
let app!: pg.Client;
beforeAll(async () => {
  [owner, app] = await Promise.all([connectTest('owner'), connectTest('app')]);
});
afterAll(async () => {
  await Promise.all([owner?.end(), app?.end()]);
});

it('confirms the real session and refuses every other expectation', async () => {
  await expect(assertConnectedTarget(owner, 'test', 'owner')).resolves.toBeUndefined();
  await expect(assertConnectedTarget(app, 'test', 'app')).resolves.toBeUndefined();
  // Connected to hms_test, so a dev expectation must fail, whatever the role.
  await expect(assertConnectedTarget(owner, 'dev', 'owner')).rejects.toThrow(DbConfigError);
  await expect(assertConnectedTarget(app, 'dev', 'app')).rejects.toThrow(DbConfigError);
  // Right database, wrong role.
  await expect(assertConnectedTarget(app, 'test', 'owner')).rejects.toThrow(DbConfigError);
  await expect(assertConnectedTarget(owner, 'test', 'app')).rejects.toThrow(DbConfigError);
});
