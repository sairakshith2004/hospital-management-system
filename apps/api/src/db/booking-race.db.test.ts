/**
 * BK-2: ten simultaneous bookings of one slot, on ten real connections. Exactly one
 * succeeds; the other nine are refused by the appointments_no_doctor_overlap constraint.
 *
 * Approved exception to "every database test rolls back" (2026-10-17): a real race needs
 * committed rows, because a conflicting insert waits for the first transaction to finish
 * and only fails if it commits. So this test:
 *   - uses hms_test only (connectTest's guards refuse any other database);
 *   - creates its own synthetic department, doctor, patients and session, with unique
 *     codes, as hms_owner (the established test owner connection);
 *   - races the same INSERT the booking code uses, as hms_app, directly in SQL. It does not
 *     go through the booking service, so it writes no audit rows (audit rows are
 *     append-only and could not be cleaned up). Audit behaviour itself is unchanged and
 *     is tested through the real API elsewhere;
 *   - deletes exactly the rows it created, by ID, as hms_owner, in `finally`.
 */
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { connectTest } from './test-db.js';

let owner!: pg.Client;
beforeAll(async () => {
  owner = await connectTest('owner');
});
afterAll(async () => {
  await owner?.end();
});

const RACERS = 10;

it('lets exactly 1 of 10 simultaneous bookings for one slot succeed (BK-2)', async () => {
  const tag = `${process.pid}${Date.now() % 100000}`;
  const created = {
    appointments: [] as string[],
    doctor_schedules: [] as string[],
    doctor_profiles: [] as string[],
    employees: [] as string[],
    departments: [] as string[],
    patients: [] as string[],
  };
  const make = async (table: keyof typeof created, sql: string, params: unknown[]) => {
    const { rows } = await owner.query<{ id: string }>(sql, params);
    created[table].push(rows[0]!.id);
    return rows[0]!.id;
  };
  const racers = await Promise.all(Array.from({ length: RACERS }, () => connectTest('app')));
  try {
    const dept = await make(
      'departments',
      'INSERT INTO departments (code, name) VALUES ($1, $1) RETURNING id',
      [`ZZRACE${tag}`.slice(0, 20)],
    );
    const emp = await make(
      'employees',
      `INSERT INTO employees (employee_no, full_name, department_id, designation)
       VALUES ($1, 'Dr. Zz Race', $2, 'Consultant') RETURNING id`,
      [`ZZ-RACE-${tag}`, dept],
    );
    const doctor = await make(
      'doctor_profiles',
      `INSERT INTO doctor_profiles (employee_id, department_id, specialty, registration_no,
         consultation_fee_paise) VALUES ($1, $2, 'Zz', $3, 50000) RETURNING id`,
      [emp, dept, `ZZ-RACE-${tag}`],
    );
    const session = await make(
      'doctor_schedules',
      `INSERT INTO doctor_schedules (doctor_id, weekday, start_time, end_time, slot_minutes, valid_from)
       VALUES ($1, 1, '09:00', '13:00', 15, '2030-01-01') RETURNING id`,
      [doctor],
    );
    const patients: string[] = [];
    for (let i = 0; i < RACERS; i += 1) {
      patients.push(
        await make(
          'patients',
          `INSERT INTO patients (first_name, last_name, dob, sex, phone)
           VALUES ('Zz', 'Racer', '1990-01-01', 'male', $1) RETURNING id`,
          [`90000777${String(i).padStart(2, '0')}`],
        ),
      );
    }

    // Each racer books the same Monday 09:00–09:15 slot for a different patient.
    const results = await Promise.allSettled(
      racers.map(async (c, i) => {
        await c.query('BEGIN');
        try {
          const { rows } = await c.query<{ id: string }>(
            `INSERT INTO appointments (patient_id, doctor_id, department_id, doctor_schedule_id,
               kind, visit_date, slot_start, slot_end)
             VALUES ($1, $2, $3, $4, 'scheduled', '2030-01-07',
                     '2030-01-07 09:00+05:30', '2030-01-07 09:15+05:30')
             RETURNING id`,
            [patients[i], doctor, dept, session],
          );
          await c.query('COMMIT');
          return rows[0]!.id;
        } catch (err) {
          await c.query('ROLLBACK');
          throw err;
        }
      }),
    );

    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    for (const r of won) created.appointments.push(r.value);
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(RACERS - 1);
    for (const r of lost) {
      expect((r.reason as { code?: string; constraint?: string }).code).toBe('23P01');
      expect((r.reason as { constraint?: string }).constraint).toBe(
        'appointments_no_doctor_overlap',
      );
    }
    const { rows } = await owner.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM appointments WHERE doctor_id = $1 AND status = 'booked'",
      [doctor],
    );
    expect(rows[0]!.n).toBe(1);
  } finally {
    await Promise.all(racers.map((c) => c.end()));
    // Exactly the rows this test created, children first.
    for (const table of Object.keys(created) as (keyof typeof created)[]) {
      if (created[table].length > 0) {
        await owner.query(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [created[table]]);
      }
    }
  }
});
