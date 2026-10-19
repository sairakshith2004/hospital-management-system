/**
 * The scheduling API through real HTTP requests, each test inside one rolled-back
 * transaction on hms_test. Synthetic data only. Bookable dates are in 2030, so nothing
 * depends on "now" except check-in and no-show, which use today's date on purpose.
 */
import { hospitalToday } from '@hospitalos/shared';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database, TxClient } from '../../db/client.js';
import {
  TEST_PASSWORD,
  connectTest,
  createTestApp,
  createTestUser,
  inRollback,
  signIn,
  transactionalDb,
} from '../../db/test-db.js';
import { hashPassword } from '../../lib/password.js';
import { checkIn, rescheduleAppointment } from './scheduling.service.js';

let client!: pg.Client;
let passwordHash!: string;
beforeAll(async () => {
  client = await connectTest('app');
  passwordHash = await hashPassword(TEST_PASSWORD);
});
afterAll(async () => {
  await client?.end();
});
const tx = (work: () => Promise<void>) => () => inRollback(client, work);

const MONDAY = '2030-01-07';
const at = (time: string, date = MONDAY) => `${date}T${time}:00+05:30`;
const iso = (time: string, date = MONDAY) => new Date(at(time, date)).toISOString();
const CTX = { requestId: null, ip: null };

const one = async (sql: string, params: unknown[] = []) =>
  (await client.query<{ id: string }>(sql, params)).rows[0]!.id;

let seq = 0;

/** A doctor with a Monday 09:00–12:00 session of 15-minute slots, and a DOC login. */
async function doctor(dept: string, label: string) {
  seq += 1;
  const tag = `${label}${seq}`;
  const emp = await one(
    `INSERT INTO employees (employee_no, full_name, department_id, designation)
     VALUES ($1, $2, $3, 'Consultant') RETURNING id`,
    [`ZZ-SCH-${tag}`, `Dr. Zz ${label}`, dept],
  );
  const id = await one(
    `INSERT INTO doctor_profiles (employee_id, department_id, specialty, registration_no,
       consultation_fee_paise) VALUES ($1, $2, 'Zz', $3, 50000) RETURNING id`,
    [emp, dept, `ZZ-SCH-REG-${tag}`],
  );
  const schedule = await one(
    `INSERT INTO doctor_schedules (doctor_id, weekday, start_time, end_time, slot_minutes, valid_from)
     VALUES ($1, 1, '09:00', '12:00', 15, '2019-01-01') RETURNING id`,
    [id],
  );
  const username = `zz_sch_doc_${tag}`.toLowerCase();
  const user = await one(
    'INSERT INTO users (employee_id, username, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [emp, username, passwordHash],
  );
  await client.query(
    "INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'DOC'",
    [user],
  );
  return { id, schedule, username, userId: user };
}

async function setup() {
  const { app, db } = createTestApp(client);
  const dept = await one(
    "INSERT INTO departments (code, name) VALUES ('ZZ_SCHAPI', 'Zz Scheduling API') RETURNING id",
  );
  const docA = await doctor(dept, 'A');
  const docB = await doctor(dept, 'B');
  const patient = (n: number) =>
    one(
      `INSERT INTO patients (first_name, last_name, dob, sex, phone)
       VALUES ('Zz', $1, '1990-01-01', 'female', $2) RETURNING id`,
      [`Patient${n}`, `90000661${String(n).padStart(2, '0')}`],
    );
  const patients = [await patient(1), await patient(2), await patient(3), await patient(4)];

  const as = async (rolesOrUsername: string[] | string) => {
    const username = Array.isArray(rolesOrUsername)
      ? (await createTestUser(db, { roles: rolesOrUsername })).username
      : rolesOrUsername;
    const s = await signIn(app, username);
    return {
      get: (path: string) => request(app).get(path).set('Cookie', s.cookie),
      post: (path: string, body: object = {}) =>
        request(app).post(path).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).send(body),
      patch: (path: string, body: object = {}) =>
        request(app).patch(path).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).send(body),
      postWithoutCsrf: (path: string, body: object = {}) =>
        request(app).post(path).set('Cookie', s.cookie).send(body),
    };
  };
  const rec = await as(['REC']);
  const book = (patientId: string, time: string, doctorId = docA.id, date = MONDAY) =>
    rec.post('/api/appointments', {
      kind: 'scheduled',
      patientId,
      doctorId,
      slotStart: at(time, date),
    });
  return { app, db, dept, docA, docB, patients, as, rec, book };
}

/** A booked appointment for today (a fixture row; booking today depends on the clock). */
async function bookedToday(
  doctorId: string,
  dept: string,
  patientId: string,
  time = '23:00',
  minutes = 15,
) {
  const today = hospitalToday();
  return one(
    `INSERT INTO appointments (patient_id, doctor_id, department_id, kind, visit_date,
       slot_start, slot_end)
     VALUES ($1, $2, $3, 'scheduled', $4::date, ($4 || ' ' || $5 || '+05:30')::timestamptz,
             ($4 || ' ' || $5 || '+05:30')::timestamptz + make_interval(mins => $6))
     RETURNING id`,
    [patientId, doctorId, dept, today, time, minutes],
  );
}

async function auditRows(action: string, entityId?: string) {
  const { rows } = await client.query<{
    actor_user_id: string | null;
    entity_id: string | null;
    patient_id: string | null;
    reason: string | null;
    changes: Record<string, unknown> | null;
  }>(
    `SELECT actor_user_id, entity_id, patient_id, reason, changes FROM audit_logs
     WHERE action = $1 AND occurred_at = now() AND ($2::text IS NULL OR entity_id = $2)
     ORDER BY id`,
    [action, entityId ?? null],
  );
  return rows;
}

async function status(id: string) {
  const { rows } = await client.query<{ status: string; token_no: number | null }>(
    'SELECT status, token_no FROM appointments WHERE id = $1',
    [id],
  );
  return rows[0];
}

/** A Database like the test one, except that writing an audit row fails. */
function failingAuditDb(): Database {
  const base = transactionalDb(client);
  return {
    query: base.query,
    connect: async () => {
      const inner = await base.connect();
      const wrapped: TxClient = {
        query: ((text: string, params?: unknown[]) =>
          text.includes('INSERT INTO audit_logs')
            ? Promise.reject(new Error('injected audit failure'))
            : inner.query(text, params)) as TxClient['query'],
        release: inner.release,
      };
      return wrapped;
    },
  };
}

describe('GET /api/doctors/:id/availability', () => {
  it(
    'lists the session slots and marks taken, blocked and past slots unavailable',
    tx(async () => {
      const f = await setup();
      expect((await f.book(f.patients[0]!, '09:15')).status).toBe(201);
      await client.query(
        `INSERT INTO schedule_exceptions (doctor_id, kind, starts_at, ends_at)
         VALUES ($1, 'leave', $2, $3)`,
        [f.docA.id, at('11:00'), at('12:00')],
      );
      const res = await f.rec.get(`/api/doctors/${f.docA.id}/availability?date=${MONDAY}`);
      expect(res.status).toBe(200);
      const slots = res.body.slots as { slotStart: string; available: boolean }[];
      expect(slots).toHaveLength(12);
      expect(slots[0]).toEqual({
        scheduleId: f.docA.schedule,
        slotStart: iso('09:00'),
        slotEnd: iso('09:15'),
        available: true,
      });
      const unavailable = slots.filter((s) => !s.available).map((s) => s.slotStart);
      expect(unavailable).toEqual([
        iso('09:15'),
        iso('11:00'),
        iso('11:15'),
        iso('11:30'),
        iso('11:45'),
      ]);
      // No patient data in availability.
      expect(JSON.stringify(res.body)).not.toContain(f.patients[0]);

      const tuesday = await f.rec.get(`/api/doctors/${f.docA.id}/availability?date=2030-01-08`);
      expect(tuesday.body.slots).toEqual([]);
      const past = await f.rec.get(`/api/doctors/${f.docA.id}/availability?date=2020-01-06`);
      expect(past.body.slots).toHaveLength(12);
      expect(past.body.slots.every((s: { available: boolean }) => !s.available)).toBe(true);
    }),
  );

  it(
    'only generates whole slots, and 404s for unknown doctors',
    tx(async () => {
      const f = await setup();
      await client.query(
        `INSERT INTO doctor_schedules (doctor_id, weekday, start_time, end_time, slot_minutes, valid_from)
         VALUES ($1, 2, '14:00', '14:40', 15, '2019-01-01')`,
        [f.docA.id],
      );
      const res = await f.rec.get(`/api/doctors/${f.docA.id}/availability?date=2030-01-08`);
      expect(res.body.slots.map((s: { slotStart: string }) => s.slotStart)).toEqual([
        iso('14:00', '2030-01-08'),
        iso('14:15', '2030-01-08'),
      ]);
      const unknown = await f.rec.get(
        `/api/doctors/7d3c2a59-2b0c-4a43-9e3b-1d2f0c9a1b23/availability?date=${MONDAY}`,
      );
      expect(unknown.status).toBe(404);
      expect((await f.rec.get(`/api/doctors/${f.docA.id}/availability`)).status).toBe(422);
    }),
  );
});

describe('POST /api/appointments (booking and walk-ins)', () => {
  it(
    'books a slot, returns scheduling fields only and writes one audit row',
    tx(async () => {
      const f = await setup();
      const res = await f.book(f.patients[0]!, '09:00');
      expect(res.status).toBe(201);
      const a = res.body.appointment;
      expect(a).toMatchObject({
        kind: 'scheduled',
        status: 'booked',
        visitDate: MONDAY,
        slotStart: iso('09:00'),
        slotEnd: iso('09:15'),
        tokenNo: null,
        doctor: { id: f.docA.id, fullName: 'Dr. Zz A' },
      });
      expect(a.appointmentNo).toMatch(/^APT\d{7}$/);
      expect(Object.keys(a.patient).sort()).toEqual(['firstName', 'id', 'lastName', 'mrn']);
      expect(await auditRows('appointment.created', a.id)).toEqual([
        expect.objectContaining({
          patient_id: f.patients[0],
          changes: { kind: 'scheduled', doctorId: f.docA.id },
        }),
      ]);
    }),
  );

  it(
    'refuses taken slots, overlapping patients, same-day duplicates, non-slots, past and blocked slots, with no audit row',
    tx(async () => {
      const f = await setup();
      const [p1, p2] = f.patients as [string, string];
      expect((await f.book(p1, '09:00')).status).toBe(201);
      const expectError = async (res: request.Response, status: number, code: string) => {
        expect(res.status, code).toBe(status);
        expect(res.body.error.code).toBe(code);
      };
      await expectError(await f.book(p2, '09:00'), 409, 'SLOT_TAKEN');
      await expectError(await f.book(p1, '09:00', f.docB.id), 409, 'PATIENT_BUSY');
      await expectError(await f.book(p1, '10:00'), 409, 'ALREADY_BOOKED');
      await expectError(await f.book(p2, '09:05'), 422, 'NOT_A_SLOT');
      await expectError(await f.book(p2, '12:00'), 422, 'NOT_A_SLOT');
      await expectError(await f.book(p2, '09:00', f.docA.id, '2030-01-08'), 422, 'NOT_A_SLOT');
      await expectError(await f.book(p2, '09:00', f.docA.id, '2020-01-06'), 422, 'SLOT_IN_PAST');
      await client.query(
        `INSERT INTO schedule_exceptions (doctor_id, kind, starts_at, ends_at)
         VALUES ($1, 'blocked', $2, $3)`,
        [f.docA.id, at('10:00'), at('10:30')],
      );
      await expectError(await f.book(p2, '10:15'), 409, 'DOCTOR_UNAVAILABLE');
      await expectError(
        await f.book('7d3c2a59-2b0c-4a43-9e3b-1d2f0c9a1b23', '11:00'),
        422,
        'UNKNOWN_PATIENT',
      );
      await expectError(
        await f.rec.post('/api/appointments', { kind: 'scheduled', patientId: p2 }),
        422,
        'VALIDATION_FAILED',
      );
      expect(await auditRows('appointment.created')).toHaveLength(1);
    }),
  );

  it(
    'registers walk-ins as checked in with the next token, once per patient and doctor per day',
    tx(async () => {
      const f = await setup();
      const walkIn = (patientId: string) =>
        f.rec.post('/api/appointments', { kind: 'walk_in', patientId, doctorId: f.docA.id });
      const first = await walkIn(f.patients[0]!);
      expect(first.status).toBe(201);
      expect(first.body.appointment).toMatchObject({
        kind: 'walk_in',
        status: 'checked_in',
        visitDate: hospitalToday(),
        slotStart: null,
        tokenNo: 1,
      });
      expect((await walkIn(f.patients[1]!)).body.appointment.tokenNo).toBe(2);
      const again = await walkIn(f.patients[0]!);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('ALREADY_BOOKED');
      expect(await auditRows('appointment.created')).toHaveLength(2);
    }),
  );
});

describe('POST /api/appointments/:id/cancel', () => {
  it(
    'needs a reason, frees the slot, audits without the reason text, and is final',
    tx(async () => {
      const f = await setup();
      const id = (await f.book(f.patients[0]!, '09:00')).body.appointment.id as string;
      expect((await f.rec.post(`/api/appointments/${id}/cancel`, { reason: '  ' })).status).toBe(
        422,
      );
      const res = await f.rec.post(`/api/appointments/${id}/cancel`, {
        reason: 'Zz synthetic reason',
      });
      expect(res.status).toBe(200);
      expect(res.body.appointment).toMatchObject({
        status: 'cancelled',
        cancelReason: 'Zz synthetic reason',
      });
      const audit = await auditRows('appointment.cancelled', id);
      expect(audit).toHaveLength(1);
      expect(audit[0]!.changes).toEqual({ fromStatus: 'booked', fields: 'cancel_reason' });
      expect(JSON.stringify(audit)).not.toContain('synthetic reason');
      expect((await f.book(f.patients[1]!, '09:00')).status).toBe(201);
      const again = await f.rec.post(`/api/appointments/${id}/cancel`, { reason: 'again' });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('INVALID_TRANSITION');
      expect(await auditRows('appointment.cancelled', id)).toHaveLength(1);
    }),
  );

  it(
    'cancels a checked-in appointment, and 404s for unknown or malformed IDs',
    tx(async () => {
      const f = await setup();
      const id = await bookedToday(f.docA.id, f.dept, f.patients[0]!);
      expect((await f.rec.post(`/api/appointments/${id}/check-in`)).status).toBe(200);
      const res = await f.rec.post(`/api/appointments/${id}/cancel`, { reason: 'Left' });
      expect(res.body.appointment.status).toBe('cancelled');
      for (const bad of ['7d3c2a59-2b0c-4a43-9e3b-1d2f0c9a1b23', 'nope']) {
        const r = await f.rec.post(`/api/appointments/${bad}/cancel`, { reason: 'x' });
        expect(r.status).toBe(404);
      }
    }),
  );
});

describe('POST /api/appointments/:id/reschedule', () => {
  it(
    'moves the booking in one step: original rescheduled, successor linked, old slot free',
    tx(async () => {
      const f = await setup();
      const id = (await f.book(f.patients[0]!, '09:00')).body.appointment.id as string;
      const res = await f.rec.post(`/api/appointments/${id}/reschedule`, {
        slotStart: at('10:00'),
      });
      expect(res.status).toBe(201);
      expect(res.body.appointment).toMatchObject({
        status: 'booked',
        slotStart: iso('10:00'),
        rescheduledFromId: id,
      });
      expect((await status(id))!.status).toBe('rescheduled');
      expect(await auditRows('appointment.rescheduled', id)).toEqual([
        expect.objectContaining({
          patient_id: f.patients[0],
          changes: {
            fromStatus: 'booked',
            successorId: res.body.appointment.id,
            doctorId: f.docA.id,
          },
        }),
      ]);
      expect((await f.book(f.patients[1]!, '09:00')).status).toBe(201);
      // A rescheduled appointment can't be moved again; its successor can.
      const again = await f.rec.post(`/api/appointments/${id}/reschedule`, {
        slotStart: at('10:30'),
      });
      expect(again.body.error.code).toBe('INVALID_TRANSITION');
    }),
  );

  it(
    'into an occupied slot: 409, and the original appointment and slot are unchanged',
    tx(async () => {
      const f = await setup();
      const id = (await f.book(f.patients[0]!, '09:00')).body.appointment.id as string;
      expect((await f.book(f.patients[1]!, '10:00')).status).toBe(201);
      const res = await f.rec.post(`/api/appointments/${id}/reschedule`, {
        slotStart: at('10:00'),
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SLOT_TAKEN');
      const original = await f.rec.get(`/api/appointments/${id}`);
      expect(original.body.appointment).toMatchObject({
        status: 'booked',
        slotStart: iso('09:00'),
      });
      const { rows } = await client.query(
        'SELECT 1 FROM appointments WHERE rescheduled_from_id = $1',
        [id],
      );
      expect(rows).toHaveLength(0);
      expect(await auditRows('appointment.rescheduled')).toHaveLength(0);
    }),
  );

  it(
    'refuses a reschedule into the same slot, changing nothing',
    tx(async () => {
      const f = await setup();
      const id = (await f.book(f.patients[0]!, '09:00')).body.appointment.id as string;
      const res = await f.rec.post(`/api/appointments/${id}/reschedule`, {
        slotStart: at('09:00'),
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SAME_SLOT');
      expect((await status(id))!.status).toBe('booked');
      const { rows } = await client.query(
        'SELECT 1 FROM appointments WHERE rescheduled_from_id = $1',
        [id],
      );
      expect(rows).toHaveLength(0);
      expect(await auditRows('appointment.rescheduled')).toHaveLength(0);
      // The same time with another doctor is a real move.
      const moved = await f.rec.post(`/api/appointments/${id}/reschedule`, {
        slotStart: at('09:00'),
        doctorId: f.docB.id,
      });
      expect(moved.status).toBe(201);
    }),
  );

  it(
    'rolls back completely when a later step (the audit write) fails',
    tx(async () => {
      const f = await setup();
      const id = (await f.book(f.patients[0]!, '09:00')).body.appointment.id as string;
      await expect(
        rescheduleAppointment(
          failingAuditDb(),
          id,
          { slotStart: at('10:00') },
          { userId: f.docA.userId },
          CTX,
        ),
      ).rejects.toThrow('injected audit failure');
      expect((await status(id))!.status).toBe('booked');
      const { rows } = await client.query(
        'SELECT 1 FROM appointments WHERE rescheduled_from_id = $1 OR slot_start = $2',
        [id, at('10:00')],
      );
      expect(rows).toHaveLength(0);
    }),
  );

  it(
    'needs appointment:reschedule: book and cancel are not enough',
    tx(async () => {
      const f = await setup();
      const id = (await f.book(f.patients[0]!, '09:00')).body.appointment.id as string;
      const role = await one(
        "INSERT INTO roles (code, name) VALUES ('ZZ_BOOKER', 'Zz booker') RETURNING id",
      );
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE code IN ('appointment:book', 'appointment:cancel')`,
        [role],
      );
      const booker = await f.as(['ZZ_BOOKER']);
      const res = await booker.post(`/api/appointments/${id}/reschedule`, {
        slotStart: at('10:00'),
      });
      expect(res.status).toBe(403);
      expect((await status(id))!.status).toBe('booked');
      expect(await auditRows('access.denied')).toEqual([
        expect.objectContaining({
          entity_id: 'POST /api/appointments/:id/reschedule',
          changes: { permission: 'appointment:reschedule' },
        }),
      ]);
    }),
  );
});

describe('POST /api/appointments/:id/check-in and /no-show', () => {
  it(
    "checks today's appointments in with gap-free tokens per doctor, and audits each",
    tx(async () => {
      const f = await setup();
      const a1 = await bookedToday(f.docA.id, f.dept, f.patients[0]!, '23:00');
      const a2 = await bookedToday(f.docA.id, f.dept, f.patients[1]!, '23:15');
      const b1 = await bookedToday(f.docB.id, f.dept, f.patients[2]!, '23:00');
      const tokens = [];
      for (const id of [a1, a2, b1]) {
        const res = await f.rec.post(`/api/appointments/${id}/check-in`);
        expect(res.status).toBe(200);
        expect(res.body.appointment.status).toBe('checked_in');
        tokens.push(res.body.appointment.tokenNo);
      }
      expect(tokens).toEqual([1, 2, 1]);
      expect(await auditRows('appointment.checked_in', a2)).toEqual([
        expect.objectContaining({ changes: { fromStatus: 'booked', queueNo: 2 } }),
      ]);
      const twice = await f.rec.post(`/api/appointments/${a1}/check-in`);
      expect(twice.status).toBe(409);
      expect(twice.body.error.code).toBe('INVALID_TRANSITION');
    }),
  );

  it(
    'does not consume a token when the check-in rolls back',
    tx(async () => {
      const f = await setup();
      const a1 = await bookedToday(f.docA.id, f.dept, f.patients[0]!, '23:00');
      const a2 = await bookedToday(f.docA.id, f.dept, f.patients[1]!, '23:15');
      await expect(checkIn(failingAuditDb(), a1, { userId: f.docA.userId }, CTX)).rejects.toThrow(
        'injected audit failure',
      );
      expect(await status(a1)).toEqual({ status: 'booked', token_no: null });
      expect((await f.rec.post(`/api/appointments/${a2}/check-in`)).body.appointment.tokenNo).toBe(
        1,
      );
    }),
  );

  it(
    'refuses to check in a future appointment, and marks no-shows only for booked, non-future ones',
    tx(async () => {
      const f = await setup();
      const future = (await f.book(f.patients[0]!, '09:00')).body.appointment.id as string;
      const notToday = await f.rec.post(`/api/appointments/${future}/check-in`);
      expect(notToday.body.error.code).toBe('NOT_TODAY');
      const early = await f.rec.post(`/api/appointments/${future}/no-show`);
      expect(early.body.error.code).toBe('NOT_YET');
      const today = await bookedToday(f.docA.id, f.dept, f.patients[1]!);
      const res = await f.rec.post(`/api/appointments/${today}/no-show`);
      expect(res.status).toBe(200);
      expect(res.body.appointment.status).toBe('no_show');
      expect(await auditRows('appointment.no_show', today)).toHaveLength(1);
      const later = await f.rec.post(`/api/appointments/${today}/check-in`);
      expect(later.body.error.code).toBe('INVALID_TRANSITION');
    }),
  );
});

describe('appointment and queue visibility (doctor scope)', () => {
  async function scoped() {
    const f = await setup();
    const a1 = await bookedToday(f.docA.id, f.dept, f.patients[0]!, '23:00');
    const b1 = await bookedToday(f.docB.id, f.dept, f.patients[1]!, '23:00');
    for (const id of [a1, b1]) await f.rec.post(`/api/appointments/${id}/check-in`);
    return { ...f, a1, b1, docAClient: await f.as(f.docA.username) };
  }

  it(
    "shows a doctor only their own queue, list and records; another doctor's are 404 and audited",
    tx(async () => {
      const f = await scoped();
      const today = hospitalToday();
      const queue = await f.docAClient.get('/api/queue');
      expect(queue.status).toBe(200);
      expect(queue.body.queue.map((a: { id: string }) => a.id)).toEqual([f.a1]);
      const list = await f.docAClient.get(`/api/appointments?date=${today}`);
      expect(list.body.appointments.map((a: { id: string }) => a.id)).toEqual([f.a1]);
      expect((await f.docAClient.get(`/api/appointments/${f.a1}`)).status).toBe(200);

      const other = await f.docAClient.get(`/api/appointments/${f.b1}`);
      const unknown = await f.docAClient.get(
        '/api/appointments/7d3c2a59-2b0c-4a43-9e3b-1d2f0c9a1b23',
      );
      expect(other.status).toBe(404);
      expect({ ...other.body.error, requestId: 'x' }).toEqual({
        ...unknown.body.error,
        requestId: 'x',
      });
      const otherQueue = await f.docAClient.get(`/api/queue?doctorId=${f.docB.id}`);
      expect(otherQueue.status).toBe(404);
      expect(JSON.stringify(otherQueue.body)).not.toContain(f.b1);
      const otherList = await f.docAClient.get(
        `/api/appointments?date=${today}&doctorId=${f.docB.id}`,
      );
      expect(otherList.status).toBe(404);
      const denied = await auditRows('access.denied');
      expect(denied.map((r) => [r.entity_id, r.reason])).toEqual([
        [f.b1, 'other_doctor'],
        [f.docB.id, 'other_doctor'],
        [f.docB.id, 'other_doctor'],
      ]);
    }),
  );

  it(
    'lets REC and ADM (appointment:read_all) see every doctor; NUR without a doctor profile gets 403',
    tx(async () => {
      const f = await scoped();
      for (const roles of [['REC'], ['ADM']]) {
        const user = await f.as(roles);
        const queue = await user.get('/api/queue');
        expect(queue.status, roles[0]).toBe(200);
        expect(queue.body.queue.map((a: { id: string }) => a.id).sort()).toEqual(
          [f.a1, f.b1].sort(),
        );
        const one = await user.get(`/api/queue?doctorId=${f.docB.id}`);
        expect(one.body.queue.map((a: { id: string }) => a.id)).toEqual([f.b1]);
        expect((await user.get(`/api/appointments/${f.b1}`)).status).toBe(200);
      }
      const nurse = await f.as(['NUR']);
      expect((await nurse.get('/api/queue')).status).toBe(403);
      expect((await nurse.get(`/api/appointments/${f.a1}`)).status).toBe(403);
      // Those refusals are audited like every other 403.
      const noProfile = (await auditRows('access.denied')).filter(
        (r) => r.reason === 'no_doctor_profile',
      );
      expect(noProfile.map((r) => r.entity_id)).toEqual([
        'GET /api/queue/',
        'GET /api/appointments/:id',
      ]);
      const mkt = await f.as(['MKT']);
      expect((await mkt.get('/api/queue')).status).toBe(403);
      expect((await mkt.get(`/api/appointments?date=${hospitalToday()}`)).status).toBe(403);
    }),
  );

  it(
    'returns no contact or clinical fields in lists and the queue',
    tx(async () => {
      const f = await scoped();
      const rec = await f.as(['REC']);
      const list = await rec.get(`/api/appointments?date=${hospitalToday()}`);
      const body = JSON.stringify(list.body);
      expect(body).not.toMatch(/phone|dob|email|address|bloodGroup|9000066/);
      expect(Object.keys(list.body.appointments[0]).sort()).toEqual([
        'appointmentNo',
        'checkedInAt',
        'departmentId',
        'doctor',
        'id',
        'kind',
        'patient',
        'rescheduledFromId',
        'slotEnd',
        'slotStart',
        'status',
        'tokenNo',
        'visitDate',
      ]);
    }),
  );
});

describe('authorization of every scheduling route', () => {
  const ID = '7d3c2a59-2b0c-4a43-9e3b-1d2f0c9a1b23';
  const writes: [string, string][] = [
    ['/api/appointments', 'appointment:book'],
    [`/api/appointments/${ID}/cancel`, 'appointment:cancel'],
    [`/api/appointments/${ID}/reschedule`, 'appointment:reschedule'],
    [`/api/appointments/${ID}/check-in`, 'appointment:check_in'],
    [`/api/appointments/${ID}/no-show`, 'appointment:mark_no_show'],
  ];

  it(
    'answers 401 when signed out',
    tx(async () => {
      const { app } = createTestApp(client);
      for (const path of [
        '/api/queue',
        '/api/appointments?date=2030-01-07',
        `/api/appointments/${ID}`,
        `/api/doctors/${ID}/availability?date=2030-01-07`,
        `/api/doctors/${ID}/schedules`,
      ]) {
        expect((await request(app).get(path)).status, path).toBe(401);
      }
    }),
  );

  it(
    'refuses every appointment write to DOC, NUR, ADM and MKT, with an access.denied row each',
    tx(async () => {
      const f = await setup();
      for (const role of ['DOC', 'NUR', 'ADM', 'MKT']) {
        const user = await f.as([role]);
        for (const [path] of writes) {
          expect((await user.post(path, {})).status, `${role} ${path}`).toBe(403);
        }
      }
      const denied = await auditRows('access.denied');
      expect(denied).toHaveLength(4 * writes.length);
      expect(new Set(denied.map((r) => r.changes!.permission))).toEqual(
        new Set(writes.map(([, p]) => p)),
      );
    }),
  );

  it(
    'refuses writes without a CSRF token, changing nothing',
    tx(async () => {
      const f = await setup();
      const res = await (
        await f.as(['REC'])
      ).postWithoutCsrf('/api/appointments', {
        kind: 'scheduled',
        patientId: f.patients[0],
        doctorId: f.docA.id,
        slotStart: at('09:00'),
      });
      expect(res.status).toBe(403);
      expect(await auditRows('appointment.created')).toHaveLength(0);
    }),
  );
});

describe('doctor schedules', () => {
  it(
    'lets ADM add and deactivate sessions (audited), refuses overlaps, and refuses REC',
    tx(async () => {
      const f = await setup();
      const adm = await f.as(['ADM']);
      const body = {
        weekday: 2,
        startTime: '09:00',
        endTime: '11:00',
        slotMinutes: 20,
        validFrom: '2030-01-01',
      };
      const created = await adm.post(`/api/doctors/${f.docA.id}/schedules`, body);
      expect(created.status).toBe(201);
      const scheduleId = created.body.schedule.id as string;
      expect(await auditRows('schedule.created', scheduleId)).toHaveLength(1);
      const overlap = await adm.post(`/api/doctors/${f.docA.id}/schedules`, {
        ...body,
        startTime: '10:00',
        endTime: '12:00',
      });
      expect(overlap.status).toBe(409);
      expect(overlap.body.error.code).toBe('SCHEDULE_OVERLAP');
      // Passes the request schema, but the database's fits-one-slot check refuses it.
      const tooShort = await adm.post(`/api/doctors/${f.docA.id}/schedules`, {
        ...body,
        weekday: 3,
        startTime: '09:00',
        endTime: '09:10',
        slotMinutes: 15,
      });
      expect(tooShort.status).toBe(422);
      expect(tooShort.body.error.code).toBe('INVALID_SCHEDULE');
      expect(await auditRows('schedule.created')).toHaveLength(1);
      const off = await adm.patch(`/api/doctors/${f.docA.id}/schedules/${scheduleId}`, {
        active: false,
      });
      expect(off.body.schedule.active).toBe(false);
      expect(await auditRows('schedule.deactivated', scheduleId)).toHaveLength(1);
      expect((await f.rec.post(`/api/doctors/${f.docA.id}/schedules`, body)).status).toBe(403);
      const list = await f.rec.get(`/api/doctors/${f.docA.id}/schedules`);
      expect(list.body.schedules).toHaveLength(2);
    }),
  );
});
