/**
 * Administration, HR, finance, equipment and marketing through the real API on hms_test,
 * each test in one rolled-back transaction. Synthetic data only.
 */
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTest, createTestApp, createTestUser, inRollback, signIn } from '../db/test-db.js';

/** Signs in with a specific password (signIn uses the shared test password). */
async function signInWith(app: Parameters<typeof request>[0], username: string, password: string) {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status}`);
  const cookie = ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .find((c) => c.startsWith('hms.sid='))!
    .split(';')[0]!;
  return { cookie, csrf: res.body.csrfToken as string };
}

let client!: pg.Client;
beforeAll(async () => {
  client = await connectTest('app');
});
afterAll(async () => {
  await client?.end();
});
const tx = (work: () => Promise<void>) => () => inRollback(client, work);
const PASSWORD = 'Zz-synthetic-pass-123';

async function setup() {
  const { app, db } = createTestApp(client);
  const session = async (username: string, password?: string) => {
    const s = password ? await signInWith(app, username, password) : await signIn(app, username);
    const send = (method: 'post' | 'patch', path: string, body: object = {}) =>
      request(app)[method](path).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).send(body);
    return {
      cookie: s.cookie,
      get: (path: string) => request(app).get(path).set('Cookie', s.cookie),
      post: (path: string, body: object = {}) => send('post', path, body),
    };
  };
  const as = async (roles: string[]) => {
    const u = await createTestUser(db, { roles });
    return { ...(await session(u.username)), id: u.id, username: u.username };
  };
  const dept = (
    await client.query<{ id: string }>(
      `INSERT INTO departments (code, name, is_clinical) VALUES ('ZZ_ADM_GEN', 'Zz Admin General', true) RETURNING id`,
    )
  ).rows[0]!.id;
  return { app, db, as, session, dept };
}

const audit = async (action: string) =>
  (
    await client.query(
      'SELECT entity_id, reason, changes FROM audit_logs WHERE action = $1 AND occurred_at = now() ORDER BY id',
      [action],
    )
  ).rows;

describe('staff accounts and roles', () => {
  it(
    'creates an account without roles, grants a role, and protects SA accounts and oneself',
    tx(async () => {
      const f = await setup();
      const adm = await f.as(['ADM']);
      const sa = await f.as(['SA']);
      const created = await adm.post('/api/admin/staff', {
        fullName: 'Zz New Receptionist',
        employeeNo: 'ZZ-NEW-1',
        departmentId: f.dept,
        designation: 'Receptionist',
        username: 'zz_new_rec',
        password: PASSWORD,
        reason: 'Zz onboarding',
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(await audit('user.created')).toHaveLength(1);
      // The new account signs in but has no permissions yet.
      const login = await request(f.app)
        .post('/api/auth/login')
        .send({ username: 'zz_new_rec', password: PASSWORD });
      expect(login.status).toBe(200);
      expect(login.body.user.roles).toEqual([]);
      const staff = (await adm.get('/api/admin/staff')).body.staff;
      const newUserId = staff.find((s: { employeeNo: string }) => s.employeeNo === 'ZZ-NEW-1').user
        .id;

      // ADM can't assign roles; SA can, but not to itself.
      expect(
        (
          await adm.post(`/api/admin/users/${newUserId}/roles/grant`, {
            roleCode: 'REC',
            reason: 'x',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await sa.post(`/api/admin/users/${newUserId}/roles/grant`, {
            roleCode: 'REC',
            reason: 'Zz job',
          })
        ).status,
      ).toBe(200);
      expect(
        (await sa.post(`/api/admin/users/${sa.id}/roles/grant`, { roleCode: 'ADM', reason: 'x' }))
          .body.error.code,
      ).toBe('SELF_CHANGE');
      expect((await audit('user_role.granted'))[0].changes).toEqual({ role: 'REC' });
      const rec = await f.session('zz_new_rec', PASSWORD);
      expect((await rec.get('/api/patients?q=zz')).status).toBe(200);

      // ADM can't touch an SA account; nobody changes their own status.
      expect(
        (await adm.post(`/api/admin/users/${sa.id}/status`, { status: 'disabled', reason: 'x' }))
          .status,
      ).toBe(403);
      expect(
        (await adm.post(`/api/admin/users/${adm.id}/status`, { status: 'disabled', reason: 'x' }))
          .body.error.code,
      ).toBe('SELF_CHANGE');

      // Disabling ends the account's sessions at once.
      expect(
        (
          await adm.post(`/api/admin/users/${newUserId}/status`, {
            status: 'disabled',
            reason: 'Zz left',
          })
        ).status,
      ).toBe(200);
      expect((await rec.get('/api/patients?q=zz')).status).toBe(401);
      // A password reset also ends sessions.
      await adm.post(`/api/admin/users/${newUserId}/status`, {
        status: 'active',
        reason: 'Zz back',
      });
      const rec2 = await f.session('zz_new_rec', PASSWORD);
      expect(
        (
          await adm.post(`/api/admin/users/${newUserId}/password`, {
            password: 'Zz-other-pass-4567',
            reason: 'Zz forgot',
          })
        ).status,
      ).toBe(200);
      expect((await rec2.get('/api/patients?q=zz')).status).toBe(401);
      expect(await audit('user.password_reset')).toHaveLength(1);
    }),
  );

  it(
    'checks each setting against its own permission and audits old and new values',
    tx(async () => {
      const f = await setup();
      const adm = await f.as(['ADM']);
      const sa = await f.as(['SA']);
      expect(
        (
          await adm.post('/api/admin/settings', {
            key: 'near_expiry_days',
            value: 45,
            reason: 'Zz policy',
          })
        ).status,
      ).toBe(200);
      expect((await audit('settings.changed'))[0].changes).toMatchObject({ to: '45' });
      expect(
        (
          await adm.post('/api/admin/settings', {
            key: 'care_window_after_days',
            value: 30,
            reason: 'x',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await sa.post('/api/admin/settings', {
            key: 'care_window_after_days',
            value: 60,
            reason: 'Zz',
          })
        ).status,
      ).toBe(200);
      expect(
        (await sa.post('/api/admin/settings', { key: 'no_such_key', value: 1, reason: 'x' })).body
          .error.code,
      ).toBe('UNKNOWN_SETTING');
      expect(
        (
          await adm.post('/api/admin/settings', {
            key: 'near_expiry_days',
            value: 'abc',
            reason: 'x',
          })
        ).body.error.code,
      ).toBe('INVALID_VALUE');
      expect((await adm.get('/api/admin/settings')).body.settings.near_expiry_days).toBe(45);
    }),
  );

  it(
    'writes exactly one audit_log.searched row per audit search, and refuses everyone else',
    tx(async () => {
      const f = await setup();
      const sa = await f.as(['SA']);
      const rec = await f.as(['REC']);
      const res = await sa.get('/api/admin/audit?action=auth.');
      expect(res.status).toBe(200);
      expect(res.body.rows.every((r: { action: string }) => r.action.startsWith('auth.'))).toBe(
        true,
      );
      expect(await audit('audit_log.searched')).toHaveLength(1);
      expect((await rec.get('/api/admin/audit')).status).toBe(403);
    }),
  );

  it(
    'adds a doctor and leave that blocks their slots',
    tx(async () => {
      const f = await setup();
      const adm = await f.as(['ADM']);
      const emp = await adm.post('/api/admin/staff', {
        fullName: 'Dr. Zz Admin',
        employeeNo: 'ZZ-DOC-ADM',
        departmentId: f.dept,
        designation: 'Consultant',
        reason: 'Zz hire',
      });
      const doc = await adm.post('/api/admin/doctors', {
        employeeId: emp.body.employeeId,
        specialty: 'Zz',
        registrationNo: 'ZZ-REG-ADM',
        consultationFeePaise: 40000,
      });
      expect(doc.status, JSON.stringify(doc.body)).toBe(201);
      const doctorId = doc.body.doctorId;
      await adm.post(`/api/doctors/${doctorId}/schedules`, {
        weekday: 1,
        startTime: '09:00',
        endTime: '10:00',
        slotMinutes: 30,
        validFrom: '2030-01-01',
      });
      const leave = await adm.post(`/api/doctors/${doctorId}/exceptions`, {
        kind: 'leave',
        startsAt: '2030-01-07T09:00:00+05:30',
        endsAt: '2030-01-07T10:00:00+05:30',
        reason: 'Zz conference',
      });
      expect(leave.status, JSON.stringify(leave.body)).toBe(201);
      const slots = (await adm.get(`/api/doctors/${doctorId}/availability?date=2030-01-07`)).body
        .slots;
      expect(slots.map((s: { available: boolean }) => s.available)).toEqual([false, false]);
      expect(
        (
          await adm.post(`/api/admin/doctors/${doctorId}/fee`, {
            consultationFeePaise: 45000,
            reason: 'Zz revision',
          })
        ).status,
      ).toBe(200);
    }),
  );
});

describe('HR, finance, equipment and marketing', () => {
  it(
    "records attendance and decides leave, never one's own",
    tx(async () => {
      const f = await setup();
      const hr = await f.as(['HR']);
      const rec = await f.as(['REC']);
      const emp = (
        await client.query<{ id: string }>('SELECT employee_id AS id FROM users WHERE id = $1', [
          rec.id,
        ])
      ).rows[0]!.id;
      expect(
        (
          await hr.post('/api/hr/attendance', {
            employeeId: emp,
            workDate: '2030-01-07',
            status: 'present',
            checkIn: '09:00',
            checkOut: '17:00',
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await hr.post('/api/hr/attendance', {
            employeeId: emp,
            workDate: '2030-01-07',
            status: 'half_day',
            checkIn: '09:00',
            checkOut: '13:00',
          })
        ).status,
      ).toBe(200);
      const day = (await hr.get('/api/hr/attendance?date=2030-01-07')).body.rows.find(
        (r: { employeeId: string }) => r.employeeId === emp,
      );
      expect(day).toMatchObject({ status: 'half_day', checkOut: '13:00' });
      expect(
        (
          await hr.post('/api/hr/attendance', {
            employeeId: emp,
            workDate: '2030-01-07',
            status: 'present',
            checkIn: '18:00',
            checkOut: '09:00',
          })
        ).body.error.code,
      ).toBe('INVALID_TIMES');

      const req = await rec.post('/api/hr/leave', {
        kind: 'casual',
        startDate: '2030-02-01',
        endDate: '2030-02-02',
        reason: 'Zz family',
      });
      expect(req.status).toBe(201);
      expect((await rec.get('/api/hr/leave?scope=all')).status).toBe(403);
      expect(
        (await hr.post(`/api/hr/leave/${req.body.leaveId}/decide`, { decision: 'approved' }))
          .status,
      ).toBe(200);
      expect(
        (await hr.post(`/api/hr/leave/${req.body.leaveId}/decide`, { decision: 'rejected' })).body
          .error.code,
      ).toBe('INVALID_TRANSITION');
      // HR's own request needs someone else.
      const own = await hr.post('/api/hr/leave', {
        kind: 'sick',
        startDate: '2030-03-01',
        endDate: '2030-03-01',
        reason: 'Zz',
      });
      expect(own.status).toBe(201);
      expect(
        (await hr.post(`/api/hr/leave/${own.body.leaveId}/decide`, { decision: 'approved' })).body
          .error.code,
      ).toBe('SELF_DECISION');
    }),
  );

  it(
    'records expenses, approved only by someone else with expense:approve',
    tx(async () => {
      const f = await setup();
      const fin = await f.as(['FIN']);
      const adm = await f.as(['ADM']);
      const cat = await fin.post('/api/finance/categories', {
        code: 'ZZ-UTIL',
        name: 'Zz Utilities',
      });
      expect(cat.status).toBe(201);
      const exp = await fin.post('/api/finance/expenses', {
        categoryId: cat.body.categoryId,
        expenseDate: '2030-01-07',
        amountPaise: 125000,
        payee: 'Zz Power Co',
        description: 'Zz electricity',
      });
      expect(exp.status).toBe(201);
      expect(
        (
          await fin.post(`/api/finance/expenses/${exp.body.expenseId}/decide`, {
            decision: 'approved',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await adm.post(`/api/finance/expenses/${exp.body.expenseId}/decide`, {
            decision: 'approved',
          })
        ).status,
      ).toBe(200);
      const list = (await fin.get('/api/finance/expenses?status=approved')).body.expenses;
      expect(list.find((x: { id: string }) => x.id === exp.body.expenseId)).toMatchObject({
        amountPaise: 125000,
        status: 'approved',
      });
      const summary = (await fin.get('/api/billing/summary?from=2030-01-01&to=2030-01-31')).body
        .summary;
      expect(Number(summary.approvedExpensesPaise)).toBe(125000);
    }),
  );

  it(
    'keeps an asset register with maintenance history and due dates',
    tx(async () => {
      const f = await setup();
      const inv = await f.as(['INV']);
      const rec = await f.as(['REC']);
      const eq = await inv.post('/api/equipment', {
        assetTag: 'ZZ-ECG-1',
        name: 'Zz ECG machine',
        purchaseDate: '2029-12-01',
        maintenanceIntervalDays: 90,
      });
      expect(eq.status, JSON.stringify(eq.body)).toBe(201);
      expect(
        (await inv.post('/api/equipment', { assetTag: 'ZZ-ECG-1', name: 'dup' })).body.error.code,
      ).toBe('DUPLICATE');
      const log = await inv.post(`/api/equipment/${eq.body.equipmentId}/maintenance`, {
        kind: 'preventive',
        performedOn: '2030-01-10',
        notes: 'Zz calibrated',
        outcome: 'in_service',
      });
      expect(log.status).toBe(201);
      const item = (await inv.get('/api/equipment')).body.equipment.find(
        (e: { id: string }) => e.id === eq.body.equipmentId,
      );
      expect(item.nextMaintenanceDue).toBe('2030-04-10');
      expect(
        (await inv.get(`/api/equipment/${eq.body.equipmentId}/maintenance`)).body.logs,
      ).toHaveLength(1);
      expect((await rec.get('/api/equipment')).status).toBe(403);
    }),
  );

  it(
    'tracks enquiries to conversion, with aggregates for marketing and no clinical access',
    tx(async () => {
      const f = await setup();
      const rec = await f.as(['REC']);
      const mkt = await f.as(['MKT']);
      const src = await mkt.post('/api/referral-sources', { name: 'Zz Newspaper' });
      const camp = await mkt.post('/api/campaigns', {
        name: 'Zz Health Camp',
        channel: 'camp',
        startDate: '2030-01-01',
        budgetPaise: 500000,
      });
      expect(camp.status).toBe(201);
      const enq = await rec.post('/api/enquiries', {
        name: 'Zz Caller',
        phone: '90000 33301',
        channel: 'phone',
        referralSourceId: src.body.sourceId,
        campaignId: camp.body.campaignId,
        subject: 'Zz OPD timings',
      });
      expect(enq.status, JSON.stringify(enq.body)).toBe(201);
      expect(
        (
          await rec.post(`/api/enquiries/${enq.body.enquiryId}/follow-ups`, {
            note: 'Zz call back',
            dueOn: '2030-01-08',
          })
        ).status,
      ).toBe(201);
      const patient = (
        await client.query<{ id: string }>(
          `INSERT INTO patients (first_name, last_name, dob, sex, phone) VALUES ('Zz', 'Caller', '1990-01-01', 'female', '9000033301') RETURNING id`,
        )
      ).rows[0]!.id;
      expect(
        (await rec.post(`/api/enquiries/${enq.body.enquiryId}/status`, { status: 'converted' }))
          .body.error.code,
      ).toBe('PATIENT_REQUIRED');
      expect(
        (
          await rec.post(`/api/enquiries/${enq.body.enquiryId}/status`, {
            status: 'converted',
            convertedPatientId: patient,
          })
        ).status,
      ).toBe(200);
      const campaigns = (await mkt.get('/api/campaigns')).body.campaigns;
      expect(campaigns.find((c: { id: string }) => c.id === camp.body.campaignId)).toMatchObject({
        enquiries: 1,
        converted: 1,
      });
      expect(
        (await mkt.get('/api/marketing/summary')).body.summary.byStatus.converted,
      ).toBeGreaterThanOrEqual(1);
      // Marketing never reaches clinical or prescription data, or the enquiry list itself.
      expect((await mkt.get(`/api/patients/${patient}/chart`)).status).toBe(403);
      expect((await mkt.get('/api/pharmacy/prescriptions')).status).toBe(403);
      expect((await mkt.get(`/api/patients/${patient}`)).status).toBe(403);
    }),
  );
});
