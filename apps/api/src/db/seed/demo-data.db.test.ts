import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTest, inRollback } from '../test-db.js';
import { DEMO_DEPARTMENTS, DEMO_PATIENTS, DEMO_STAFF, seedDemoData } from './demo-data.js';

// Runs as hms_app inside a rolled-back transaction: hms_test keeps no demo data.
let app!: pg.Client;
beforeAll(async () => {
  app = await connectTest('app');
});
afterAll(async () => {
  await app?.end();
});
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$synthetic-test-salt$synthetic-test-hash';

describe('seedDemoData', () => {
  it('creates departments, staff with one account per role, doctors and patients; a re-run adds nothing', () =>
    inRollback(app, async () => {
      const first = await seedDemoData(app, { passwordHash: HASH });
      expect(first).toEqual({
        departments: DEMO_DEPARTMENTS.length,
        employees: DEMO_STAFF.length,
        users: DEMO_STAFF.length,
        roleGrants: DEMO_STAFF.length,
        doctors: DEMO_STAFF.filter((s) => s.doctor).length,
        patients: DEMO_PATIENTS.length,
      });
      const roles = await app.query<{ code: string; n: number }>(
        `SELECT r.code, count(*)::int AS n FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         JOIN users u ON u.id = ur.user_id WHERE u.username = ANY($1) GROUP BY r.code ORDER BY r.code`,
        [DEMO_STAFF.map((s) => s.username)],
      );
      expect(roles.rows).toEqual([
        { code: 'ADM', n: 1 },
        { code: 'DOC', n: 6 },
        { code: 'FIN', n: 1 },
        { code: 'HR', n: 1 },
        { code: 'INV', n: 1 },
        { code: 'LAB', n: 1 },
        { code: 'MKT', n: 1 },
        { code: 'NUR', n: 1 },
        { code: 'PHA', n: 1 },
        { code: 'REC', n: 1 },
      ]);
      const second = await seedDemoData(app, { passwordHash: 'a-different-hash' });
      expect(Object.values(second).every((n) => n === 0)).toBe(true);
      const hashes = await app.query(
        'SELECT DISTINCT password_hash FROM users WHERE username = ANY($1)',
        [DEMO_STAFF.map((s) => s.username)],
      );
      expect(hashes.rows).toEqual([{ password_hash: HASH }]); // never reset
      const audit = await app.query(
        "SELECT count(*)::int AS n FROM audit_logs WHERE action = 'demo_seed.applied' AND occurred_at = now()",
      );
      expect(audit.rows[0].n).toBe(1);
    }));

  it('uses only synthetic phone numbers and valid demographics', () => {
    for (const p of DEMO_PATIENTS) {
      expect(p.phone).toMatch(/^90000\d{5}$/);
      expect(p.dob >= '1900-01-01').toBe(true);
    }
  });
});
