/**
 * Database-level scheduling rules (migrations 0006 and 0007), tested directly in SQL as
 * hms_app, so they hold even if application code is wrong. Every test rolls back.
 * Synthetic data only. Times are in 2030, so nothing here depends on "now".
 */
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TRANSITIONS,
  type AppointmentStatus,
} from '@hospitalos/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTest, expectSqlError, inRollback } from './test-db.js';

let app!: pg.Client;
beforeAll(async () => {
  app = await connectTest('app');
});
afterAll(async () => {
  await app?.end();
});
const tx = (work: () => Promise<void>) => () => inRollback(app, work);

const one = async (sql: string, params: unknown[] = []) =>
  (await app.query<{ id: string }>(sql, params)).rows[0]!.id;

/** A synthetic department, two doctors with a Monday session, and two patients. */
async function fixture() {
  const dept = await one(
    "INSERT INTO departments (code, name) VALUES ('ZZ_SCHED', 'Zz Scheduling') RETURNING id",
  );
  const doctor = async (no: string) => {
    const emp = await one(
      `INSERT INTO employees (employee_no, full_name, department_id, designation)
       VALUES ($1, 'Dr. Zz', $2, 'Consultant') RETURNING id`,
      [no, dept],
    );
    return one(
      `INSERT INTO doctor_profiles (employee_id, department_id, specialty, registration_no,
         consultation_fee_paise) VALUES ($1, $2, 'Zz', $3, 50000) RETURNING id`,
      [emp, dept, `ZZ-REG-${no}`],
    );
  };
  const patient = (phone: string) =>
    one(
      `INSERT INTO patients (first_name, last_name, dob, sex, phone)
       VALUES ('Zz', 'Patient', '1990-01-01', 'female', $1) RETURNING id`,
      [phone],
    );
  const docA = await doctor('ZZ-SA');
  const docB = await doctor('ZZ-SB');
  const session = await one(
    `INSERT INTO doctor_schedules (doctor_id, weekday, start_time, end_time, slot_minutes, valid_from)
     VALUES ($1, 1, '09:00', '13:00', 15, '2030-01-01') RETURNING id`,
    [docA],
  );
  return {
    dept,
    docA,
    docB,
    session,
    p1: await patient('9000088001'),
    p2: await patient('9000088002'),
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Books a slot on Monday 2030-01-07 (IST) as a raw insert. */
function book(
  f: Fixture,
  {
    patient = f.p1,
    doctor = f.docA,
    start = '09:00',
    end = '09:15',
    date = '2030-01-07',
  }: { patient?: string; doctor?: string; start?: string; end?: string; date?: string } = {},
) {
  return one(
    `INSERT INTO appointments (patient_id, doctor_id, department_id, kind, visit_date, slot_start, slot_end)
     VALUES ($1, $2, $3, 'scheduled', $4::date, ($4 || ' ' || $5 || '+05:30')::timestamptz,
             ($4 || ' ' || $6 || '+05:30')::timestamptz)
     RETURNING id`,
    [patient, doctor, f.dept, date, start, end],
  );
}

const insertSql = (f: Fixture, patient: string, start: string, end: string, doctor = f.docA) =>
  `INSERT INTO appointments (patient_id, doctor_id, department_id, kind, visit_date, slot_start, slot_end)
   VALUES ('${patient}', '${doctor}', '${f.dept}', 'scheduled', '2030-01-07',
           '2030-01-07 ${start}+05:30', '2030-01-07 ${end}+05:30')`;

describe('appointments: no double booking (EXCLUDE constraints)', () => {
  it(
    'refuses an overlapping active appointment for the same doctor, even with a different start',
    tx(async () => {
      const f = await fixture();
      await book(f);
      await expectSqlError(
        app,
        insertSql(f, f.p2, '09:10', '09:25'),
        '23P01',
        /appointments_no_doctor_overlap/,
      );
      await expectSqlError(
        app,
        insertSql(f, f.p2, '09:00', '09:15'),
        '23P01',
        /appointments_no_doctor_overlap/,
      );
    }),
  );

  it(
    'allows back-to-back slots and the same time with another doctor',
    tx(async () => {
      const f = await fixture();
      await book(f);
      await book(f, { patient: f.p2, start: '09:15', end: '09:30' });
      await book(f, { patient: f.p2, doctor: f.docB, start: '09:30', end: '09:45' });
    }),
  );

  it(
    "refuses one patient's overlapping appointments with two doctors",
    tx(async () => {
      const f = await fixture();
      await book(f);
      await expectSqlError(
        app,
        insertSql(f, f.p1, '09:05', '09:20', f.docB),
        '23P01',
        /appointments_no_patient_overlap/,
      );
    }),
  );

  it(
    'frees the slot when the appointment is cancelled (BK-5)',
    tx(async () => {
      const f = await fixture();
      const id = await book(f);
      await app.query(
        "UPDATE appointments SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'Zz test' WHERE id = $1",
        [id],
      );
      await book(f, { patient: f.p2 });
    }),
  );

  it(
    'gives each appointment a unique APT number',
    tx(async () => {
      const f = await fixture();
      const a = await book(f);
      const b = await book(f, { patient: f.p2, start: '09:15', end: '09:30' });
      const { rows } = await app.query<{ appointment_no: string }>(
        'SELECT appointment_no FROM appointments WHERE id = ANY($1) ORDER BY appointment_no',
        [[a, b]],
      );
      expect(rows.map((r) => r.appointment_no)).toEqual([
        expect.stringMatching(/^APT\d{7}$/),
        expect.stringMatching(/^APT\d{7}$/),
      ]);
      expect(rows[0]!.appointment_no).not.toBe(rows[1]!.appointment_no);
    }),
  );
});

describe('appointments: field rules (CHECK constraints)', () => {
  it.each([
    [
      'a scheduled appointment without a slot',
      "kind, visit_date) VALUES ($1, $2, $3, 'scheduled', '2030-01-07')",
      /appointments_walk_in_has_no_slot/,
    ],
    [
      'a walk-in with a slot',
      "kind, visit_date, slot_start, slot_end, status, checked_in_at, token_no) VALUES ($1, $2, $3, 'walk_in', '2030-01-07', '2030-01-07 09:00+05:30', '2030-01-07 09:15+05:30', 'checked_in', now(), 1)",
      /appointments_walk_in_has_no_slot/,
    ],
    [
      'a slot that ends before it starts',
      "kind, visit_date, slot_start, slot_end) VALUES ($1, $2, $3, 'scheduled', '2030-01-07', '2030-01-07 09:15+05:30', '2030-01-07 09:00+05:30')",
      /appointments_slot_order/,
    ],
    [
      'a visit date that is not the slot’s date in India (UTC date given)',
      "kind, visit_date, slot_start, slot_end) VALUES ($1, $2, $3, 'scheduled', '2030-01-06', '2030-01-07 01:00+05:30', '2030-01-07 01:15+05:30')",
      /appointments_slot_on_visit_date/,
    ],
    [
      'a follow-up without the appointment it follows',
      "kind, visit_date, slot_start, slot_end) VALUES ($1, $2, $3, 'follow_up', '2030-01-07', '2030-01-07 09:00+05:30', '2030-01-07 09:15+05:30')",
      /appointments_follow_up_link/,
    ],
    [
      'a walk-in checked in without a token',
      "kind, visit_date, status, checked_in_at) VALUES ($1, $2, $3, 'walk_in', '2030-01-07', 'checked_in', now())",
      /appointments_checked_in_fields/,
    ],
  ])('refuses %s', (_label, rest, constraint) =>
    tx(async () => {
      const f = await fixture();
      await expectSqlError(
        app,
        `INSERT INTO appointments (patient_id, doctor_id, department_id, ${rest}`,
        '23514',
        constraint,
        [f.p1, f.docA, f.dept],
      );
    })(),
  );

  it(
    'refuses two equal tokens for one doctor and day, and a session from another doctor',
    tx(async () => {
      const f = await fixture();
      const walkIn = (token: number) =>
        `INSERT INTO appointments (patient_id, doctor_id, department_id, kind, visit_date, status, checked_in_at, token_no)
         VALUES ('${f.p2}', '${f.docA}', '${f.dept}', 'walk_in', '2030-01-07', 'checked_in', now(), ${token})`;
      await app.query(walkIn(1));
      await expectSqlError(app, walkIn(1), '23505', /appointments_doctor_day_token_key/);
      await expectSqlError(
        app,
        `INSERT INTO appointments (patient_id, doctor_id, department_id, doctor_schedule_id, kind, visit_date, slot_start, slot_end)
         VALUES ('${f.p1}', '${f.docB}', '${f.dept}', '${f.session}', 'scheduled', '2030-01-07', '2030-01-07 09:00+05:30', '2030-01-07 09:15+05:30')`,
        '23503',
        /appointments_schedule_doctor_fk/,
      );
    }),
  );

  it(
    "refuses a follow-up or reschedule link to another patient's appointment",
    tx(async () => {
      const f = await fixture();
      const first = await book(f);
      await expectSqlError(
        app,
        `INSERT INTO appointments (patient_id, doctor_id, department_id, kind, follow_up_of_id, visit_date, slot_start, slot_end)
         VALUES ('${f.p2}', '${f.docA}', '${f.dept}', 'follow_up', '${first}', '2030-01-07', '2030-01-07 10:00+05:30', '2030-01-07 10:15+05:30')`,
        '23503',
        /appointments_follow_up_of_same_patient_fk/,
      );
    }),
  );
});

describe('appointments: a cancellation needs a time and a reason (migration 0008)', () => {
  const cancel = (set: string) =>
    `UPDATE appointments SET status = 'cancelled', ${set} WHERE id = $1`;

  it.each([
    ['without a timestamp', "cancel_reason = 'Zz patient request'"],
    ['without a reason (NULL)', 'cancelled_at = now()'],
    ['with an empty reason', "cancelled_at = now(), cancel_reason = ''"],
    ['with a whitespace-only reason', "cancelled_at = now(), cancel_reason = '   '"],
  ])('refuses a cancellation %s', (_label, set) =>
    tx(async () => {
      const f = await fixture();
      const id = await book(f);
      await expectSqlError(app, cancel(set), '23514', /appointments_cancel/, [id]);
      const { rows } = await app.query('SELECT status FROM appointments WHERE id = $1', [id]);
      expect(rows[0].status).toBe('booked');
    })(),
  );

  it(
    'refuses a NULL reason specifically through appointments_cancel_reason_required',
    tx(async () => {
      // The 0006 check lets this through (NULL result); only the 0008 check catches it.
      const f = await fixture();
      const id = await book(f);
      await expectSqlError(
        app,
        cancel('cancelled_at = now()'),
        '23514',
        /appointments_cancel_reason_required/,
        [id],
      );
    }),
  );

  it(
    'accepts a cancellation with a time and a reason',
    tx(async () => {
      const f = await fixture();
      const id = await book(f);
      await app.query(cancel("cancelled_at = now(), cancel_reason = '  Zz patient request  '"), [
        id,
      ]);
      const { rows } = await app.query('SELECT status FROM appointments WHERE id = $1', [id]);
      expect(rows[0].status).toBe('cancelled');
    }),
  );

  it(
    'does not affect appointments that are not cancelled (no reason needed)',
    tx(async () => {
      const f = await fixture();
      const id = await book(f);
      await app.query(
        "UPDATE appointments SET status = 'checked_in', checked_in_at = now(), token_no = 1 WHERE id = $1",
        [id],
      );
      const { rows } = await app.query(
        'SELECT status, cancel_reason, cancelled_at FROM appointments WHERE id = $1',
        [id],
      );
      expect(rows[0]).toEqual({ status: 'checked_in', cancel_reason: null, cancelled_at: null });
    }),
  );
});

describe('appointments: status machine (trigger) matches the shared transition table', () => {
  /** Puts a fresh appointment into `from` through allowed steps only. */
  async function appointmentIn(f: Fixture, from: AppointmentStatus): Promise<string> {
    const id = await book(f);
    const set = (status: string, extra = '') =>
      app.query(`UPDATE appointments SET status = '${status}'${extra} WHERE id = $1`, [id]);
    const checkIn = () => set('checked_in', ', checked_in_at = now(), token_no = 1');
    if (from === 'checked_in') await checkIn();
    if (from === 'in_consultation') {
      await checkIn();
      await set('in_consultation', ', consult_started_at = now()');
    }
    if (from === 'completed') {
      await checkIn();
      await set('in_consultation');
      await set('completed', ', completed_at = now()');
    }
    if (from === 'cancelled')
      await set('cancelled', ", cancelled_at = now(), cancel_reason = 'Zz'");
    if (from === 'no_show') await set('no_show', ', no_show_at = now()');
    if (from === 'rescheduled') await set('rescheduled');
    return id;
  }

  const FIELDS: Record<AppointmentStatus, string> = {
    booked: '',
    checked_in: ', checked_in_at = now(), token_no = 7',
    in_consultation: ', checked_in_at = now(), token_no = 7',
    completed: ', checked_in_at = now(), token_no = 7, completed_at = now()',
    cancelled: ", cancelled_at = now(), cancel_reason = 'Zz'",
    no_show: ', no_show_at = now()',
    rescheduled: '',
  };

  const pairs = APPOINTMENT_STATUSES.flatMap((from) =>
    APPOINTMENT_STATUSES.filter((to) => to !== from).map((to) => [from, to] as const),
  );

  it.each(pairs)('%s -> %s is allowed exactly when the shared table allows it', (from, to) =>
    tx(async () => {
      const f = await fixture();
      const id = await appointmentIn(f, from);
      const sql = `UPDATE appointments SET status = '${to}'${FIELDS[to]} WHERE id = $1`;
      if (APPOINTMENT_TRANSITIONS[from].includes(to)) {
        await app.query(sql, [id]);
      } else {
        await expectSqlError(app, sql, '23514', /invalid appointment status change/, [id]);
      }
    })(),
  );

  it(
    'refuses new appointments in any status other than booked or checked_in',
    tx(async () => {
      const f = await fixture();
      await expectSqlError(
        app,
        `INSERT INTO appointments (patient_id, doctor_id, department_id, kind, visit_date, slot_start, slot_end, status, checked_in_at, token_no, completed_at)
         VALUES ('${f.p1}', '${f.docA}', '${f.dept}', 'scheduled', '2030-01-07', '2030-01-07 09:00+05:30', '2030-01-07 09:15+05:30', 'completed', now(), 1, now())`,
        '23514',
        /must start as booked or checked_in/,
      );
    }),
  );

  it(
    "never lets an appointment's patient or doctor change",
    tx(async () => {
      const f = await fixture();
      const id = await book(f);
      await expectSqlError(
        app,
        'UPDATE appointments SET patient_id = $2 WHERE id = $1',
        '23514',
        /cannot change/,
        [id, f.p2],
      );
    }),
  );
});

describe('doctor_schedules', () => {
  it(
    'refuses overlapping active sessions on the same weekday, but allows a break between them',
    tx(async () => {
      const f = await fixture();
      const session = (start: string, end: string) =>
        `INSERT INTO doctor_schedules (doctor_id, weekday, start_time, end_time, slot_minutes, valid_from)
         VALUES ('${f.docA}', 1, '${start}', '${end}', 15, '2030-01-01')`;
      await expectSqlError(app, session('12:00', '14:00'), '23P01', /doctor_schedules_no_overlap/);
      await app.query(session('14:00', '17:00')); // after a 13:00–14:00 break
    }),
  );

  it(
    'allows the same hours when the validity periods do not overlap, or the old session is inactive',
    tx(async () => {
      const f = await fixture();
      await app.query(
        `INSERT INTO doctor_schedules (doctor_id, weekday, start_time, end_time, slot_minutes, valid_from, valid_to)
         VALUES ($1, 2, '09:00', '13:00', 15, '2030-01-01', '2030-06-30'),
                ($1, 2, '09:00', '13:00', 20, '2030-07-01', NULL)`,
        [f.docA],
      );
      await app.query('UPDATE doctor_schedules SET active = false WHERE id = $1', [f.session]);
      await app.query(
        `INSERT INTO doctor_schedules (doctor_id, weekday, start_time, end_time, slot_minutes, valid_from)
         VALUES ($1, 1, '09:00', '13:00', 30, '2030-01-01')`,
        [f.docA],
      );
    }),
  );

  it.each([
    ['an end before the start', "'13:00', '09:00', 15"],
    ['a slot longer than the session', "'09:00', '09:10', 15"],
    ['a 3-minute slot', "'09:00', '13:00', 3"],
  ])('refuses %s', (_label, values) =>
    tx(async () => {
      const f = await fixture();
      await expectSqlError(
        app,
        `INSERT INTO doctor_schedules (doctor_id, weekday, start_time, end_time, slot_minutes) VALUES ($1, 3, ${values})`,
        '23514',
        undefined,
        [f.docA],
      );
    })(),
  );

  it(
    'records time off with a valid range only',
    tx(async () => {
      const f = await fixture();
      await app.query(
        `INSERT INTO schedule_exceptions (doctor_id, kind, starts_at, ends_at, reason)
         VALUES ($1, 'leave', '2030-01-07 00:00+05:30', '2030-01-08 00:00+05:30', 'Zz leave')`,
        [f.docA],
      );
      await expectSqlError(
        app,
        `INSERT INTO schedule_exceptions (doctor_id, kind, starts_at, ends_at)
         VALUES ($1, 'holiday', '2030-01-08 00:00+05:30', '2030-01-07 00:00+05:30')`,
        '23514',
        undefined,
        [f.docA],
      );
    }),
  );
});
