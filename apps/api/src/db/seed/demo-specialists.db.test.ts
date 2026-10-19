import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { connectTest, inRollback } from '../test-db.js';
import { seedDemoData } from './demo-data.js';
import {
  SPECIALIST_DEPARTMENTS,
  SPECIALIST_DOCTORS,
  seedDemoSpecialists,
} from './demo-specialists.js';

// Runs as hms_app inside a rolled-back transaction: hms_test keeps no demo data.
let app!: pg.Client;
beforeAll(async () => {
  app = await connectTest('app');
});
afterAll(async () => {
  await app?.end();
});
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$synthetic-test-salt$synthetic-test-hash';
const SESSIONS = SPECIALIST_DOCTORS.reduce((n, d) => n + d.hours.days.length, 0);

it('adds departments, doctors with logins and weekly hours once; a re-run adds nothing', () =>
  inRollback(app, async () => {
    await seedDemoData(app, { passwordHash: HASH }); // the base departments come from here
    const first = await seedDemoSpecialists(app, { passwordHash: HASH });
    expect(first.employees).toBe(SPECIALIST_DOCTORS.length);
    expect(first.users).toBe(SPECIALIST_DOCTORS.length);
    expect(first.doctors).toBe(SPECIALIST_DOCTORS.length);
    expect(first.scheduleRows).toBe(SESSIONS);
    expect(first.departments).toBeLessThanOrEqual(SPECIALIST_DEPARTMENTS.length);

    const { rows } = await app.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM users u
         JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id AND r.code = 'DOC'
         JOIN doctor_profiles p ON p.employee_id = u.employee_id
         JOIN departments d ON d.id = p.department_id AND d.is_clinical
        WHERE u.username = ANY($1) AND u.password_hash = $2`,
      [SPECIALIST_DOCTORS.map((d) => d.username), HASH],
    );
    expect(rows[0]!.n).toBe(SPECIALIST_DOCTORS.length);

    expect(await seedDemoSpecialists(app, { passwordHash: HASH })).toEqual({
      departments: 0,
      employees: 0,
      users: 0,
      doctors: 0,
      scheduleRows: 0,
    });
    const { rows: audit } = await app.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_logs WHERE action = 'demo_seed.specialists_applied' AND occurred_at = now()",
    );
    expect(audit[0]!.n).toBe(1);
  }));
