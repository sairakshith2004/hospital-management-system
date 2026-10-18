import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTest, expectSqlError, inRollback } from './test-db.js';

const checksums = JSON.parse(
  readFileSync(new URL('./migrations/checksums.json', import.meta.url), 'utf8'),
) as Record<string, string>;

const PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

/** The approved hms_app privilege matrix (migrations 0001, 0003, 0005 and 0007). */
const HMS_APP_PRIVILEGES: Record<string, string[]> = {
  appointments: ['SELECT', 'INSERT', 'UPDATE'],
  audit_logs: ['SELECT', 'INSERT'],
  departments: ['SELECT', 'INSERT', 'UPDATE'],
  doctor_profiles: ['SELECT', 'INSERT', 'UPDATE'],
  doctor_schedules: ['SELECT', 'INSERT', 'UPDATE'],
  employees: ['SELECT', 'INSERT', 'UPDATE'],
  hospital_settings: ['SELECT', 'UPDATE'],
  patients: ['SELECT', 'INSERT', 'UPDATE'],
  permissions: ['SELECT'],
  role_permissions: ['SELECT', 'INSERT', 'DELETE'],
  roles: ['SELECT', 'INSERT', 'UPDATE'],
  schedule_exceptions: ['SELECT', 'INSERT', 'UPDATE'],
  sessions: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  user_roles: ['SELECT', 'INSERT', 'DELETE'],
  users: ['SELECT', 'INSERT', 'UPDATE'],
};
const DELETABLE = ['role_permissions', 'sessions', 'user_roles'];

let app!: pg.Client;
let owner!: pg.Client;
beforeAll(async () => {
  app = await connectTest('app');
  owner = await connectTest('owner');
});
afterAll(async () => {
  await app?.end();
  await owner?.end();
});

it('connects to hms_test as hms_app and as hms_owner', async () => {
  for (const [client, role] of [
    [app, 'hms_app'],
    [owner, 'hms_owner'],
  ] as const) {
    const { rows } = await client.query('SELECT current_user AS u, current_database() AS d');
    expect(rows[0]).toEqual({ u: role, d: 'hms_test' });
  }
});

describe('migrations', () => {
  it('hms_test has applied exactly the migrations in the repository', async () => {
    const { rows } = await owner.query<{ hash: string }>(
      'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id',
    );
    expect(rows.map((r) => r.hash)).toEqual(Object.values(checksums));
  });
});

describe('hms_app privileges', () => {
  it('match the approved matrix exactly', async () => {
    const { rows } = await app.query<{ tbl: string; privilege: string; granted: boolean }>(
      `SELECT c.relname AS tbl, p AS privilege, has_table_privilege(c.oid, p) AS granted
       FROM pg_class c CROSS JOIN unnest($1::text[]) AS p
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'`,
      [PRIVILEGES],
    );
    const actual: Record<string, string[]> = {};
    for (const r of rows) {
      actual[r.tbl] ??= [];
      if (r.granted) actual[r.tbl]!.push(r.privilege);
    }
    for (const list of Object.values(actual)) {
      list.sort((a, b) => PRIVILEGES.indexOf(a) - PRIVILEGES.indexOf(b));
    }
    expect(actual).toEqual(HMS_APP_PRIVILEGES);
  });

  it.each(Object.keys(HMS_APP_PRIVILEGES).filter((t) => !DELETABLE.includes(t)))(
    'cannot DELETE from %s',
    (table) =>
      inRollback(app, () =>
        expectSqlError(app, `DELETE FROM ${table} WHERE false`, '42501', /permission denied/),
      ),
  );

  it.each(DELETABLE)('can DELETE from %s (revoking an assignment or ending a session)', (table) =>
    inRollback(app, async () => {
      await app.query(`DELETE FROM ${table} WHERE false`);
    }),
  );

  it('lets hms_app draw MRNs and appointment numbers from their sequences, and nothing else', async () => {
    const { rows } = await app.query<{ usage: boolean; update: boolean }>(
      `SELECT has_sequence_privilege('patient_mrn_seq', 'USAGE') AS usage,
              has_sequence_privilege('patient_mrn_seq', 'UPDATE') AS update,
              has_sequence_privilege('appointment_no_seq', 'USAGE') AS apt_usage,
              has_sequence_privilege('appointment_no_seq', 'UPDATE') AS apt_update`,
    );
    expect(rows[0]).toEqual({ usage: true, update: false, apt_usage: true, apt_update: false });
  });
});

describe('audit_logs', () => {
  it('lets hms_app insert a row without supplying an id', () =>
    inRollback(app, async () => {
      const { rows } = await app.query<{ id: string }>(
        `INSERT INTO audit_logs (actor_type, action, entity_type)
         VALUES ('system', 'test.audit_insert', 'test') RETURNING id`,
      );
      expect(Number(rows[0]?.id)).toBeGreaterThan(0);
    }));

  it.each([
    ['UPDATE', 'UPDATE audit_logs SET reason = NULL WHERE false'],
    ['DELETE', 'DELETE FROM audit_logs WHERE false'],
    ['TRUNCATE', 'TRUNCATE audit_logs'],
  ])('refuses %s by hms_app (no privilege)', (_op, sql) =>
    inRollback(app, () =>
      expectSqlError(app, sql, '42501', /permission denied for table audit_logs/),
    ),
  );

  it('does not let hms_app use the id sequence directly', () =>
    inRollback(app, () =>
      expectSqlError(app, "SELECT nextval('audit_logs_id_seq')", '42501', /permission denied/),
    ));

  // The owner has every privilege, so these prove the triggers on their own.
  it.each([
    ['UPDATE', "UPDATE audit_logs SET reason = 'changed' WHERE action = 'test.append_only'"],
    ['DELETE', "DELETE FROM audit_logs WHERE action = 'test.append_only'"],
    ['TRUNCATE', 'TRUNCATE audit_logs'],
  ])('rejects %s even by the table owner (append-only triggers)', (op, sql) =>
    inRollback(owner, async () => {
      await owner.query(
        `INSERT INTO audit_logs (actor_type, action, entity_type)
         VALUES ('system', 'test.append_only', 'test')`,
      );
      await expectSqlError(owner, sql, '42501', new RegExp(`append-only: ${op} is not allowed`));
    }),
  );
});

describe('set_updated_at trigger', () => {
  it('sets updated_at to the transaction time on UPDATE', () =>
    inRollback(owner, async () => {
      await owner.query(
        `INSERT INTO departments (code, name, updated_at)
         VALUES ('ZZ_TEST', 'Test department', '2000-01-01T00:00:00Z')`,
      );
      const { rows } = await owner.query<{ fresh: boolean }>(
        `UPDATE departments SET name = 'Test department 2' WHERE code = 'ZZ_TEST'
         RETURNING updated_at = now() AS fresh`,
      );
      expect(rows[0]?.fresh).toBe(true);
    }));
});

describe('constraints', () => {
  it('allows only one hospital_settings row', () =>
    inRollback(owner, () =>
      expectSqlError(
        owner,
        "INSERT INTO hospital_settings (id, name) VALUES (2, 'Second hospital')",
        '23514',
        /hospital_settings_single_row/,
      ),
    ));

  it('requires an actor for user actions', () =>
    inRollback(owner, () =>
      expectSqlError(
        owner,
        "INSERT INTO audit_logs (actor_type, action, entity_type) VALUES ('user', 'test.no_actor', 'test')",
        '23514',
        /audit_logs_actor_matches_type/,
      ),
    ));

  it('stops a user granting themselves a role', () =>
    inRollback(owner, async () => {
      const one = async (sql: string, params: unknown[] = []) =>
        (await owner.query<{ id: string }>(sql, params)).rows[0]!.id;
      const dept = await one(
        "INSERT INTO departments (code, name) VALUES ('ZZ_TEST', 'Test department') RETURNING id",
      );
      const employee = await one(
        `INSERT INTO employees (employee_no, full_name, department_id, designation)
         VALUES ('ZZ-TEST-1', 'Test Person', $1, 'Tester') RETURNING id`,
        [dept],
      );
      const user = await one(
        "INSERT INTO users (employee_id, username, password_hash) VALUES ($1, 'zz_test_user', 'not-a-real-hash') RETURNING id",
        [employee],
      );
      const role = await one(
        "INSERT INTO roles (code, name) VALUES ('ZZ_TEST', 'Test role') RETURNING id",
      );
      await expectSqlError(
        owner,
        'INSERT INTO user_roles (user_id, role_id, granted_by) VALUES ($1, $2, $1)',
        '23514',
        /user_roles_no_self_grant/,
        [user, role],
      );
    }));
});
