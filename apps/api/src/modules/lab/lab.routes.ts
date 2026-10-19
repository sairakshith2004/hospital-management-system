/**
 *   GET  /api/lab/tests                       lab_order:create | lab:process | price:manage
 *   POST /api/lab/tests                       price:manage (creates the test and its price)
 *   POST /api/encounters/:id/lab-orders       lab_order:create (own open encounter)
 *   GET  /api/lab/orders?status=              lab:process | lab_result:enter | lab_result:verify
 *   GET  /api/lab/orders/:id                  lab roles; a doctor only with a care relationship (audited)
 *   POST /api/lab/orders/:id/collect          lab:process
 *   POST /api/lab/orders/:id/results          lab_result:enter
 *   POST /api/lab/orders/:id/verify           lab_result:verify (not the person who entered them)
 *   POST /api/lab/orders/:id/cancel           lab_order:cancel (the ordering doctor)
 * Lab staff see only what the order needs (note 2): patient identifiers, test, clinical note.
 */
import {
  LAB_ORDER_STATUSES,
  cancelLabOrderSchema,
  collectSampleSchema,
  createLabOrderSchema,
  createLabTestSchema,
  enterResultsSchema,
  type LabOrderView,
  type PermissionCode,
} from '@hospitalos/shared';
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { Database, Queryable } from '../../db/client.js';
import { auditContext } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { requireAnyPermission, requirePermission, requireUser } from '../../middleware/auth.js';
import { doctorIdOfUser } from '../scheduling/scheduling.repo.js';
import { authorizeClinicalRead } from '../clinical/access.js';
import {
  cancelOrder,
  collectSample,
  createLabTest,
  enterResults,
  orderTests,
  verifyResults,
  type Actor,
} from './lab.service.js';

const LAB_ROLES: PermissionCode[] = ['lab:process', 'lab_result:enter', 'lab_result:verify'];

const uuid = (value: unknown, what = 'Lab order') => {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new AppError(404, 'NOT_FOUND', `${what} not found`);
  return parsed.data;
};
const actorOf = (res: Response): Actor => {
  const user = requireUser(res);
  return { userId: user.id, can: (p) => user.can(p) };
};
const nameOf = (col: string) =>
  `(SELECT e.full_name FROM users u JOIN employees e ON e.id = u.employee_id WHERE u.id = ${col})`;

const ORDER_JSON = `json_build_object(
  'id', o.id, 'orderNo', o.order_no, 'status', o.status, 'priority', o.priority, 'clinicalNotes', o.clinical_notes,
  'sampleBarcode', o.sample_barcode, 'orderedAt', o.created_at, 'orderedBy', ${nameOf('o.ordered_by')},
  'collectedAt', o.collected_at, 'resultedAt', o.resulted_at, 'resultedBy', ${nameOf('o.resulted_by')},
  'verifiedAt', o.verified_at, 'verifiedBy', ${nameOf('o.verified_by')}, 'cancelReason', o.cancel_reason,
  'encounterId', o.encounter_id,
  'test', json_build_object('id', t.id, 'code', t.code, 'name', t.name, 'sampleType', t.sample_type),
  'patient', json_build_object('id', p.id, 'mrn', p.mrn, 'firstName', p.first_name, 'lastName', p.last_name),
  'doctor', json_build_object('id', d.id, 'fullName', de.full_name),
  'results', (SELECT coalesce(json_agg(json_build_object('parameterId', tp.id, 'parameter', tp.name,
      'valueNum', r.value_num::text, 'valueText', r.value_text, 'unit', r.unit, 'refLow', r.ref_low::text,
      'refHigh', r.ref_high::text, 'refText', r.ref_text, 'abnormalFlag', r.abnormal_flag, 'enteredAt', r.entered_at)
      ORDER BY tp.sort_order), '[]')
    FROM lab_results r JOIN lab_test_parameters tp ON tp.id = r.parameter_id
    WHERE r.order_id = o.id AND r.is_current))`;
const ORDER_FROM = `FROM lab_orders o JOIN lab_tests t ON t.id = o.test_id JOIN patients p ON p.id = o.patient_id
  JOIN encounters en ON en.id = o.encounter_id JOIN doctor_profiles d ON d.id = en.doctor_id
  JOIN employees de ON de.id = d.employee_id`;

async function findOrder(db: Queryable, id: string): Promise<LabOrderView | undefined> {
  const { rows } = await db.query<{ o: LabOrderView }>(
    `SELECT ${ORDER_JSON} AS o ${ORDER_FROM} WHERE o.id = $1`,
    [id],
  );
  return rows[0]?.o;
}

export function labRoutes(db: Database): Router {
  const router = Router();

  router.get(
    '/lab/tests',
    requireAnyPermission(db, ['lab_order:create', 'lab:process', 'price:manage']),
    async (_req, res) => {
      const { rows } = await db.query(
        `SELECT t.id, t.code, t.name, t.sample_type AS "sampleType", t.turnaround_hours AS "turnaroundHours",
              s.price_paise::int AS "pricePaise", t.active,
              CASE WHEN dep.id IS NULL THEN NULL ELSE json_build_object('id', dep.id, 'name', dep.name) END AS department,
              (SELECT coalesce(json_agg(json_build_object('id', p.id, 'name', p.name, 'unit', p.unit,
                  'refLow', p.ref_low::text, 'refHigh', p.ref_high::text, 'refText', p.ref_text) ORDER BY p.sort_order), '[]')
               FROM lab_test_parameters p WHERE p.test_id = t.id) AS parameters
       FROM lab_tests t JOIN service_catalogue s ON s.id = t.service_id
       LEFT JOIN departments dep ON dep.id = s.department_id
       ORDER BY t.name`,
      );
      res.json({ tests: rows });
    },
  );
  router.post('/lab/tests', requirePermission(db, 'price:manage'), async (req, res) => {
    const input = createLabTestSchema.parse(req.body);
    res
      .status(201)
      .json({ testId: await createLabTest(db, input, actorOf(res), auditContext(req, res)) });
  });

  router.post(
    '/encounters/:id/lab-orders',
    requirePermission(db, 'lab_order:create'),
    async (req, res) => {
      const input = createLabOrderSchema.parse(req.body);
      const ids = await orderTests(
        db,
        uuid(req.params.id, 'Encounter'),
        input,
        actorOf(res),
        auditContext(req, res),
      );
      res.status(201).json({ orderIds: ids });
    },
  );

  router.get(
    '/lab/orders',
    requireAnyPermission(db, [...LAB_ROLES, 'operations:oversee']),
    async (req, res) => {
      const { status } = z
        .object({ status: z.enum(LAB_ORDER_STATUSES).optional() })
        .parse(req.query);
      const { rows } = await db.query<{ o: LabOrderView }>(
        `SELECT ${ORDER_JSON} AS o ${ORDER_FROM}
       WHERE ($1::text IS NULL AND o.status IN ('ordered', 'collected', 'resulted')) OR o.status = $1
       ORDER BY (o.priority = 'urgent') DESC, o.created_at LIMIT 200`,
        [status ?? null],
      );
      res.json({ orders: rows.map((r) => r.o) });
    },
  );

  router.get(
    '/lab/orders/:id',
    requireAnyPermission(db, [...LAB_ROLES, 'patient:read_clinical']),
    async (req, res) => {
      const order = await findOrder(db, uuid(req.params.id));
      if (!order) throw new AppError(404, 'NOT_FOUND', 'Lab order not found');
      const user = requireUser(res);
      if (!LAB_ROLES.some((p) => user.can(p))) {
        const mine = (await doctorIdOfUser(db, user.id)) === order.doctor.id;
        await authorizeClinicalRead(
          db,
          req,
          res,
          order.patient.id,
          mine ? 'lab_order' : 'lab_order:other_doctor',
        );
      }
      res.json({ order });
    },
  );

  router.post('/lab/orders/:id/collect', requirePermission(db, 'lab:process'), async (req, res) => {
    const id = uuid(req.params.id);
    const { sampleBarcode } = collectSampleSchema.parse(req.body);
    await collectSample(db, id, sampleBarcode, actorOf(res), auditContext(req, res));
    res.json({ order: await findOrder(db, id) });
  });
  router.post(
    '/lab/orders/:id/results',
    requirePermission(db, 'lab_result:enter'),
    async (req, res) => {
      const id = uuid(req.params.id);
      const { results } = enterResultsSchema.parse(req.body);
      await enterResults(db, id, results, actorOf(res), auditContext(req, res));
      res.json({ order: await findOrder(db, id) });
    },
  );
  router.post(
    '/lab/orders/:id/verify',
    requirePermission(db, 'lab_result:verify'),
    async (req, res) => {
      const id = uuid(req.params.id);
      await verifyResults(db, id, actorOf(res), auditContext(req, res));
      res.json({ order: await findOrder(db, id) });
    },
  );
  router.post(
    '/lab/orders/:id/cancel',
    requirePermission(db, 'lab_order:cancel'),
    async (req, res) => {
      const id = uuid(req.params.id);
      const { reason } = cancelLabOrderSchema.parse(req.body);
      await cancelOrder(db, id, reason, actorOf(res), auditContext(req, res));
      res.json({ order: await findOrder(db, id) });
    },
  );

  return router;
}
