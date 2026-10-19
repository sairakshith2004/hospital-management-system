/**
 * Self sign-up through the real API on hms_test, each test rolled back. A new account waits
 * for an administrator's approval and has no role.
 */
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connectTest,
  createTestApp,
  createTestUser,
  inRollback,
  signIn,
} from '../../db/test-db.js';
import { createLoginLimiter } from '../../middleware/rate-limit.js';

let client!: pg.Client;
beforeAll(async () => {
  client = await connectTest('app');
});
afterAll(async () => {
  await client?.end();
});
const tx = (work: () => Promise<void>) => () => inRollback(client, work);
const PASSWORD = 'Zz-signup-pass-123';

async function department() {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO departments (code, name, is_clinical) VALUES ('ZZ_SIGNUP', 'Zz Signup Dept', true) RETURNING id`,
  );
  return rows[0]!.id;
}
const form = (departmentId: string, username = 'zz_new_nurse') => ({
  fullName: 'Zz New Nurse',
  username,
  departmentId,
  designation: 'Staff Nurse',
  password: PASSWORD,
});

describe('self sign-up', () => {
  it(
    'creates an account that can sign in only after an administrator approves it',
    tx(async () => {
      const { app, db } = createTestApp(client);
      const dept = await department();

      const list = await request(app).get('/api/auth/signup/departments');
      expect(list.status).toBe(200);
      expect(list.body.departments).toContainEqual({ id: dept, name: 'Zz Signup Dept' });

      const created = await request(app).post('/api/auth/signup').send(form(dept));
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body).toEqual({ status: 'pending' });
      const { rows } = await client.query<{
        id: string;
        status: string;
        pending: boolean;
        employee_no: string;
        roles: number;
      }>(
        `SELECT u.id, u.status, u.pending_approval AS pending, e.employee_no,
                (SELECT count(*)::int FROM user_roles ur WHERE ur.user_id = u.id) AS roles
           FROM users u JOIN employees e ON e.id = u.employee_id WHERE u.username = 'zz_new_nurse'`,
      );
      expect(rows[0]).toMatchObject({ status: 'disabled', pending: true, roles: 0 });
      expect(rows[0]!.employee_no).toMatch(/^SU-\d{5}$/);
      const audit = await client.query(
        "SELECT 1 FROM audit_logs WHERE action = 'user.signed_up' AND entity_id = $1",
        [rows[0]!.id],
      );
      expect(audit.rowCount).toBe(1);

      // Right password while waiting: told to wait. Wrong password: the usual generic answer.
      const pending = await request(app)
        .post('/api/auth/login')
        .send({ username: 'zz_new_nurse', password: PASSWORD });
      expect(pending.status).toBe(403);
      expect(pending.body.error.code).toBe('ACCOUNT_PENDING');
      const wrong = await request(app)
        .post('/api/auth/login')
        .send({ username: 'zz_new_nurse', password: 'not-the-password' });
      expect(wrong.status).toBe(401);

      const again = await request(app).post('/api/auth/signup').send(form(dept));
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('USERNAME_TAKEN');

      // An administrator approves it; then it signs in (with no role yet).
      const adm = await createTestUser(db, { roles: ['ADM'] });
      const s = await signIn(app, adm.username);
      const approve = await request(app)
        .post(`/api/admin/users/${rows[0]!.id}/status`)
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', s.csrf)
        .send({ status: 'active', reason: 'Zz verified new joiner' });
      expect(approve.status, JSON.stringify(approve.body)).toBe(200);
      const ok = await request(app)
        .post('/api/auth/login')
        .send({ username: 'zz_new_nurse', password: PASSWORD });
      expect(ok.status).toBe(200);
      expect(ok.body.user.roles).toEqual([]);
      const changed = await client.query(
        "SELECT changes FROM audit_logs WHERE action = 'user.status_changed' AND entity_id = $1",
        [rows[0]!.id],
      );
      expect(changed.rows[0].changes).toEqual({ from: 'pending', to: 'active' });
    }),
  );

  it(
    'refuses bad input, extra fields and unknown departments',
    tx(async () => {
      const { app } = createTestApp(client);
      const dept = await department();
      const bad = await request(app)
        .post('/api/auth/signup')
        .send({ ...form(dept), username: 'Bad Name', password: 'short' });
      expect(bad.status).toBe(422);
      const extra = await request(app)
        .post('/api/auth/signup')
        .send({ ...form(dept), roleCode: 'SA' });
      expect(extra.status).toBe(422); // no role can be smuggled in
      const unknown = await request(app)
        .post('/api/auth/signup')
        .send(form('00000000-0000-4000-8000-000000000000', 'zz_other'));
      expect(unknown.body.error.code).toBe('UNKNOWN_DEPARTMENT');
    }),
  );

  it(
    'limits sign-ups per address',
    tx(async () => {
      const { app } = createTestApp(client, {
        signupLimiter: createLoginLimiter({ limit: 1, windowMs: 60_000, countSuccesses: true }),
      });
      const dept = await department();
      expect((await request(app).post('/api/auth/signup').send(form(dept, 'zz_one'))).status).toBe(
        201,
      );
      expect((await request(app).post('/api/auth/signup').send(form(dept, 'zz_two'))).status).toBe(
        429,
      );
    }),
  );
});
