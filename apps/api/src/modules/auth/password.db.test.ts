/**
 * Staff managing their own password, through the real API on hms_test (each test rolled
 * back): first sign-in with an HR-chosen password, change while signed in, and forgot
 * password by an emailed one-time link. A fake mailer records what would be sent.
 */
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connectTest,
  createTestApp,
  createTestUser,
  expectSqlError,
  inRollback,
  signIn,
} from '../../db/test-db.js';
import type { Mail } from '../../lib/mailer.js';

let client!: pg.Client;
beforeAll(async () => {
  client = await connectTest('app');
});
afterAll(async () => {
  await client?.end();
});
const tx = (work: () => Promise<void>) => () => inRollback(client, work);

const HR_SET = 'Hr-chosen-Passw0rd';
const MINE = 'My-own-new-Passw0rd';
const LATER = 'Another-new-Passw0rd';

async function setup() {
  const mail: Mail[] = [];
  const { app, db } = createTestApp(client, {
    mailer: {
      send: async (m) => {
        mail.push(m);
      },
    },
  });
  const login = (username: string, password: string) =>
    request(app).post('/api/auth/login').send({ username, password });
  const session = async (username: string, password: string) => {
    const res = await login(username, password);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const cookie = ([] as string[])
      .concat(res.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('hms.sid='))!
      .split(';')[0]!;
    const csrf = res.body.csrfToken as string;
    return {
      me: res.body.user,
      get: (path: string) => request(app).get(path).set('Cookie', cookie),
      post: (path: string, body: object = {}) =>
        request(app).post(path).set('Cookie', cookie).set('X-CSRF-Token', csrf).send(body),
    };
  };
  const hrUser = await createTestUser(db, { roles: ['HR'] });
  const s = await signIn(app, hrUser.username);
  const hr = {
    post: (path: string, body: object) =>
      request(app).post(path).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).send(body),
  };
  const dept = (
    await client.query<{ id: string }>(
      `INSERT INTO departments (code, name) VALUES ('ZZ_PWD', 'Zz Pwd') RETURNING id`,
    )
  ).rows[0]!.id;
  /** HR adds a new nurse with a login and (optionally) a work email. */
  const hire = async (tag: string, email?: string) => {
    const res = await hr.post('/api/admin/staff', {
      fullName: `Zz Nurse ${tag}`,
      employeeNo: `ZZ-PWD-${tag.toUpperCase()}`,
      departmentId: dept,
      designation: 'Staff nurse',
      ...(email && { email }),
      username: `zz_pwd_${tag}`,
      password: HR_SET,
      reason: 'Zz onboarding',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return `zz_pwd_${tag}`;
  };
  const forgot = (identifier: string) =>
    request(app).post('/api/auth/password/forgot').send({ identifier });
  const reset = (token: string, password: string) =>
    request(app).post('/api/auth/password/reset').send({ token, password });
  const tokenIn = (m: Mail) => /token=([A-Za-z0-9_-]+)/.exec(m.text)![1]!;
  return { app, db, mail, login, session, hr, hire, forgot, reset, tokenIn };
}

const audit = async (action: string) =>
  (
    await client.query(
      'SELECT entity_id FROM audit_logs WHERE action = $1 AND occurred_at = now()',
      [action],
    )
  ).rows;

describe('choosing your own password', () => {
  it(
    'makes someone with an HR-chosen password pick their own before anything else',
    tx(async () => {
      const f = await setup();
      const username = await f.hire('a');
      const nurse = await f.session(username, HR_SET);
      expect(nurse.me.mustChangePassword).toBe(true);
      // Everything else is refused until they choose their own.
      const blocked = await nurse.get('/api/comm/summary');
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
      expect((await nurse.get('/api/auth/me')).status).toBe(200);

      const wrong = await nurse.post('/api/auth/password/change', {
        currentPassword: 'not-the-password',
        newPassword: MINE,
      });
      expect(wrong.body.error.code).toBe('WRONG_PASSWORD');
      const same = await nurse.post('/api/auth/password/change', {
        currentPassword: HR_SET,
        newPassword: HR_SET,
      });
      expect(same.status).toBe(422);

      // A second, older session is signed out when the password changes; this one stays.
      const other = await f.session(username, HR_SET);
      const changed = await nurse.post('/api/auth/password/change', {
        currentPassword: HR_SET,
        newPassword: MINE,
      });
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      expect((await nurse.get('/api/auth/me')).body.user.mustChangePassword).toBe(false);
      // No longer blocked for the password (a new account still waits for its role).
      expect((await nurse.get('/api/comm/summary')).body.error?.code).not.toBe(
        'PASSWORD_CHANGE_REQUIRED',
      );
      expect((await other.get('/api/auth/me')).status).toBe(401);
      expect((await f.login(username, HR_SET)).status).toBe(401);
      expect((await f.login(username, MINE)).status).toBe(200);
      expect(await audit('user.password_changed')).toHaveLength(1);
    }),
  );
});

describe('forgot password', () => {
  it(
    'emails a one-time link that sets a new password and signs out everywhere',
    tx(async () => {
      const f = await setup();
      const username = await f.hire('b', 'Zz.Nurse.B@Hospital.Example');
      const before = await f.session(username, HR_SET);

      // By work email (any case) or by username: the same answer.
      const res = await f.forgot('zz.nurse.b@hospital.example');
      expect(res.status).toBe(202);
      expect(f.mail).toHaveLength(1);
      expect(f.mail[0]!.to).toBe('zz.nurse.b@hospital.example');
      expect(f.mail[0]!.text).toContain('http://127.0.0.1:5173/reset-password?token=');
      const first = f.tokenIn(f.mail[0]!);

      // Asking again replaces the first link.
      await f.forgot(username);
      const second = f.tokenIn(f.mail[1]!);
      expect((await f.reset(first, MINE)).body.error.code).toBe('INVALID_RESET_LINK');

      // Only a fingerprint of the link is stored, never the link itself.
      const stored = await client.query(
        'SELECT token_hash FROM password_reset_tokens WHERE token_hash = $1',
        [second],
      );
      expect(stored.rowCount).toBe(0);

      expect((await f.reset(second, MINE)).status).toBe(200);
      expect((await before.get('/api/auth/me')).status).toBe(401);
      expect((await f.login(username, HR_SET)).status).toBe(401);
      const after = await f.login(username, MINE);
      expect(after.status).toBe(200);
      // They chose this password themselves, so no forced change.
      expect(after.body.user.mustChangePassword).toBe(false);
      // A used link never works again.
      expect((await f.reset(second, LATER)).body.error.code).toBe('INVALID_RESET_LINK');
      expect(await audit('user.password_reset_by_link')).toHaveLength(1);
    }),
  );

  it(
    'never reveals whether an account exists, and sends nothing it should not',
    tx(async () => {
      const f = await setup();
      const noEmail = await f.hire('c');
      const disabled = await f.hire('d', 'zz.d@hospital.example');
      await client.query(`UPDATE users SET status = 'disabled' WHERE username = $1`, [disabled]);
      for (const who of ['zz_nobody_here', 'nobody@hospital.example', noEmail, disabled]) {
        const res = await f.forgot(who);
        expect(res.status).toBe(202);
        expect(res.body).toEqual({ ok: true });
      }
      expect(f.mail).toHaveLength(0);

      // At most 3 links per account per hour.
      const busy = await f.hire('e', 'zz.e@hospital.example');
      for (let i = 0; i < 5; i += 1) expect((await f.forgot(busy)).status).toBe(202);
      expect(f.mail).toHaveLength(3);
    }),
  );

  it(
    'refuses expired or made-up links, and the database keeps used links unchangeable',
    tx(async () => {
      const f = await setup();
      const username = await f.hire('f', 'zz.f@hospital.example');
      await f.forgot(username);
      const token = f.tokenIn(f.mail[0]!);
      // Made up, malformed, and expired links all fail the same way.
      expect((await f.reset('A'.repeat(43), MINE)).body.error.code).toBe('INVALID_RESET_LINK');
      expect((await f.reset('short', MINE)).status).toBe(422);
      const userId = (
        await client.query<{ id: string }>('SELECT id FROM users WHERE username = $1', [username])
      ).rows[0]!.id;
      await client.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, created_at, expires_at)
         VALUES ($1, encode(sha256('zz-expired-link-zz-expired-link-zz-expired'::bytea), 'hex'),
                 now() - interval '2 hours', now() - interval '90 minutes')`,
        [userId],
      );
      expect(
        (await f.reset('zz-expired-link-zz-expired-link-zz-expired', MINE)).body.error.code,
      ).toBe('INVALID_RESET_LINK');

      expect((await f.reset(token, MINE)).status).toBe(200);
      await expectSqlError(
        client,
        `UPDATE password_reset_tokens SET used_at = NULL WHERE user_id = '${userId}'`,
        '23514',
      );
    }),
  );

  it(
    'makes an administrator-reset password a temporary one too',
    tx(async () => {
      const f = await setup();
      const username = await f.hire('g');
      const nurse = await f.session(username, HR_SET);
      await nurse.post('/api/auth/password/change', { currentPassword: HR_SET, newPassword: MINE });
      const adm = await createTestUser(f.db, { roles: ['ADM'] });
      const s = await signIn(f.app, adm.username);
      const userId = nurse.me.id as string;
      const reset = await request(f.app)
        .post(`/api/admin/users/${userId}/password`)
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', s.csrf)
        .send({ password: LATER, reason: 'Zz forgot' });
      expect(reset.status, JSON.stringify(reset.body)).toBe(200);
      expect((await f.login(username, LATER)).body.user.mustChangePassword).toBe(true);
    }),
  );
});
