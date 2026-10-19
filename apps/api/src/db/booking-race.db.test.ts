/**
 * BK-2 at the database level, on real connections and committed transactions.
 *
 * Approved exception to "every database test rolls back" (2026-10-17): a real race needs
 * committed rows, because a conflicting insert waits for the first transaction to finish
 * and only fails if it commits. So this file:
 *   - uses hms_test only (connectTest's guards refuse any other database);
 *   - creates its own synthetic department, doctor, patients and session, with unique
 *     codes, as hms_owner (the established test owner connection);
 *   - works directly in SQL as hms_app, not through the booking service, so it writes no
 *     audit rows (audit rows are append-only and could not be cleaned up). Audit
 *     behaviour is unchanged and is tested through the real API in
 *     modules/scheduling/scheduling.db.test.ts and scheduling-race.db.test.ts;
 *   - deletes exactly the rows it created, by ID, as hms_owner, in afterAll.
 *
 * Why the race takes the booking lock: ten unlocked inserts of the same slot can make
 * waiting inserters wait on each other inside the exclusion constraint, and PostgreSQL
 * then aborts one with a deadlock (40P01) instead of an exclusion violation (23P01). The
 * booking code therefore takes the doctor-day advisory lock first (lockBooking), and so
 * does this race. The constraint itself, as the second line of defence, is tested
 * separately with one waiting inserter, where no deadlock is possible.
 */
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { lockBooking } from '../modules/scheduling/scheduling.repo.js';
import { connectTest } from './test-db.js';

const RACERS = 10;
const DATE = '2030-01-07';
/** The backstop test's own Monday, so the race winner's booking on DATE can't interfere. */
const DATE2 = '2030-01-14';

let owner!: pg.Client;
const created = {
  appointments: [] as string[],
  doctor_schedules: [] as string[],
  doctor_profiles: [] as string[],
  employees: [] as string[],
  departments: [] as string[],
  patients: [] as string[],
};
let dept!: string;
let doctor!: string;
let session!: string;
const patients: string[] = [];

async function make(table: keyof typeof created, sql: string, params: unknown[]) {
  const { rows } = await owner.query<{ id: string }>(sql, params);
  created[table].push(rows[0]!.id);
  return rows[0]!.id;
}

beforeAll(async () => {
  owner = await connectTest('owner');
  const tag = `${process.pid}${Date.now() % 100000}`;
  dept = await make(
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
  doctor = await make(
    'doctor_profiles',
    `INSERT INTO doctor_profiles (employee_id, department_id, specialty, registration_no,
       consultation_fee_paise) VALUES ($1, $2, 'Zz', $3, 50000) RETURNING id`,
    [emp, dept, `ZZ-RACE-${tag}`],
  );
  session = await make(
    'doctor_schedules',
    `INSERT INTO doctor_schedules (doctor_id, weekday, start_time, end_time, slot_minutes, valid_from)
     VALUES ($1, 1, '09:00', '13:00', 15, '2030-01-01') RETURNING id`,
    [doctor],
  );
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
});

afterAll(async () => {
  try {
    // Exactly the rows this file created, children first.
    for (const table of Object.keys(created) as (keyof typeof created)[]) {
      if (created[table].length > 0) {
        await owner.query(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [created[table]]);
      }
    }
  } finally {
    await owner?.end();
  }
});

const INSERT = `INSERT INTO appointments (patient_id, doctor_id, department_id, doctor_schedule_id,
    kind, visit_date, slot_start, slot_end)
  VALUES ($1, $2, $3, $4, 'scheduled', $5::date, $6::timestamptz, $7::timestamptz)
  RETURNING id`;
const slot = (start: string, end: string, date = DATE) => [
  `${date} ${start}+05:30`,
  `${date} ${end}+05:30`,
];

async function bookedAt(start: string, date = DATE): Promise<number> {
  const { rows } = await owner.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM appointments
     WHERE doctor_id = $1 AND status = 'booked' AND slot_start = $2::timestamptz`,
    [doctor, `${date} ${start}+05:30`],
  );
  return rows[0]!.n;
}

it('lets exactly 1 of 10 simultaneous locked bookings for one slot succeed (BK-2)', async () => {
  const racers = await Promise.all(Array.from({ length: RACERS }, () => connectTest('app')));
  try {
    // Each racer books the same 09:00–09:15 slot for a different patient, the way the
    // booking service does: advisory lock, then INSERT, in one transaction.
    const results = await Promise.allSettled(
      racers.map(async (c, i) => {
        await c.query('BEGIN');
        try {
          await lockBooking(c, [{ doctorId: doctor, patientId: patients[i]!, visitDate: DATE }]);
          const { rows } = await c.query<{ id: string }>(INSERT, [
            patients[i],
            doctor,
            dept,
            session,
            DATE,
            ...slot('09:00', '09:15'),
          ]);
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
      const { code, constraint } = r.reason as { code?: string; constraint?: string };
      expect({ code, constraint }).toEqual({
        code: '23P01',
        constraint: 'appointments_no_doctor_overlap',
      });
    }
    expect(await bookedAt('09:00')).toBe(1);
  } finally {
    await Promise.all(racers.map((c) => c.end()));
  }
});

it('refuses, with 23P01, an unlocked insert that waited for a conflicting booking to commit', async () => {
  const [first, second] = await Promise.all([connectTest('app'), connectTest('app')]);
  try {
    await first.query('BEGIN');
    const firstId = (
      await first.query<{ id: string }>(INSERT, [
        patients[0],
        doctor,
        dept,
        session,
        DATE2,
        ...slot('10:00', '10:15', DATE2),
      ])
    ).rows[0]!.id;
    created.appointments.push(firstId);

    // No advisory lock: the constraint alone must make the second insert wait, then fail.
    const pid = (await second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
      .pid;
    const waiting = second
      .query('BEGIN')
      .then(() =>
        second.query(INSERT, [
          patients[1],
          doctor,
          dept,
          session,
          DATE2,
          ...slot('10:05', '10:20', DATE2),
        ]),
      );
    const outcome = waiting.then(
      () => ({ code: 'none', constraint: undefined }),
      (err: { code?: string; constraint?: string }) => ({
        code: err.code,
        constraint: err.constraint,
      }),
    );
    // Wait until the second insert is blocked on the first transaction.
    let blocked = false;
    for (let i = 0; i < 100 && !blocked; i += 1) {
      const { rows } = await owner.query<{ blocked: boolean }>(
        'SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked',
        [pid],
      );
      blocked = rows[0]?.blocked === true;
      if (!blocked) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(blocked).toBe(true);
    await first.query('COMMIT');
    expect(await outcome).toEqual({ code: '23P01', constraint: 'appointments_no_doctor_overlap' });
    await second.query('ROLLBACK');
    expect(await bookedAt('10:00', DATE2)).toBe(1);
    expect(await bookedAt('10:05', DATE2)).toBe(0);
  } finally {
    await Promise.all([first.end(), second.end()]);
  }
});
