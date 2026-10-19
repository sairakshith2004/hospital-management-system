/**
 * Demonstration availability for the demo doctors in hms_dev: one session a day, Monday to
 * Saturday, 09:00–13:00 hospital time (Asia/Kolkata; session times are wall-clock times
 * in that zone), using each doctor's own default_slot_minutes. Synthetic sample hours,
 * not confirmed clinical hours. Creates doctor_schedules rows only: never appointments,
 * check-ins, patients or accounts.
 *
 * Runs inside the caller's transaction as hms_app. Safe to re-run: a session is added only
 * where the doctor has no active session on that weekday, so nothing is duplicated and no
 * existing row is changed or deleted. One audit row (counts only) when something was added.
 */
import { HOSPITAL_TIME_ZONE } from '@hospitalos/shared';
import type { Queryable } from '../client.js';
import { SYSTEM, recordAudit } from '../../lib/audit.js';
import { DEMO_STAFF } from './demo-data.js';

// Arbitrary constant; differs from the migration, seed, bootstrap and demo-seed locks.
const DEMO_SCHEDULE_LOCK_KEY = 4_200_405;

/** ISO weekdays 1 (Monday) to 6 (Saturday), 09:00–13:00. */
export const DEMO_SCHEDULE_TEMPLATE = {
  weekdays: [1, 2, 3, 4, 5, 6],
  startTime: '09:00',
  endTime: '13:00',
} as const;

/** The demo doctors, by employee number (DEMO-101 … DEMO-106). */
export const DEMO_DOCTOR_EMPLOYEE_NOS = DEMO_STAFF.filter((s) => s.doctor).map((s) => s.employeeNo);

export interface DemoScheduleResult {
  /** Active demo doctors found in the database. */
  doctors: number;
  inserted: number;
  /** Doctor-weekday pairs that already had an active session and were left alone. */
  skipped: number;
}

export async function seedDemoSchedules(db: Queryable): Promise<DemoScheduleResult> {
  await db.query('SELECT pg_advisory_xact_lock($1)', [DEMO_SCHEDULE_LOCK_KEY]);
  const { weekdays, startTime, endTime } = DEMO_SCHEDULE_TEMPLATE;
  const { rowCount: doctors } = await db.query(
    `SELECT d.id FROM doctor_profiles d JOIN employees e ON e.id = d.employee_id
     WHERE e.employee_no = ANY($1::text[]) AND d.active`,
    [DEMO_DOCTOR_EMPLOYEE_NOS],
  );
  const { rowCount: inserted } = await db.query(
    `INSERT INTO doctor_schedules (doctor_id, weekday, start_time, end_time, slot_minutes, valid_from)
     SELECT d.id, w.weekday, $2::time, $3::time, d.default_slot_minutes,
            (now() AT TIME ZONE '${HOSPITAL_TIME_ZONE}')::date
     FROM doctor_profiles d
     JOIN employees e ON e.id = d.employee_id
     CROSS JOIN unnest($4::smallint[]) AS w(weekday)
     WHERE e.employee_no = ANY($1::text[]) AND d.active
       AND NOT EXISTS (
         SELECT 1 FROM doctor_schedules s
         WHERE s.doctor_id = d.id AND s.weekday = w.weekday AND s.active)
     RETURNING id`,
    [DEMO_DOCTOR_EMPLOYEE_NOS, startTime, endTime, [...weekdays]],
  );
  const result = {
    doctors: doctors ?? 0,
    inserted: inserted ?? 0,
    skipped: (doctors ?? 0) * weekdays.length - (inserted ?? 0),
  };
  if (result.inserted > 0) {
    await recordAudit(
      db,
      {
        actor: SYSTEM,
        action: 'demo_seed.schedules_applied',
        entityType: 'system',
        changes: { ...result },
      },
      { requestId: null, ip: null },
    );
  }
  return result;
}
