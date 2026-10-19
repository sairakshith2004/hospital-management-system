import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connectTest,
  createTestApp,
  createTestUser,
  inRollback,
  signIn,
} from '../../db/test-db.js';

let client!: pg.Client;
beforeAll(async () => {
  client = await connectTest('app');
});
afterAll(async () => {
  await client?.end();
});
const tx = (work: () => Promise<void>) => () => inRollback(client, work);

/** A synthetic department with one active doctor and one inactive doctor. */
async function seedDirectory() {
  const one = async (sql: string, params: unknown[]) =>
    (await client.query<{ id: string }>(sql, params)).rows[0]!.id;
  const dept = await one(
    "INSERT INTO departments (code, name, is_clinical) VALUES ('ZZ_CARD', 'Zz Cardiology', true) RETURNING id",
    [],
  );
  const doctor = async (no: string, name: string, active: boolean) => {
    const emp = await one(
      `INSERT INTO employees (employee_no, full_name, department_id, designation)
       VALUES ($1, $2, $3, 'Consultant') RETURNING id`,
      [no, name, dept],
    );
    return one(
      `INSERT INTO doctor_profiles (employee_id, department_id, specialty, registration_no,
         consultation_fee_paise, active)
       VALUES ($1, $2, 'Cardiologist', $3, 75000, $4) RETURNING id`,
      [emp, dept, `ZZ-REG-${no}`, active],
    );
  };
  const active = await doctor('ZZ-D1', 'Dr. Zz Active', true);
  await doctor('ZZ-D2', 'Dr. Zz Inactive', false);
  return { dept, active };
}

describe('GET /api/doctors and /api/departments', () => {
  it(
    'lists active doctors with department, specialty and fee, filterable by department',
    tx(async () => {
      const { app, db } = createTestApp(client);
      const { dept, active } = await seedDirectory();
      const rec = await createTestUser(db, { roles: ['REC'] });
      const { cookie } = await signIn(app, rec.username);
      const res = await request(app).get(`/api/doctors?departmentId=${dept}`).set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.doctors).toEqual([
        {
          id: active,
          fullName: 'Dr. Zz Active',
          departmentId: dept,
          departmentName: 'Zz Cardiology',
          specialty: 'Cardiologist',
          defaultSlotMinutes: 15,
          consultationFeePaise: 75000,
        },
      ]);
      expect(
        (await request(app).get('/api/doctors?departmentId=nope').set('Cookie', cookie)).status,
      ).toBe(422);
      const deps = await request(app).get('/api/departments').set('Cookie', cookie);
      expect(deps.body.departments.map((d: { code: string }) => d.code)).toContain('ZZ_CARD');
    }),
  );

  it(
    'requires schedule:read for doctors (PHA: audited 403) and a session for departments',
    tx(async () => {
      const { app, db } = createTestApp(client);
      const pha = await createTestUser(db, { roles: ['PHA'] });
      const { cookie } = await signIn(app, pha.username);
      expect((await request(app).get('/api/doctors').set('Cookie', cookie)).status).toBe(403);
      expect((await request(app).get('/api/departments').set('Cookie', cookie)).status).toBe(200);
      expect((await request(app).get('/api/departments')).status).toBe(401);
      expect((await request(app).get('/api/doctors')).status).toBe(401);
    }),
  );
});
