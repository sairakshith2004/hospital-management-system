import express from 'express';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TEST_PASSWORD,
  TEST_SESSION_SECRET,
  connectTest,
  createTestApp,
  createTestUser,
  inRollback,
  transactionalDb,
} from '../../db/test-db.js';
import { createLogger } from '../../lib/logger.js';
import { loadUser, requirePermission } from '../../middleware/auth.js';
import { csrfProtection } from '../../middleware/csrf.js';
import { errorHandler, notFound } from '../../middleware/error-handler.js';
import { createLoginLimiter } from '../../middleware/rate-limit.js';
import { requestId } from '../../middleware/request-id.js';
import { createSession } from '../../middleware/session.js';
import { authRoutes } from './auth.routes.js';

let client!: pg.Client;
beforeAll(async () => {
  client = await connectTest('app');
});
afterAll(async () => {
  await client?.end();
});

const tx = (work: () => Promise<void>) => () => inRollback(client, work);

function cookieOf(res: request.Response): string {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = cookies.find((c) => c.startsWith('hms.sid='));
  if (!cookie) throw new Error('no session cookie set');
  return cookie;
}
/** The session ID inside a signed cookie value: s:<sid>.<signature>. */
function sidOf(cookie: string): string {
  const value = decodeURIComponent(cookie.split(';')[0]!.slice('hms.sid='.length));
  return value.slice(2, value.lastIndexOf('.'));
}
const pair = (cookie: string) => cookie.split(';')[0]!;

async function login(app: express.Express, username: string, password = TEST_PASSWORD) {
  return request(app).post('/api/auth/login').send({ username, password });
}

async function sessionRow(sid: string) {
  const { rows } = await client.query('SELECT sess FROM sessions WHERE sid = $1', [sid]);
  return rows[0] as { sess: Record<string, unknown> } | undefined;
}

async function auditRows(action: string) {
  const { rows } = await client.query<{
    actor_type: string;
    actor_user_id: string | null;
    entity_id: string | null;
    reason: string | null;
  }>(
    `SELECT actor_type, actor_user_id, entity_id, reason FROM audit_logs
     WHERE action = $1 AND occurred_at = now() ORDER BY id`,
    [action],
  );
  return rows;
}

describe('POST /api/auth/login', () => {
  it(
    'signs in: 200, user summary, CSRF token, httpOnly SameSite=Lax cookie, session row, audit',
    tx(async () => {
      const { app, db } = createTestApp(client);
      const user = await createTestUser(db, { roles: ['REC'] });
      await client.query('UPDATE users SET failed_logins = 3 WHERE id = $1', [user.id]);

      const res = await login(app, user.username.toUpperCase()); // usernames are case-insensitive
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({
        id: user.id,
        username: user.username,
        fullName: 'Test Person',
        roles: ['REC'],
      });
      expect(res.body.user.permissions).toContain('appointment:book');
      expect(res.body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const cookie = cookieOf(res);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Lax/);
      expect(cookie).toMatch(/Path=\//);
      expect(cookie).not.toMatch(/Secure/); // development; production adds Secure and __Host-

      const row = await sessionRow(sidOf(cookie));
      expect(row?.sess).toMatchObject({ userId: user.id, csrfToken: res.body.csrfToken });
      const { rows } = await client.query('SELECT failed_logins FROM users WHERE id = $1', [
        user.id,
      ]);
      expect(rows[0].failed_logins).toBe(0);
      expect(await auditRows('auth.login_succeeded')).toEqual([
        { actor_type: 'user', actor_user_id: user.id, entity_id: user.id, reason: null },
      ]);
    }),
  );

  it(
    'answers a wrong password and an unknown username identically, and audits the real reason',
    tx(async () => {
      const { app, db } = createTestApp(client);
      const user = await createTestUser(db);
      const wrong = await login(app, user.username, 'not-the-password');
      const unknown = await login(app, 'zz_nobody_typed_this', TEST_PASSWORD);

      for (const res of [wrong, unknown]) {
        expect(res.status).toBe(401);
        expect(res.headers['set-cookie']).toBeUndefined();
        expect(res.body).toEqual({
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid username or password',
            requestId: res.headers['x-request-id'],
          },
        });
      }
      const { rows } = await client.query('SELECT failed_logins FROM users WHERE id = $1', [
        user.id,
      ]);
      expect(rows[0].failed_logins).toBe(1);
      expect(await auditRows('auth.login_failed')).toEqual([
        { actor_type: 'system', actor_user_id: null, entity_id: user.id, reason: 'bad_password' },
        { actor_type: 'system', actor_user_id: null, entity_id: null, reason: 'unknown_user' },
      ]);
      const leaked = await client.query(
        "SELECT count(*)::int AS n FROM audit_logs WHERE audit_logs::text LIKE '%zz_nobody_typed_this%'",
      );
      expect(leaked.rows[0].n).toBe(0);
    }),
  );

  it(
    'locks the account for 15 minutes after five failures (SE-4), then unlocks',
    tx(async () => {
      const { app, db } = createTestApp(client);
      const user = await createTestUser(db);
      for (let i = 0; i < 5; i += 1) {
        expect((await login(app, user.username, `wrong-${i}`)).status).toBe(401);
      }
      const { rows } = await client.query<{ minutes: number; failed_logins: number }>(
        `SELECT round(extract(epoch FROM locked_until - now()) / 60)::int AS minutes, failed_logins
         FROM users WHERE id = $1`,
        [user.id],
      );
      expect(rows[0]).toEqual({ minutes: 15, failed_logins: 0 });
      expect(await auditRows('auth.locked')).toHaveLength(1);

      const whileLocked = await login(app, user.username);
      expect(whileLocked.status).toBe(401);
      expect(whileLocked.body.error.code).toBe('INVALID_CREDENTIALS');
      expect((await auditRows('auth.login_failed')).at(-1)?.reason).toBe('locked');

      await client.query(
        "UPDATE users SET locked_until = now() - interval '1 second' WHERE id = $1",
        [user.id],
      );
      expect((await login(app, user.username)).status).toBe(200);
      const after = await client.query('SELECT locked_until FROM users WHERE id = $1', [user.id]);
      expect(after.rows[0].locked_until).toBeNull();
    }),
  );

  it(
    'refuses a disabled account with the same 401',
    tx(async () => {
      const { app, db } = createTestApp(client);
      const user = await createTestUser(db);
      await client.query("UPDATE users SET status = 'disabled' WHERE id = $1", [user.id]);
      const res = await login(app, user.username);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      expect((await auditRows('auth.login_failed'))[0]?.reason).toBe('inactive');
    }),
  );

  it(
    'requires a JSON body (415) and rejects unexpected fields (422) without echoing values',
    tx(async () => {
      const { app } = createTestApp(client);
      const form = await request(app)
        .post('/api/auth/login')
        .type('form')
        .send({ username: 'a', password: 'b' });
      expect(form.status).toBe(415);
      expect(form.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');

      const extra = await request(app)
        .post('/api/auth/login')
        .send({ username: 'a', password: 'secret-value-xyz', admin: true });
      expect(extra.status).toBe(422);
      expect(JSON.stringify(extra.body)).not.toContain('secret-value-xyz');
    }),
  );

  it(
    'issues a new session ID at every login, and the old ID stops working (fixation)',
    tx(async () => {
      const { app, db } = createTestApp(client);
      const user = await createTestUser(db);
      const first = cookieOf(await login(app, user.username));
      const second = cookieOf(
        await request(app)
          .post('/api/auth/login')
          .set('Cookie', pair(first))
          .send({ username: user.username, password: TEST_PASSWORD }),
      );
      expect(sidOf(second)).not.toBe(sidOf(first));
      expect(await sessionRow(sidOf(first))).toBeUndefined();
      expect((await request(app).get('/api/auth/me').set('Cookie', pair(first))).status).toBe(401);
      expect((await request(app).get('/api/auth/me').set('Cookie', pair(second))).status).toBe(200);
    }),
  );
});

describe('GET /api/auth/me and session lifetime', () => {
  it(
    'returns 401 UNAUTHENTICATED without a session (SE-2)',
    tx(async () => {
      const { app } = createTestApp(client);
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }),
  );

  it(
    'returns the user and the same CSRF token while signed in',
    tx(async () => {
      const { app, db } = createTestApp(client);
      const user = await createTestUser(db, { roles: ['DOC'] });
      const signIn = await login(app, user.username);
      const me = await request(app)
        .get('/api/auth/me')
        .set('Cookie', pair(cookieOf(signIn)));
      expect(me.status).toBe(200);
      expect(me.body).toEqual(signIn.body);
      // Both carry the CSRF token: the browser must not store or revalidate them.
      for (const res of [signIn, me]) {
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.headers.etag).toBeUndefined();
      }
    }),
  );

  it(
    'rejects a session past its 30-minute idle expiry',
    tx(async () => {
      const { app, db } = createTestApp(client);
      const user = await createTestUser(db);
      const cookie = cookieOf(await login(app, user.username));
      await client.query(
        "UPDATE sessions SET expire = now() - interval '1 second' WHERE sid = $1",
        [sidOf(cookie)],
      );
      expect((await request(app).get('/api/auth/me').set('Cookie', pair(cookie))).status).toBe(401);
    }),
  );

  it(
    'ends a session older than 12 hours even while it is still active, and deletes it',
    tx(async () => {
      const { app, db } = createTestApp(client);
      const user = await createTestUser(db);
      const cookie = cookieOf(await login(app, user.username));
      const thirteenHoursAgo = Date.now() - 13 * 60 * 60 * 1000;
      await client.query(
        `UPDATE sessions SET sess = jsonb_set(sess, '{createdAt}', to_jsonb($2::bigint))
         WHERE sid = $1`,
        [sidOf(cookie), thirteenHoursAgo],
      );
      expect((await request(app).get('/api/auth/me').set('Cookie', pair(cookie))).status).toBe(401);
      expect(await sessionRow(sidOf(cookie))).toBeUndefined();
    }),
  );

  it(
    "rejects a deactivated user's existing session on the next request (SE-6)",
    tx(async () => {
      const { app, db } = createTestApp(client);
      const user = await createTestUser(db);
      const cookie = cookieOf(await login(app, user.username));
      await client.query("UPDATE users SET status = 'disabled' WHERE id = $1", [user.id]);
      expect((await request(app).get('/api/auth/me').set('Cookie', pair(cookie))).status).toBe(401);
      expect(await sessionRow(sidOf(cookie))).toBeUndefined();
    }),
  );
});

describe('POST /api/auth/logout', () => {
  it(
    'requires the CSRF token (SE-3): missing or from another session gives 403',
    tx(async () => {
      const { app, db } = createTestApp(client);
      const a = await createTestUser(db);
      const b = await createTestUser(db);
      const signInA = await login(app, a.username);
      const signInB = await login(app, b.username);
      const cookieA = pair(cookieOf(signInA));

      const missing = await request(app).post('/api/auth/logout').set('Cookie', cookieA);
      expect(missing.status).toBe(403);
      expect(missing.body.error.code).toBe('CSRF_INVALID');
      const foreign = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', cookieA)
        .set('X-CSRF-Token', signInB.body.csrfToken);
      expect(foreign.status).toBe(403);
      expect(await sessionRow(sidOf(cookieA))).toBeDefined();
    }),
  );

  it(
    'with the token: 204, row deleted, cookie cleared, audited, old cookie rejected',
    tx(async () => {
      const { app, db } = createTestApp(client);
      const user = await createTestUser(db);
      const signIn = await login(app, user.username);
      const cookie = pair(cookieOf(signIn));
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', cookie)
        .set('X-CSRF-Token', signIn.body.csrfToken);
      expect(res.status).toBe(204);
      expect(cookieOf(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(await sessionRow(sidOf(cookie))).toBeUndefined();
      expect(await auditRows('auth.logout')).toEqual([
        { actor_type: 'user', actor_user_id: user.id, entity_id: user.id, reason: null },
      ]);
      expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
    }),
  );

  it(
    'returns 401 without a session',
    tx(async () => {
      const { app } = createTestApp(client);
      expect((await request(app).post('/api/auth/logout')).status).toBe(401);
    }),
  );
});

describe('requirePermission', () => {
  /** Auth routes plus one route guarded by audit:read, on the test transaction. */
  function guardedApp() {
    const db = transactionalDb(client);
    const session = createSession({
      pool: db as unknown as pg.Pool,
      secret: TEST_SESSION_SECRET,
      production: false,
      logger: createLogger({ level: 'silent' }),
      prune: false,
    });
    const app = express();
    app.use(requestId, express.json(), session.middleware, loadUser(db), csrfProtection);
    const api = express.Router();
    api.use('/auth', authRoutes({ db, loginLimiter: (_q, _s, n) => n(), production: false }));
    api.get('/guarded', requirePermission(db, 'audit:read'), (_req, res) => {
      res.json({ ok: true });
    });
    app.use('/api', api, notFound);
    app.use(errorHandler(createLogger({ level: 'silent' })));
    return { app, db };
  }

  it(
    'allows a role holding the permission, refuses others with an audited 403, and applies role changes on the next request (AD-8)',
    tx(async () => {
      const { app, db } = guardedApp();
      const admin = await createTestUser(db, { roles: ['ADM'] });
      const reception = await createTestUser(db, { roles: ['REC'] });
      const newcomer = await createTestUser(db);

      const as = async (username: string) => pair(cookieOf(await login(app, username)));
      expect(
        (
          await request(app)
            .get('/api/guarded')
            .set('Cookie', await as(admin.username))
        ).status,
      ).toBe(200);

      const denied = await request(app)
        .get('/api/guarded')
        .set('Cookie', await as(reception.username));
      expect(denied.status).toBe(403);
      expect(denied.body.error).toMatchObject({ code: 'FORBIDDEN' });
      const { rows } = await client.query(
        `SELECT actor_user_id, entity_type, entity_id, changes FROM audit_logs
         WHERE action = 'access.denied' AND occurred_at = now()`,
      );
      expect(rows).toEqual([
        {
          actor_user_id: reception.id,
          entity_type: 'route',
          entity_id: 'GET /api/guarded',
          changes: { permission: 'audit:read' },
        },
      ]);

      const newcomerCookie = await as(newcomer.username);
      expect((await request(app).get('/api/guarded').set('Cookie', newcomerCookie)).status).toBe(
        403,
      );
      await client.query(
        "INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'SA'",
        [newcomer.id],
      );
      expect((await request(app).get('/api/guarded').set('Cookie', newcomerCookie)).status).toBe(
        200,
      );
      expect((await request(app).get('/api/guarded')).status).toBe(401);
    }),
  );
});

describe('login rate limit', () => {
  it(
    'answers the 11th failed attempt from one IP with 429 and does not process it',
    tx(async () => {
      const { app } = createTestApp(client, { loginLimiter: createLoginLimiter() });
      for (let i = 0; i < 10; i += 1) {
        expect((await login(app, 'zz_nobody', 'wrong')).status).toBe(401);
      }
      const limited = await login(app, 'zz_nobody', 'wrong');
      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect(await auditRows('auth.login_failed')).toHaveLength(10);
    }),
  );
});

describe('secrets in audit rows', () => {
  it(
    'never stores passwords, hashes, session IDs or CSRF tokens',
    tx(async () => {
      const { app, db } = createTestApp(client);
      const user = await createTestUser(db, { roles: ['REC'] });
      await login(app, user.username, 'wrong-password-zz');
      const signIn = await login(app, user.username);
      const cookie = pair(cookieOf(signIn));
      await request(app)
        .post('/api/auth/logout')
        .set('Cookie', cookie)
        .set('X-CSRF-Token', signIn.body.csrfToken);

      const { rows: hash } = await client.query('SELECT password_hash FROM users WHERE id = $1', [
        user.id,
      ]);
      const { rows } = await client.query<{ row: string }>(
        'SELECT audit_logs::text AS row FROM audit_logs WHERE occurred_at = now()',
      );
      expect(rows.length).toBeGreaterThanOrEqual(3);
      const all = rows.map((r) => r.row).join('\n');
      for (const secret of [
        TEST_PASSWORD,
        'wrong-password-zz',
        hash[0].password_hash,
        sidOf(cookie),
        signIn.body.csrfToken,
      ]) {
        expect(all).not.toContain(secret);
      }
    }),
  );
});
