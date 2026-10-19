/**
 * Real races through the real API: an HTTP app on a pg pool (hms_app on hms_test), with
 * real sessions and committed transactions, because a race only shows once competing
 * transactions commit.
 *
 * Approved exception to "every database test rolls back" (option A, 2026-10-18):
 *   - Persistent synthetic fixtures, created once and reused on every run: department
 *     ZZ_RACE_API, employee ZZ-RACE-API-REC and REC user zz_race_api_rec. They stay because
 *     the append-only audit rows these tests write reference the user (actor_user_id is
 *     ON DELETE RESTRICT). Foreign keys and audit triggers are not changed for cleanup.
 *   - Audit rows written by the API (login, appointment.created/checked_in/rescheduled and
 *     the invoice.created row of each check-in's draft invoice) stay in hms_test: a fixed
 *     24 per run.
 *   - Everything else this file creates (doctor, schedule, patients, appointments, the
 *     check-ins' draft invoices, sessions) is deleted by ID, as hms_owner, in afterAll.
 * No real patient data. CI runs these on a fresh, disposable database every time.
 */
import { hospitalToday } from '@hospitalos/shared';
import type { Express } from 'express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { appUrl } from '../../db/db-env.js';
import { TEST_PASSWORD, TEST_SESSION_SECRET, connectTest, signIn } from '../../db/test-db.js';
import { createLogger } from '../../lib/logger.js';
import { hashPassword } from '../../lib/password.js';
import { createSession } from '../../middleware/session.js';

const RACERS = 10;
const MONDAY = '2030-01-07';
const NEXT_MONDAY = '2030-01-14';
const at = (time: string, date = MONDAY) => `${date}T${time}:00+05:30`;

let owner!: pg.Client;
let pool!: pg.Pool;
let app!: Express;
let rec!: { cookie: string; csrf: string };
let userId!: string;
let dept!: string;
const created = {
  appointments: [] as string[],
  doctor_schedules: [] as string[],
  doctor_profiles: [] as string[],
  employees: [] as string[],
  patients: [] as string[],
};
const tag = `${process.pid}${Date.now() % 100000}`;
let doctor!: string;
const patients: string[] = [];

const one = async (sql: string, params: unknown[] = []) =>
  (await owner.query<{ id: string }>(sql, params)).rows[0]!.id;

async function make(table: keyof typeof created, sql: string, params: unknown[]) {
  const id = await one(sql, params);
  created[table].push(id);
  return id;
}

/** The persistent fixtures: created on the first run, reused afterwards. */
async function persistentFixtures() {
  await owner.query(
    `INSERT INTO departments (code, name) VALUES ('ZZ_RACE_API', 'Zz Race API (test fixture)')
     ON CONFLICT (code) DO NOTHING`,
  );
  dept = await one("SELECT id FROM departments WHERE code = 'ZZ_RACE_API'");
  await owner.query(
    `INSERT INTO employees (employee_no, full_name, department_id, designation)
     VALUES ('ZZ-RACE-API-REC', 'Zz Race Receptionist', $1, 'Test fixture')
     ON CONFLICT (employee_no) DO NOTHING`,
    [dept],
  );
  const emp = await one("SELECT id FROM employees WHERE employee_no = 'ZZ-RACE-API-REC'");
  await owner.query(
    `INSERT INTO users (employee_id, username, password_hash) VALUES ($1, 'zz_race_api_rec', $2)
     ON CONFLICT DO NOTHING`,
    [emp, await hashPassword(TEST_PASSWORD)],
  );
  userId = await one("SELECT id FROM users WHERE username = 'zz_race_api_rec'");
  await owner.query(
    `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'REC'
     ON CONFLICT DO NOTHING`,
    [userId],
  );
}

beforeAll(async () => {
  owner = await connectTest('owner');
  await persistentFixtures();
  const emp = await make(
    'employees',
    `INSERT INTO employees (employee_no, full_name, department_id, designation)
     VALUES ($1, 'Dr. Zz Race API', $2, 'Consultant') RETURNING id`,
    [`ZZ-RACE-API-DOC-${tag}`, dept],
  );
  doctor = await make(
    'doctor_profiles',
    `INSERT INTO doctor_profiles (employee_id, department_id, specialty, registration_no,
       consultation_fee_paise) VALUES ($1, $2, 'Zz', $3, 50000) RETURNING id`,
    [emp, dept, `ZZ-RACE-API-${tag}`],
  );
  await make(
    'doctor_schedules',
    `INSERT INTO doctor_schedules (doctor_id, weekday, start_time, end_time, slot_minutes, valid_from)
     VALUES ($1, 1, '09:00', '12:00', 15, '2019-01-01') RETURNING id`,
    [doctor],
  );
  for (let i = 0; i < RACERS; i += 1) {
    patients.push(
      await make(
        'patients',
        `INSERT INTO patients (first_name, last_name, dob, sex, phone)
         VALUES ('Zz', 'RaceApi', '1990-01-01', 'female', $1) RETURNING id`,
        [`90000555${String(i).padStart(2, '0')}`],
      ),
    );
  }

  pool = new pg.Pool({ connectionString: appUrl('test').href, max: RACERS + 2 });
  const session = createSession({
    pool,
    secret: TEST_SESSION_SECRET,
    production: false,
    logger: createLogger({ level: 'silent' }),
    prune: false,
  });
  app = createApp({ db: pool, session: session.middleware, loginLimiter: (_q, _s, n) => n() });
  rec = await signIn(app, 'zz_race_api_rec');
});

afterAll(async () => {
  try {
    // Exactly the rows this file created. Check-in charges the consultation on a draft
    // invoice, so those invoices (and their lines) go first, then successor appointments
    // before the appointments they replace.
    if (created.appointments.length > 0) {
      await owner.query(
        `DELETE FROM invoice_items WHERE invoice_id IN
           (SELECT id FROM invoices WHERE appointment_id = ANY($1::uuid[]))`,
        [created.appointments],
      );
      await owner.query('DELETE FROM invoices WHERE appointment_id = ANY($1::uuid[])', [
        created.appointments,
      ]);
      await owner.query(
        `DELETE FROM appointments WHERE id = ANY($1::uuid[]) AND rescheduled_from_id IS NOT NULL`,
        [created.appointments],
      );
    }
    for (const table of Object.keys(created) as (keyof typeof created)[]) {
      if (created[table].length > 0) {
        await owner.query(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [created[table]]);
      }
    }
    if (userId) {
      await owner.query("DELETE FROM sessions WHERE sess->>'userId' = $1", [userId]);
    }
  } finally {
    await pool?.end();
    await owner?.end();
  }
});

const post = (path: string, body: object = {}) =>
  request(app).post(path).set('Cookie', rec.cookie).set('X-CSRF-Token', rec.csrf).send(body);

/** Appointments of the race doctor that this file has not recorded yet. */
async function collectAppointments() {
  const { rows } = await owner.query<{ id: string }>(
    'SELECT id FROM appointments WHERE doctor_id = $1 AND id <> ALL($2::uuid[])',
    [doctor, created.appointments],
  );
  created.appointments.push(...rows.map((r) => r.id));
}

async function auditCount(action: string, ids: string[]) {
  const { rows } = await owner.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM audit_logs WHERE action = $1 AND entity_id = ANY($2::text[])',
    [action, ids],
  );
  return rows[0]!.n;
}

/** A booked appointment written directly (a fixture, not the thing under test). */
function fixtureBooking(patient: string, date: string, start: string, minutes = 15) {
  return make(
    'appointments',
    `INSERT INTO appointments (patient_id, doctor_id, department_id, kind, visit_date,
       slot_start, slot_end)
     VALUES ($1, $2, $3, 'scheduled', $4::date, ($4 || ' ' || $5 || '+05:30')::timestamptz,
             ($4 || ' ' || $5 || '+05:30')::timestamptz + make_interval(mins => $6))
     RETURNING id`,
    [patient, doctor, dept, date, start, minutes],
  );
}

describe('races through the API (committed, hms_test)', () => {
  it('10 simultaneous bookings of one slot: exactly one 201 and nine 409 SLOT_TAKEN', async () => {
    const results = await Promise.all(
      patients.map((patientId) =>
        post('/api/appointments', {
          kind: 'scheduled',
          patientId,
          doctorId: doctor,
          slotStart: at('09:00'),
        }),
      ),
    );
    await collectAppointments();
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, ...Array<number>(RACERS - 1).fill(409)]);
    for (const r of results.filter((x) => x.status === 409)) {
      expect(r.body.error.code).toBe('SLOT_TAKEN');
    }
    const { rows } = await owner.query(
      "SELECT id FROM appointments WHERE doctor_id = $1 AND status = 'booked' AND slot_start = $2",
      [doctor, at('09:00')],
    );
    expect(rows).toHaveLength(1);
    // One success audit row, for the one booking that exists; none for the refusals.
    const { rows: audit } = await owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_logs
       WHERE action = 'appointment.created' AND patient_id = ANY($1::uuid[])`,
      [patients],
    );
    expect(audit[0]!.n).toBe(1);
  });

  it('10 simultaneous check-ins for one doctor and day: tokens 1–10, no gaps or repeats', async () => {
    const today = hospitalToday();
    const ids = [];
    for (let i = 0; i < RACERS; i += 1) {
      const minute = String(i * 5).padStart(2, '0');
      ids.push(await fixtureBooking(patients[i]!, today, `00:${minute}`, 5));
    }
    const results = await Promise.all(ids.map((id) => post(`/api/appointments/${id}/check-in`)));
    expect(results.map((r) => r.status)).toEqual(Array<number>(RACERS).fill(200));
    const { rows } = await owner.query<{ token_no: number }>(
      'SELECT token_no FROM appointments WHERE id = ANY($1::uuid[]) ORDER BY token_no',
      [ids],
    );
    expect(rows.map((r) => r.token_no)).toEqual(Array.from({ length: RACERS }, (_, i) => i + 1));
    expect(await auditCount('appointment.checked_in', ids)).toBe(RACERS);
  });

  it('2 simultaneous reschedules into the same slot: one succeeds, the loser keeps its booking', async () => {
    const x = await fixtureBooking(patients[0]!, NEXT_MONDAY, '09:00');
    const y = await fixtureBooking(patients[1]!, NEXT_MONDAY, '09:15');
    const results = await Promise.all(
      [x, y].map((id) =>
        post(`/api/appointments/${id}/reschedule`, { slotStart: at('10:00', NEXT_MONDAY) }),
      ),
    );
    await collectAppointments();
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('SLOT_TAKEN');
    const { rows } = await owner.query<{ id: string; status: string }>(
      'SELECT id, status FROM appointments WHERE id = ANY($1::uuid[]) ORDER BY status',
      [[x, y]],
    );
    expect(rows.map((r) => r.status)).toEqual(['booked', 'rescheduled']);
    expect(await auditCount('appointment.rescheduled', [x, y])).toBe(1);
  });

  it('2 simultaneous reschedules of one appointment: exactly one succeeds', async () => {
    const z = await fixtureBooking(patients[2]!, NEXT_MONDAY, '09:30');
    const results = await Promise.all(
      ['11:00', '11:15'].map((t) =>
        post(`/api/appointments/${z}/reschedule`, { slotStart: at(t, NEXT_MONDAY) }),
      ),
    );
    await collectAppointments();
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('INVALID_TRANSITION');
    const { rows } = await owner.query(
      "SELECT 1 FROM appointments WHERE rescheduled_from_id = $1 AND status = 'booked'",
      [z],
    );
    expect(rows).toHaveLength(1);
    expect(await auditCount('appointment.rescheduled', [z])).toBe(1);
  });
});
