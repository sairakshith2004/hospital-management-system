import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { connectTest, inRollback } from '../test-db.js';
import { seedDemoData } from './demo-data.js';
import { ResetPasswordError, resetPasswordByUsername } from './reset-password.js';

// Runs as hms_app inside a rolled-back transaction: hms_test keeps nothing.
let app!: pg.Client;
beforeAll(async () => {
  app = await connectTest('app');
});
afterAll(async () => {
  await app?.end();
});
const OLD = '$argon2id$v=19$m=19456,t=2,p=1$synthetic-test-salt$synthetic-old-hash';
const NEW = '$argon2id$v=19$m=19456,t=2,p=1$synthetic-test-salt$synthetic-new-hash';

it('sets the new hash, clears the lockout, ends sessions and audits without the hash', () =>
  inRollback(app, async () => {
    await seedDemoData(app, { passwordHash: OLD });
    const { rows } = await app.query<{ id: string }>(
      "UPDATE users SET failed_logins = 5, locked_until = now() + interval '1 hour' WHERE username = 'adm1' RETURNING id",
    );
    const id = rows[0]!.id;
    await app.query(
      "INSERT INTO sessions (sid, sess, expire) VALUES ('zz-reset-test', $1, now() + interval '1 hour')",
      [JSON.stringify({ userId: id })],
    );

    const result = await resetPasswordByUsername(app, { username: 'adm1', passwordHash: NEW });
    expect(result).toEqual({ userId: id, sessionsEnded: 1 });

    const { rows: u } = await app.query(
      'SELECT password_hash, failed_logins, locked_until FROM users WHERE id = $1',
      [id],
    );
    expect(u[0]).toEqual({ password_hash: NEW, failed_logins: 0, locked_until: null });
    const { rows: others } = await app.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM users WHERE username <> 'adm1' AND password_hash = $1",
      [OLD],
    );
    expect(others[0]!.n).toBeGreaterThan(0); // nobody else changed

    const { rows: audit } = await app.query<{ reason: string; changes: unknown }>(
      "SELECT reason, changes FROM audit_logs WHERE action = 'user.password_reset' AND entity_id = $1",
      [id],
    );
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain('argon2');
  }));

it('refuses an unknown or invalid username without changing anything', () =>
  inRollback(app, async () => {
    await expect(
      resetPasswordByUsername(app, { username: 'zz_nobody', passwordHash: NEW }),
    ).rejects.toThrow(ResetPasswordError);
    await expect(
      resetPasswordByUsername(app, { username: 'Bad Name', passwordHash: NEW }),
    ).rejects.toThrow(/not a valid username/);
  }));
