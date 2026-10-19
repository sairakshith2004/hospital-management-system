/**
 * End-to-end workflows through the real HTTP API on hms_test, each test in one rolled-back
 * transaction (every role signs in for real). Synthetic data only.
 *   A. reception → consultation → prescription, follow-up
 *   B. prescription → FEFO dispensing (atomic stock change) → invoice → payment
 *   C. lab order → collect → results → verify (another user) → doctor's chart
 *   D. supplier receipt into the store → transfer → pharmacy receipt
 *   E. role-based refusals along the way
 */
import { hospitalToday } from '@hospitalos/shared';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TEST_PASSWORD,
  connectTest,
  createTestApp,
  createTestUser,
  inRollback,
  signIn,
} from '../db/test-db.js';
import { hashPassword } from '../lib/password.js';

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

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const one = async (sql: string, params: unknown[] = []) =>
  (await client.query<{ id: string }>(sql, params)).rows[0]!.id;
let seq = 0;

async function setup() {
  const { app, db } = createTestApp(client);
  seq += 1;
  const tag = `W${seq}`;
  const dept = await one(
    `INSERT INTO departments (code, name, is_clinical) VALUES ($1, $1, true) RETURNING id`,
    [`ZZ_WF${tag}`],
  );
  async function doctorUser(label: string) {
    const emp = await one(
      `INSERT INTO employees (employee_no, full_name, department_id, designation)
       VALUES ($1, $2, $3, 'Consultant') RETURNING id`,
      [`ZZ-WF-${tag}-${label}`, `Dr. Zz ${label}`, dept],
    );
    const doctorId = await one(
      `INSERT INTO doctor_profiles (employee_id, department_id, specialty, registration_no, consultation_fee_paise)
       VALUES ($1, $2, 'Zz', $3, 50000) RETURNING id`,
      [emp, dept, `ZZ-WF-REG-${tag}-${label}`],
    );
    const username = `zz_wf_${tag}_${label}`.toLowerCase();
    const userId = await one(
      'INSERT INTO users (employee_id, username, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [emp, username, passwordHash],
    );
    await client.query(
      "INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'DOC'",
      [userId],
    );
    return { doctorId, username, userId };
  }
  const docA = await doctorUser('A');
  const docB = await doctorUser('B');
  const as = async (who: string[] | string) => {
    const username = Array.isArray(who) ? (await createTestUser(db, { roles: who })).username : who;
    const s = await signIn(app, username);
    const send = (method: 'post' | 'patch', path: string, body: object = {}) =>
      request(app)[method](path).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).send(body);
    return {
      get: (path: string) => request(app).get(path).set('Cookie', s.cookie),
      post: (path: string, body: object = {}) => send('post', path, body),
      patch: (path: string, body: object = {}) => send('patch', path, body),
    };
  };
  const store = await one(
    `INSERT INTO locations (code, name, kind) VALUES ($1, 'Zz Store', 'store') RETURNING id`,
    [`ZZST${tag}`],
  );
  const pharmacy = await one(
    `INSERT INTO locations (code, name, kind) VALUES ($1, 'Zz Pharmacy', 'pharmacy') RETURNING id`,
    [`ZZPH${tag}`],
  );
  const supplier = await one(
    `INSERT INTO suppliers (code, name) VALUES ($1, 'Zz Supplies') RETURNING id`,
    [`ZZSUP${tag}`],
  );
  const patient = await one(
    `INSERT INTO patients (first_name, last_name, dob, sex, phone)
     VALUES ('Zz', 'Workflow', '1980-02-02', 'male', '9000044401') RETURNING id`,
  );
  return { app, db, dept, docA, docB, as, store, pharmacy, supplier, patient, tag };
}

type F = Awaited<ReturnType<typeof setup>>;

/** A booked appointment today for docA (a fixture: booking today depends on the clock). */
async function bookedToday(f: F) {
  const today = hospitalToday();
  return one(
    `INSERT INTO appointments (patient_id, doctor_id, department_id, kind, visit_date, slot_start, slot_end)
     VALUES ($1, $2, $3, 'scheduled', $4::date, ($4 || ' 23:00+05:30')::timestamptz, ($4 || ' 23:15+05:30')::timestamptz)
     RETURNING id`,
    [f.patient, f.docA.doctorId, f.dept, today],
  );
}

async function catalogue(f: F, inv: Awaited<ReturnType<F['as']>>) {
  const ing = await inv.post('/api/ingredients', { name: `zzparacetamol${f.tag}` });
  expect(ing.status, JSON.stringify(ing.body)).toBe(201);
  const med = await inv.post('/api/stock/medicines', {
    sku: `ZZ-PCM-${f.tag}`,
    brandName: 'Zzcalpol',
    dosageForm: 'tablet',
    route: 'oral',
    baseUnit: 'tablet',
    rxOnly: true,
    reorderLevel: 5,
    ingredients: [{ ingredientId: ing.body.ingredient.id, strengthValue: 500, strengthUnit: 'mg' }],
  });
  expect(med.status, JSON.stringify(med.body)).toBe(201);
  return { ingredientId: ing.body.ingredient.id as string, medId: med.body.item.id as string };
}

async function audit(action: string) {
  const { rows } = await client.query(
    'SELECT entity_id, patient_id, changes FROM audit_logs WHERE action = $1 AND occurred_at = now() ORDER BY id',
    [action],
  );
  return rows;
}

async function reconcile(batchId: string) {
  const { rows } = await client.query<{ onHand: number; moved: number }>(
    `SELECT b.qty_on_hand AS "onHand", coalesce(sum(m.qty), 0)::int AS moved
     FROM stock_batches b LEFT JOIN stock_movements m ON m.batch_id = b.id WHERE b.id = $1 GROUP BY b.id`,
    [batchId],
  );
  expect(rows[0]!.onHand).toBe(rows[0]!.moved);
  return rows[0]!.onHand;
}

describe('workflow D: supplier receipt → store → transfer → pharmacy', () => {
  it(
    'receives into the store only, moves stock to the pharmacy, and keeps movements reconciled',
    tx(async () => {
      const f = await setup();
      const inv = await f.as(['INV']);
      const pha = await f.as(['PHA']);
      const { medId } = await catalogue(f, inv);
      const today = hospitalToday();
      const grnBody = (locationId: string) => ({
        supplierId: f.supplier,
        locationId,
        supplierInvoiceRef: 'ZZ-INV-1',
        lines: [
          {
            stockItemId: medId,
            batchNo: 'B-LATE',
            expiryDate: addDays(today, 400),
            qty: 100,
            unitCostPaise: 100,
            salePricePaise: 200,
          },
          {
            stockItemId: medId,
            batchNo: 'B-SOON',
            expiryDate: addDays(today, 60),
            qty: 30,
            unitCostPaise: 100,
            salePricePaise: 200,
          },
        ],
      });
      const wrong = await inv.post('/api/goods-receipts', grnBody(f.pharmacy));
      expect(wrong.status).toBe(422);
      expect(wrong.body.error.code).toBe('NOT_A_STORE');
      const noExpiry = await inv.post('/api/goods-receipts', {
        ...grnBody(f.store),
        lines: [
          { stockItemId: medId, batchNo: 'B-X', qty: 1, unitCostPaise: 1, salePricePaise: 1 },
        ],
      });
      expect(noExpiry.body.error.code).toBe('EXPIRY_REQUIRED');
      const grn = await inv.post('/api/goods-receipts', grnBody(f.store));
      expect(grn.status, JSON.stringify(grn.body)).toBe(201);
      expect(grn.body.receipt.grnNo).toMatch(/^GRN\d{7}$/);
      expect(await audit('goods_receipt.created')).toHaveLength(1);

      const stock = await inv.get(`/api/stock/${medId}`);
      expect(stock.body.item.totalAvailable).toBe(130);
      expect(stock.body.item.medicine.ingredients[0]).toMatchObject({
        strengthValue: '500.0000',
        strengthUnit: 'mg',
      });
      const late = stock.body.item.batches.find((b: { batchNo: string }) => b.batchNo === 'B-LATE');
      const soon = stock.body.item.batches.find((b: { batchNo: string }) => b.batchNo === 'B-SOON');

      // Store → pharmacy, received by a different user.
      const tr = await inv.post('/api/transfers', {
        fromLocationId: f.store,
        toLocationId: f.pharmacy,
        reason: 'Zz restock',
        lines: [
          { batchId: late.id, qty: 40 },
          { batchId: soon.id, qty: 20 },
        ],
      });
      expect(tr.status, JSON.stringify(tr.body)).toBe(201);
      expect(await reconcile(late.id)).toBe(60);
      const byInv = await inv.post(`/api/transfers/${tr.body.transfer.id}/receive`);
      expect(byInv.status).toBe(403); // INV can't receive into a pharmacy
      expect((await pha.post(`/api/transfers/${tr.body.transfer.id}/receive`)).status).toBe(200);
      const inPharmacy = await pha.get(`/api/stock?q=ZZ-PCM-${f.tag}&locationId=${f.pharmacy}`);
      expect(inPharmacy.body.items[0].totalAvailable).toBe(60);
      for (const b of inPharmacy.body.items[0].batches) await reconcile(b.id);

      // Adjustments need the location's permission and a reason; history is kept.
      const pharmBatch = inPharmacy.body.items[0].batches[0].id;
      expect(
        (
          await inv.post('/api/stock/adjustments', {
            batchId: pharmBatch,
            kind: 'damage',
            qty: 1,
            reason: 'Zz broken',
          })
        ).status,
      ).toBe(403);
      const dmg = await pha.post('/api/stock/adjustments', {
        batchId: pharmBatch,
        kind: 'damage',
        qty: 1,
        reason: 'Zz broken',
      });
      expect(dmg.status).toBe(201);
      const over = await pha.post('/api/stock/adjustments', {
        batchId: pharmBatch,
        kind: 'adjustment_out',
        qty: 9999,
        reason: 'Zz',
      });
      expect(over.body.error.code).toBe('INSUFFICIENT_STOCK');
      const moves = await pha.get(`/api/stock/movements?stockItemId=${medId}`);
      expect(moves.body.movements.map((m: { kind: string }) => m.kind).sort()).toEqual(
        [
          'damage',
          'receipt',
          'receipt',
          'transfer_in',
          'transfer_in',
          'transfer_out',
          'transfer_out',
        ].sort(),
      );

      // Doctors look up stock read-only; they can't touch it.
      const doc = await f.as(f.docA.username);
      const lookup = await doc.get(`/api/stock?q=zzparacetamol${f.tag}`);
      expect(lookup.status).toBe(200);
      expect(lookup.body.items[0].medicine.brandName).toBe('Zzcalpol');
      expect(
        (
          await doc.post('/api/stock/adjustments', {
            batchId: pharmBatch,
            kind: 'damage',
            qty: 1,
            reason: 'x',
          })
        ).status,
      ).toBe(403);
      expect((await doc.get('/api/stock/movements')).status).toBe(403);
    }),
  );
});

describe('workflows A, B and C: visit → consultation → pharmacy, lab and billing', () => {
  it(
    'runs the whole visit and keeps stock, invoice and audit consistent',
    tx(async () => {
      const f = await setup();
      const inv = await f.as(['INV']);
      const pha = await f.as(['PHA']);
      const rec = await f.as(['REC']);
      const fin = await f.as(['FIN']);
      const adm = await f.as(['ADM']);
      const lab1 = await f.as(['LAB']);
      const lab2 = await f.as(['LAB']);
      const docA = await f.as(f.docA.username);
      const docB = await f.as(f.docB.username);
      const { medId } = await catalogue(f, inv);
      const today = hospitalToday();

      // Stock straight into the pharmacy (receipt to store + transfer is workflow D).
      const grn = await inv.post('/api/goods-receipts', {
        supplierId: f.supplier,
        locationId: f.store,
        lines: [
          {
            stockItemId: medId,
            batchNo: 'P-LATE',
            expiryDate: addDays(today, 300),
            qty: 50,
            unitCostPaise: 100,
            salePricePaise: 250,
          },
          {
            stockItemId: medId,
            batchNo: 'P-SOON',
            expiryDate: addDays(today, 90),
            qty: 6,
            unitCostPaise: 100,
            salePricePaise: 200,
          },
          {
            stockItemId: medId,
            batchNo: 'P-SHORT',
            expiryDate: addDays(today, 1),
            qty: 50,
            unitCostPaise: 100,
            salePricePaise: 150,
          },
        ],
      });
      expect(grn.status, JSON.stringify(grn.body)).toBe(201);
      const storeItem = (await inv.get(`/api/stock/${medId}`)).body.item;
      const tr = await inv.post('/api/transfers', {
        fromLocationId: f.store,
        toLocationId: f.pharmacy,
        reason: 'Zz restock',
        lines: storeItem.batches.map((b: { id: string; qtyOnHand: number }) => ({
          batchId: b.id,
          qty: b.qtyOnHand,
        })),
      });
      expect((await pha.post(`/api/transfers/${tr.body.transfer.id}/receive`)).status).toBe(200);

      // Lab catalogue (price:manage).
      const test = await adm.post('/api/lab/tests', {
        code: `ZZHB${f.tag}`,
        name: 'Zz Haemoglobin',
        sampleType: 'Blood',
        turnaroundHours: 4,
        pricePaise: 30000,
        parameters: [{ name: 'Haemoglobin', unit: 'g/dL', refLow: 13, refHigh: 17 }],
      });
      expect(test.status, JSON.stringify(test.body)).toBe(201);

      // A. Reception checks the patient in: the consultation fee lands on a draft invoice.
      const apptId = await bookedToday(f);
      const checkIn = await rec.post(`/api/appointments/${apptId}/check-in`);
      expect(checkIn.status, JSON.stringify(checkIn.body)).toBe(200);
      const invList = await rec.get(`/api/invoices?patientId=${f.patient}`);
      expect(invList.body.invoices).toHaveLength(1);
      const invoiceId = invList.body.invoices[0].id as string;
      expect(invList.body.invoices[0]).toMatchObject({ status: 'draft', totalPaise: 50000 });

      // The doctor sees the patient in their own queue, the other doctor doesn't.
      expect((await docA.get('/api/queue')).body.queue.map((a: { id: string }) => a.id)).toContain(
        apptId,
      );
      expect(
        (await docB.get('/api/queue')).body.queue.map((a: { id: string }) => a.id),
      ).not.toContain(apptId);
      expect((await docB.post(`/api/appointments/${apptId}/encounter`)).status).toBe(404);

      const start = await docA.post(`/api/appointments/${apptId}/encounter`, {
        chiefComplaint: 'Zz fever',
      });
      expect(start.status, JSON.stringify(start.body)).toBe(201);
      const enc = start.body.encounterId as string;
      expect(
        (
          await docA.post(`/api/appointments/${apptId}/vitals`, {
            tempC: 38.4,
            pulse: 96,
            bpSys: 120,
            bpDia: 80,
          })
        ).status,
      ).toBe(201);
      expect((await docA.post(`/api/appointments/${apptId}/vitals`, { pulse: 999 })).status).toBe(
        422,
      );
      expect(
        (
          await docA.post(`/api/encounters/${enc}/notes`, {
            kind: 'symptoms',
            body: 'Zz fever for 2 days',
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await docA.post(`/api/encounters/${enc}/diagnoses`, {
            description: 'Zz viral fever',
            isPrimary: true,
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await docA.post(`/api/patients/${f.patient}/allergies`, {
            substance: `zzparacetamol${f.tag}`,
            severity: 'mild',
          })
        ).status,
      ).toBe(201);

      // Allergy check: refused until the prescriber acknowledges it.
      const rxBody = {
        items: [
          {
            medicineProductId: medId,
            dose: '500 mg',
            frequency: 'TDS',
            route: 'oral',
            durationDays: 3,
            qtyPrescribed: 10,
          },
        ],
      };
      const blocked = await docA.post(`/api/encounters/${enc}/prescriptions`, rxBody);
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('ALLERGY_CONFLICT');
      const rx = await docA.post(`/api/encounters/${enc}/prescriptions`, {
        ...rxBody,
        allergyAcknowledged: true,
      });
      expect(rx.status, JSON.stringify(rx.body)).toBe(201);
      const rxId = rx.body.prescriptionId as string;
      const order = await docA.post(`/api/encounters/${enc}/lab-orders`, {
        testIds: [test.body.testId],
        priority: 'routine',
      });
      expect(order.status, JSON.stringify(order.body)).toBe(201);
      const orderId = order.body.orderIds[0] as string;
      expect(
        (
          await docA.post(`/api/encounters/${enc}/follow-ups`, {
            reason: 'Zz review',
            dueFrom: addDays(today, 7),
            dueTo: addDays(today, 10),
          })
        ).status,
      ).toBe(201);
      expect((await docA.post(`/api/encounters/${enc}/complete`)).status).toBe(200);
      const frozen = await docA.post(`/api/encounters/${enc}/notes`, {
        kind: 'plan',
        body: 'late',
      });
      expect(frozen.body.error.code).toBe('ENCOUNTER_COMPLETED');
      expect(
        (await docA.post(`/api/encounters/${enc}/notes`, { kind: 'addendum', body: 'Zz addendum' }))
          .status,
      ).toBe(201);
      expect((await rec.get(`/api/appointments/${apptId}`)).body.appointment.status).toBe(
        'completed',
      );

      // Clinical access: the treating doctor reads the chart (audited); others are refused.
      const chart = await docA.get(`/api/patients/${f.patient}/chart`);
      expect(chart.status).toBe(200);
      expect(chart.body.chart.encounters[0].diagnoses[0].description).toBe('Zz viral fever');
      expect(chart.body.chart.vitals[0].pulse).toBe(96);
      expect((await docB.get(`/api/patients/${f.patient}/chart`)).status).toBe(403);
      expect((await rec.get(`/api/patients/${f.patient}/chart`)).status).toBe(403);
      expect((await audit('patient.clinical.read')).length).toBeGreaterThan(0);
      expect((await audit('access.denied')).some((r) => r.patient_id === f.patient)).toBe(true);

      // B. Pharmacy: FEFO among batches that last the course (P-SHORT expires too soon).
      const queue = await pha.get('/api/pharmacy/prescriptions');
      const mine = queue.body.prescriptions.find((p: { id: string }) => p.id === rxId);
      expect(mine.allergies).toHaveLength(1);
      expect(mine).not.toHaveProperty('notes', 'x');
      const itemId = mine.items[0].id as string;
      const key = '7d3c2a59-2b0c-4a43-9e3b-1d2f0c9a1b10';
      const body = {
        locationId: f.pharmacy,
        idempotencyKey: key,
        lines: [{ prescriptionItemId: itemId, qty: 10 }],
        allergyAck: true,
      };
      const tooMuch = await pha.post(`/api/pharmacy/prescriptions/${rxId}/dispense`, {
        ...body,
        lines: [{ prescriptionItemId: itemId, qty: 11 }],
      });
      expect(tooMuch.body.error.code).toBe('OVER_DISPENSE');
      const noAck = await pha.post(`/api/pharmacy/prescriptions/${rxId}/dispense`, {
        ...body,
        allergyAck: false,
      });
      expect(noAck.body.error.code).toBe('ALLERGY_CONFLICT');
      const done = await pha.post(`/api/pharmacy/prescriptions/${rxId}/dispense`, body);
      expect(done.status, JSON.stringify(done.body)).toBe(201);
      const replay = await pha.post(`/api/pharmacy/prescriptions/${rxId}/dispense`, body);
      expect(replay.status).toBe(200);
      expect(replay.body.dispenseNo).toBe(done.body.dispenseNo);
      const detail = (await pha.get(`/api/pharmacy/prescriptions/${rxId}`)).body.prescription;
      expect(detail.status).toBe('dispensed');
      // 6 from P-SOON (earliest usable expiry), then 4 from P-LATE; P-SHORT untouched.
      expect(
        detail.dispensings[0].lines
          .map((l: { batchNo: string; qty: number }) => [l.batchNo, l.qty])
          .sort(),
      ).toEqual([
        ['P-LATE', 4],
        ['P-SOON', 6],
      ]);
      const pharmItem = (await pha.get(`/api/stock/${medId}?`)).body.item;
      const qty = (no: string) =>
        pharmItem.batches.find(
          (b: { batchNo: string; location: { kind: string } }) =>
            b.batchNo === no && b.location.kind === 'pharmacy',
        )?.qtyOnHand ?? 0;
      expect([qty('P-SOON'), qty('P-LATE'), qty('P-SHORT')]).toEqual([0, 46, 50]);
      for (const b of pharmItem.batches) await reconcile(b.id);
      const again = await pha.post(`/api/pharmacy/prescriptions/${rxId}/dispense`, {
        ...body,
        idempotencyKey: '7d3c2a59-2b0c-4a43-9e3b-1d2f0c9a1b11',
      });
      expect(again.body.error.code).toBe('NOT_DISPENSABLE');

      // C. Lab: collect, results (flagged), verify by another user, visible to the doctor.
      expect((await lab1.post(`/api/lab/orders/${orderId}/results`, { results: [] })).status).toBe(
        422,
      );
      expect(
        (await lab1.post(`/api/lab/orders/${orderId}/collect`, { sampleBarcode: `ZZ-${f.tag}-1` }))
          .status,
      ).toBe(200);
      const params = (await lab1.get(`/api/lab/orders/${orderId}`)).body.order;
      const tests = (await lab1.get('/api/lab/tests')).body.tests;
      const param = tests.find((t: { id: string }) => t.id === test.body.testId).parameters[0].id;
      const resulted = await lab1.post(`/api/lab/orders/${orderId}/results`, {
        results: [{ parameterId: param, valueNum: 11.2 }],
      });
      expect(resulted.status, JSON.stringify(resulted.body)).toBe(200);
      expect(resulted.body.order.results[0]).toMatchObject({
        abnormalFlag: 'low',
        valueNum: '11.2000',
      });
      expect(params.status).toBe('collected');
      expect((await lab1.post(`/api/lab/orders/${orderId}/verify`)).body.error.code).toBe(
        'SAME_USER',
      );
      expect((await lab2.post(`/api/lab/orders/${orderId}/verify`)).body.order.status).toBe(
        'verified',
      );
      const chart2 = await docA.get(`/api/patients/${f.patient}/chart`);
      expect(chart2.body.chart.labOrders[0]).toMatchObject({ status: 'verified' });
      expect(
        (await docA.get(`/api/lab/orders/${orderId}`)).body.order.results[0].abnormalFlag,
      ).toBe('low');
      expect((await docB.get(`/api/lab/orders/${orderId}`)).status).toBe(403);

      // Same patient, now booked with doctor B: B sees only B's own records by default, and
      // doctor A's reports only after asking for "previous reports" (audited as such).
      await one(
        `INSERT INTO appointments (patient_id, doctor_id, department_id, kind, visit_date, slot_start, slot_end)
         VALUES ($1, $2, $3, 'scheduled', $4::date, ($4 || ' 23:30+05:30')::timestamptz, ($4 || ' 23:45+05:30')::timestamptz)
         RETURNING id`,
        [f.patient, f.docB.doctorId, f.dept, today],
      );
      const own = (await docB.get(`/api/patients/${f.patient}/chart`)).body.chart;
      expect(own).toMatchObject({
        scope: 'mine',
        otherDoctorRecords: 3, // A's consultation, lab order and prescription
        encounters: [],
        labOrders: [],
        prescriptions: [],
        vitals: [],
      });
      expect(own.appointments).toHaveLength(1);
      expect(own.appointments[0].doctor.id).toBe(f.docB.doctorId);
      const everyone = (await docB.get(`/api/patients/${f.patient}/chart?scope=all`)).body.chart;
      expect(everyone.scope).toBe('all');
      expect(everyone.encounters[0].doctor.id).toBe(f.docA.doctorId);
      expect(everyone.labOrders[0]).toMatchObject({
        status: 'verified',
        doctor: { id: f.docA.doctorId },
      });
      expect(everyone.prescriptions).toHaveLength(1);
      expect((await docB.get(`/api/lab/orders/${orderId}`)).status).toBe(200);
      const views = (await audit('patient.clinical.read'))
        .filter((r) => r.patient_id === f.patient)
        .map((r) => (r.changes as { view: string }).view);
      expect(views).toEqual(
        expect.arrayContaining(['chart', 'chart:all_doctors', 'lab_order:other_doctor']),
      );
      expect(
        (await docA.get(`/api/patients/${f.patient}/chart`)).body.chart.otherDoctorRecords,
      ).toBe(0);

      // The Super Admin (chief executive) reads any chart without a care relationship, audited
      // as executive access, and sees the pharmacy and lab queues, but does no clinical work.
      const ceo = await f.as(['SA']);
      const ceoChart = await ceo.get(`/api/patients/${f.patient}/chart`);
      expect(ceoChart.status).toBe(200);
      expect(ceoChart.body.chart).toMatchObject({ scope: 'all', otherDoctorRecords: 0 });
      expect(ceoChart.body.chart.encounters).toHaveLength(1);
      expect(
        (await audit('patient.clinical.read')).some(
          (r) => (r.changes as { access?: string }).access === 'executive',
        ),
      ).toBe(true);
      expect((await ceo.get(`/api/lab/orders/${orderId}`)).status).toBe(200);
      expect((await ceo.get('/api/lab/orders')).status).toBe(200);
      expect((await ceo.get('/api/pharmacy/prescriptions')).status).toBe(200);
      expect(
        (await ceo.post(`/api/encounters/${enc}/notes`, { kind: 'addendum', body: 'Zz' })).status,
      ).toBe(403);
      expect((await ceo.post(`/api/lab/orders/${orderId}/verify`)).status).toBe(403);

      // Billing: consultation + lab + dispensing lines; gapless number; payments.
      const draft = (await fin.get(`/api/invoices/${invoiceId}`)).body.invoice;
      expect(draft.lines.map((l: { sourceType: string }) => l.sourceType).sort()).toEqual([
        'consultation',
        'dispensing',
        'dispensing',
        'lab',
      ]);
      expect(draft.totalPaise).toBe(50000 + 30000 + 6 * 200 + 4 * 250);
      expect(
        (
          await rec.post(`/api/invoices/${invoiceId}/payments`, {
            amountPaise: 100,
            method: 'cash',
            idempotencyKey: '7d3c2a59-2b0c-4a43-9e3b-1d2f0c9a1b20',
          })
        ).body.error.code,
      ).toBe('NOT_PAYABLE');
      const issued = await rec.post(`/api/invoices/${invoiceId}/issue`);
      expect(issued.status, JSON.stringify(issued.body)).toBe(200);
      expect(issued.body.invoice.invoiceNo).toMatch(/^INV-\d{4}-\d{6}$/);
      const pay = (amount: number, k: string) =>
        rec.post(`/api/invoices/${invoiceId}/payments`, {
          amountPaise: amount,
          method: 'upi',
          reference: 'ZZ-UPI',
          idempotencyKey: k,
        });
      const first = await pay(20000, '7d3c2a59-2b0c-4a43-9e3b-1d2f0c9a1b21');
      expect(first.status).toBe(201);
      expect(first.body.invoice.status).toBe('partially_paid');
      expect((await pay(20000, '7d3c2a59-2b0c-4a43-9e3b-1d2f0c9a1b21')).status).toBe(200); // replay
      const over = await pay(draft.totalPaise, '7d3c2a59-2b0c-4a43-9e3b-1d2f0c9a1b22');
      expect(over.body.error.code).toBe('OVERPAYMENT');
      const rest = await pay(draft.totalPaise - 20000, '7d3c2a59-2b0c-4a43-9e3b-1d2f0c9a1b23');
      expect(rest.body.invoice).toMatchObject({ status: 'paid', balancePaise: 0 });
      expect(rest.body.invoice.payments).toHaveLength(2);
      expect((await docA.get(`/api/invoices/${invoiceId}`)).status).toBe(403);
      const summary = await fin.get(`/api/billing/summary?from=${today}&to=${today}`);
      expect(Number(summary.body.summary.collectedPaise)).toBeGreaterThanOrEqual(draft.totalPaise);
    }),
  );

  it(
    'refuses expired, recalled and short stock without leaving partial records',
    tx(async () => {
      const f = await setup();
      const inv = await f.as(['INV']);
      const pha = await f.as(['PHA']);
      const rec = await f.as(['REC']);
      const docA = await f.as(f.docA.username);
      const { medId } = await catalogue(f, inv);
      const today = hospitalToday();
      // Fixture batches straight in the pharmacy (one recalled, one expired).
      const mk = async (no: string, expiry: string, qty: number, status = 'active') => {
        const id = await one(
          `INSERT INTO stock_batches (stock_item_id, location_id, batch_no, expiry_date, sale_price_paise, qty_on_hand, status)
           VALUES ($1, $2, $3, $4, 100, 0, $5) RETURNING id`,
          [medId, f.pharmacy, no, expiry, 'active'],
        );
        await client.query(`UPDATE stock_batches SET qty_on_hand = $2 WHERE id = $1`, [id, qty]);
        await client.query(
          `INSERT INTO stock_movements (batch_id, location_id, kind, qty, balance_after, performed_by, reason)
           SELECT $1, $2, 'adjustment_in', $3, $3, $4, 'Zz fixture'`,
          [id, f.pharmacy, qty, f.docA.userId],
        );
        if (status !== 'active')
          await client.query('UPDATE stock_batches SET status = $2 WHERE id = $1', [id, status]);
        return id;
      };
      await mk('R-RECALLED', addDays(today, 200), 100, 'recalled');
      const good = await mk('R-GOOD', addDays(today, 200), 3);
      await client.query(`SET CONSTRAINTS ALL IMMEDIATE`);
      await client.query(`SET CONSTRAINTS ALL DEFERRED`);
      const apptId = await bookedToday(f);
      await rec.post(`/api/appointments/${apptId}/check-in`);
      const enc = (await docA.post(`/api/appointments/${apptId}/encounter`)).body.encounterId;
      const rxId = (
        await docA.post(`/api/encounters/${enc}/prescriptions`, {
          items: [
            {
              medicineProductId: medId,
              dose: '1',
              frequency: 'OD',
              route: 'oral',
              qtyPrescribed: 5,
            },
          ],
        })
      ).body.prescriptionId;
      const itemId = (await pha.get(`/api/pharmacy/prescriptions/${rxId}`)).body.prescription
        .items[0].id;
      const res = await pha.post(`/api/pharmacy/prescriptions/${rxId}/dispense`, {
        locationId: f.pharmacy,
        idempotencyKey: '7d3c2a59-2b0c-4a43-9e3b-1d2f0c9a1b30',
        lines: [{ prescriptionItemId: itemId, qty: 5 }],
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
      // Nothing changed: no dispensing, the good batch untouched, the prescription still issued.
      const { rows } = await client.query(
        'SELECT count(*)::int AS n FROM dispensings WHERE prescription_id = $1',
        [rxId],
      );
      expect(rows[0].n).toBe(0);
      expect(await reconcile(good)).toBe(3);
      expect((await pha.get(`/api/pharmacy/prescriptions/${rxId}`)).body.prescription.status).toBe(
        'issued',
      );
      // Partial dispense of what's usable works, and the rest can be closed.
      const part = await pha.post(`/api/pharmacy/prescriptions/${rxId}/dispense`, {
        locationId: f.pharmacy,
        idempotencyKey: '7d3c2a59-2b0c-4a43-9e3b-1d2f0c9a1b31',
        lines: [{ prescriptionItemId: itemId, qty: 3 }],
      });
      expect(part.status, JSON.stringify(part.body)).toBe(201);
      expect((await pha.get(`/api/pharmacy/prescriptions/${rxId}`)).body.prescription.status).toBe(
        'partially_dispensed',
      );
      expect(
        (await pha.post(`/api/pharmacy/prescriptions/${rxId}/close`, { reason: 'Zz out of stock' }))
          .status,
      ).toBe(200);
    }),
  );
});
