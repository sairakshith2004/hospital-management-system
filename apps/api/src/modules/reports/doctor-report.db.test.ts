/**
 * Per-doctor patient counts and earnings through the real HTTP API on hms_test, in one
 * rolled-back transaction: who sees which doctors, who sees earnings, and that the figures
 * come from real appointments and invoice lines. Synthetic data only.
 */
import { hospitalToday } from '@hospitalos/shared';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  TEST_PASSWORD,
  connectTest,
  createTestApp,
  createTestUser,
  inRollback,
  signIn,
} from '../../db/test-db.js';
import { hashPassword } from '../../lib/password.js';

let client!: pg.Client;
let passwordHash!: string;
beforeAll(async () => {
  client = await connectTest('app');
  passwordHash = await hashPassword(TEST_PASSWORD);
});
afterAll(async () => {
  await client?.end();
});

const one = async (sql: string, params: unknown[] = []) =>
  (await client.query<{ id: string }>(sql, params)).rows[0]!.id;

interface ReportRow {
  doctorId: string;
  visits: Record<string, number>;
  earnings: { consultations: number; billedPaise: string; paidPaise: string } | null;
}

it('counts each doctor’s patients for the day and shows earnings only to finance and the doctor', () =>
  inRollback(client, async () => {
    const { app, db } = createTestApp(client);
    const today = hospitalToday();
    const dept = await one(
      `INSERT INTO departments (code, name, is_clinical) VALUES ('ZZ_RPT', 'Zz Reports', true) RETURNING id`,
    );
    async function doctor(label: string, fee: number) {
      const emp = await one(
        `INSERT INTO employees (employee_no, full_name, department_id, designation)
         VALUES ($1, $2, $3, 'Consultant') RETURNING id`,
        [`ZZ-RPT-${label}`, `Dr. Zz Report ${label}`, dept],
      );
      const doctorId = await one(
        `INSERT INTO doctor_profiles (employee_id, department_id, specialty, registration_no, consultation_fee_paise)
         VALUES ($1, $2, 'Zz', $3, $4) RETURNING id`,
        [emp, dept, `ZZ-RPT-REG-${label}`, fee],
      );
      const username = `zz_rpt_${label}`.toLowerCase();
      const userId = await one(
        'INSERT INTO users (employee_id, username, password_hash) VALUES ($1, $2, $3) RETURNING id',
        [emp, username, passwordHash],
      );
      await client.query(
        "INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'DOC'",
        [userId],
      );
      return { doctorId, username };
    }
    const docA = await doctor('A', 50000);
    const docB = await doctor('B', 70000);

    let n = 0;
    async function appointment(doctorId: string) {
      n += 1;
      const patient = await one(
        `INSERT INTO patients (first_name, last_name, dob, sex, phone)
         VALUES ('Zz', $1, '1985-03-03', 'female', $2) RETURNING id`,
        [`Report${n}`, `90000555${String(n).padStart(2, '0')}`],
      );
      const hour = String(8 + n).padStart(2, '0');
      return one(
        `INSERT INTO appointments (patient_id, doctor_id, department_id, kind, visit_date, slot_start, slot_end)
         VALUES ($1, $2, $3, 'scheduled', $4::date, ($4 || ' ${hour}:00+05:30')::timestamptz,
                 ($4 || ' ${hour}:10+05:30')::timestamptz)
         RETURNING id`,
        [patient, doctorId, dept, today],
      );
    }

    const as = async (who: string[] | string) => {
      const username = Array.isArray(who)
        ? (await createTestUser(db, { roles: who })).username
        : who;
      const s = await signIn(app, username);
      return {
        get: (path: string) => request(app).get(path).set('Cookie', s.cookie),
        post: (path: string, body: object = {}) =>
          request(app).post(path).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).send(body),
      };
    };
    const rec = await as(['REC']);

    // docA: two arrive (checked in, so their fees are billed), one still booked, one cancelled.
    for (const id of [await appointment(docA.doctorId), await appointment(docA.doctorId)]) {
      const r = await rec.post(`/api/appointments/${id}/check-in`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    await appointment(docA.doctorId);
    const toCancel = await appointment(docA.doctorId);
    const cancel = await rec.post(`/api/appointments/${toCancel}/cancel`, {
      reason: 'Zz patient asked to cancel',
    });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    // docB: one booked, not yet arrived.
    await appointment(docB.doctorId);

    const path = `/api/reports/doctors?from=${today}&to=${today}`;
    const rowOf = (body: { report: { rows: ReportRow[] } }, id: string) =>
      body.report.rows.find((r) => r.doctorId === id);

    // Reception: every doctor's counts, no earnings.
    const byRec = await rec.get(path);
    expect(byRec.status, JSON.stringify(byRec.body)).toBe(200);
    expect(byRec.body.report.scope).toBe('all');
    expect(rowOf(byRec.body, docA.doctorId)).toMatchObject({
      visits: {
        patients: 3,
        booked: 1,
        waiting: 2,
        inConsultation: 0,
        seen: 0,
        noShow: 0,
        cancelled: 1,
      },
      earnings: null,
    });
    expect(rowOf(byRec.body, docB.doctorId)).toMatchObject({
      visits: { patients: 1, booked: 1, waiting: 0 },
      earnings: null,
    });

    // Finance: every doctor's earnings from the real consultation lines.
    const byFin = await (await as(['FIN'])).get(path);
    expect(byFin.status).toBe(200);
    expect(rowOf(byFin.body, docA.doctorId)!.earnings).toEqual({
      consultations: 2,
      billedPaise: '100000',
      paidPaise: '0',
    });
    expect(rowOf(byFin.body, docB.doctorId)!.earnings).toEqual({
      consultations: 0,
      billedPaise: '0',
      paidPaise: '0',
    });

    // A doctor: only their own row, with their own earnings.
    const byA = await (await as(docA.username)).get(path);
    expect(byA.status).toBe(200);
    expect(byA.body.report.scope).toBe('own');
    expect(byA.body.report.rows).toHaveLength(1);
    expect(byA.body.report.rows[0]).toMatchObject({
      doctorId: docA.doctorId,
      visits: { patients: 3 },
      earnings: { billedPaise: '100000' },
    });
    const byB = await (await as(docB.username)).get(path);
    expect(byB.body.report.rows.map((r: ReportRow) => r.doctorId)).toEqual([docB.doctorId]);

    // Others are refused and audited; a doctor role without a profile too; bad ranges fail.
    const pha = await (await as(['PHA'])).get(path);
    expect(pha.status).toBe(403);
    const noProfile = await (await as(['DOC'])).get(path);
    expect(noProfile.status).toBe(403);
    const { rows: denied } = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_logs WHERE action = 'access.denied' AND entity_id LIKE '%/reports/doctors' AND occurred_at = now()",
    );
    expect(denied[0]!.n).toBe(2);
    expect((await rec.get(`/api/reports/doctors?from=${today}&to=2000-01-01`)).status).toBe(422);
    expect((await rec.get('/api/reports/doctors?from=2020-01-01&to=2022-01-01')).status).toBe(422);
    expect((await request(app).get(path)).status).toBe(401);
  }));
