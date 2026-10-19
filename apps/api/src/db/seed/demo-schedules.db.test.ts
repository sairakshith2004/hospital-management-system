import { hospitalToday } from '@hospitalos/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listSlots } from '../../modules/scheduling/scheduling.repo.js';
import { connectTest, inRollback } from '../test-db.js';
import { seedDemoData } from './demo-data.js';
import { DEMO_DOCTOR_EMPLOYEE_NOS, seedDemoSchedules } from './demo-schedules.js';

// Runs as hms_app inside a rolled-back transaction: hms_test keeps no demo data.
let app!: pg.Client;
beforeAll(async () => {
  app = await connectTest('app');
});
afterAll(async () => {
  await app?.end();
});
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$synthetic-test-salt$synthetic-test-hash';

const doctorId = async (employeeNo: string) =>
  (
    await app.query<{ id: string }>(
      `SELECT d.id FROM doctor_profiles d JOIN employees e ON e.id = d.employee_id
       WHERE e.employee_no = $1`,
      [employeeNo],
    )
  ).rows[0]!.id;

async function tableCounts() {
  const { rows } = await app.query(
    `SELECT (SELECT count(*)::int FROM appointments) AS appointments,
            (SELECT count(*)::int FROM patients) AS patients,
            (SELECT count(*)::int FROM users) AS users,
            (SELECT count(*)::int FROM user_roles) AS user_roles,
            (SELECT count(*)::int FROM role_permissions) AS role_permissions,
            (SELECT count(*)::int FROM doctor_profiles) AS doctor_profiles`,
  );
  return rows[0];
}

const auditCount = async () =>
  (
    await app.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_logs
       WHERE action = 'demo_seed.schedules_applied' AND occurred_at = now()`,
    )
  ).rows[0]!.n;

describe('seedDemoSchedules', () => {
  it('adds Mon–Sat 09:00–13:00 for each demo doctor at their slot length; a re-run adds nothing', () =>
    inRollback(app, async () => {
      await seedDemoData(app, { passwordHash: HASH });
      const before = await tableCounts();
      expect(await seedDemoSchedules(app)).toEqual({ doctors: 6, inserted: 36, skipped: 0 });

      const { rows } = await app.query(
        `SELECT e.employee_no AS no, s.weekday, to_char(s.start_time, 'HH24:MI') AS start,
                to_char(s.end_time, 'HH24:MI') AS end, s.slot_minutes AS slot,
                s.valid_from::text AS "validFrom", s.valid_to AS "validTo", s.active
         FROM doctor_schedules s JOIN doctor_profiles d ON d.id = s.doctor_id
         JOIN employees e ON e.id = d.employee_id
         WHERE e.employee_no = ANY($1) ORDER BY e.employee_no, s.weekday`,
        [DEMO_DOCTOR_EMPLOYEE_NOS],
      );
      expect(rows).toHaveLength(36);
      for (const r of rows) {
        expect(r).toMatchObject({
          start: '09:00',
          end: '13:00',
          slot: r.no === 'DEMO-103' ? 20 : 15,
          validFrom: hospitalToday(),
          validTo: null,
          active: true,
        });
      }
      expect([...new Set(rows.map((r) => r.weekday))]).toEqual([1, 2, 3, 4, 5, 6]);
      expect(await auditCount()).toBe(1);
      // Schedules only: no appointments, patients, accounts or grants.
      expect(await tableCounts()).toEqual(before);

      expect(await seedDemoSchedules(app)).toEqual({ doctors: 6, inserted: 0, skipped: 36 });
      const { rows: total } = await app.query(
        'SELECT count(*)::int AS n FROM doctor_schedules WHERE doctor_id IN (SELECT id FROM doctor_profiles)',
      );
      expect(total[0].n).toBe(36);
      expect(await auditCount()).toBe(1); // no audit row for a run that changed nothing
    }));

  it('leaves a weekday that already has an active session untouched, and skips inactive doctors', () =>
    inRollback(app, async () => {
      await seedDemoData(app, { passwordHash: HASH });
      const doc1 = await doctorId('DEMO-101');
      const { rows: existing } = await app.query<{ id: string }>(
        `INSERT INTO doctor_schedules (doctor_id, weekday, start_time, end_time, slot_minutes, valid_from)
         VALUES ($1, 1, '14:00', '16:00', 30, '2026-01-01') RETURNING id`,
        [doc1],
      );
      await app.query('UPDATE doctor_profiles SET active = false WHERE id = $1', [
        await doctorId('DEMO-106'),
      ]);
      expect(await seedDemoSchedules(app)).toEqual({ doctors: 5, inserted: 29, skipped: 1 });
      const { rows } = await app.query(
        `SELECT id, to_char(start_time, 'HH24:MI') AS start, slot_minutes AS slot
         FROM doctor_schedules WHERE doctor_id = $1 AND weekday = 1`,
        [doc1],
      );
      expect(rows).toEqual([{ id: existing[0]!.id, start: '14:00', slot: 30 }]);
    }));

  it('produces bookable slots through the scheduling API rules', () =>
    inRollback(app, async () => {
      await seedDemoData(app, { passwordHash: HASH });
      await seedDemoSchedules(app);
      const monday = '2030-01-07';
      const slots = async (no: string) => listSlots(app, await doctorId(no), monday);
      const doc1 = await slots('DEMO-101');
      expect(doc1).toHaveLength(16);
      expect(doc1[0]!.slotStart).toBe(new Date('2030-01-07T09:00:00+05:30').toISOString());
      expect(doc1.at(-1)!.slotEnd).toBe(new Date('2030-01-07T13:00:00+05:30').toISOString());
      expect(doc1.every((s) => s.available)).toBe(true);
      expect(await slots('DEMO-103')).toHaveLength(12);
      expect(await listSlots(app, await doctorId('DEMO-101'), '2030-01-13')).toEqual([]); // Sunday
    }));
});
