/**
 * Laboratory workflow (ERD §3.7, MVP): order (doctor, own open encounter; billed on the
 * visit's draft invoice) → collect (sample barcode) → results (abnormal flag computed from
 * the reference range copied at entry; corrections supersede) → verify (a different user).
 * Cancelling an order removes its draft charge.
 */
import type { PermissionCode } from '@hospitalos/shared';
import { withTransaction, type Database, type Queryable } from '../../db/client.js';
import { recordAudit, type AuditContext } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import {
  addInvoiceLine,
  deactivateSourceLine,
  draftInvoiceForVisit,
} from '../billing/billing.repo.js';
import { doctorIdOfUser } from '../scheduling/scheduling.repo.js';

export interface Actor {
  userId: string;
  can(permission: PermissionCode): boolean;
}

const notFound = () => new AppError(404, 'NOT_FOUND', 'Lab order not found');

async function audit(
  tx: Queryable,
  actor: Actor,
  context: AuditContext,
  action: string,
  orderId: string,
  patientId: string,
  changes?: Record<string, string | number | boolean>,
) {
  await recordAudit(
    tx,
    {
      actor: { type: 'user', userId: actor.userId },
      action,
      entityType: 'lab_order',
      entityId: orderId,
      patientId,
      ...(changes ? { changes } : {}),
    },
    context,
  );
}

export async function createLabTest(
  db: Database,
  input: {
    code: string;
    name: string;
    sampleType: string;
    turnaroundHours: number;
    pricePaise: number;
    parameters: {
      name: string;
      unit?: string | null | undefined;
      refLow?: number | null | undefined;
      refHigh?: number | null | undefined;
      refText?: string | null | undefined;
    }[];
  },
  actor: Actor,
  context: AuditContext,
) {
  const names = input.parameters.map((p) => p.name.toLowerCase());
  if (new Set(names).size !== names.length)
    throw new AppError(422, 'DUPLICATE_PARAMETER', 'Parameter names must be unique.');
  try {
    return await withTransaction(db, async (tx) => {
      const { rows: svc } = await tx.query<{ id: string }>(
        `INSERT INTO service_catalogue (code, name, kind, price_paise, created_by, updated_by) VALUES ($1, $2, 'lab', $3, $4, $4) RETURNING id`,
        [`LAB-${input.code}`.slice(0, 20), input.name, input.pricePaise, actor.userId],
      );
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO lab_tests (code, name, sample_type, service_id, turnaround_hours, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
        [input.code, input.name, input.sampleType, svc[0]!.id, input.turnaroundHours, actor.userId],
      );
      for (const [i, p] of input.parameters.entries()) {
        await tx.query(
          `INSERT INTO lab_test_parameters (test_id, name, unit, ref_low, ref_high, ref_text, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            rows[0]!.id,
            p.name,
            p.unit ?? null,
            p.refLow ?? null,
            p.refHigh ?? null,
            p.refText ?? null,
            i,
          ],
        );
      }
      await recordAudit(
        tx,
        {
          actor: { type: 'user', userId: actor.userId },
          action: 'lab_test.created',
          entityType: 'lab_test',
          entityId: rows[0]!.id,
          changes: { parameters: input.parameters.length },
        },
        context,
      );
      return rows[0]!.id;
    });
  } catch (err) {
    if ((err as { code?: string }).code === '23505')
      throw new AppError(409, 'DUPLICATE', 'A test or price with this code already exists.');
    throw err;
  }
}

/** Orders tests in the doctor's own open encounter and charges them on the visit invoice. */
export async function orderTests(
  db: Database,
  encounterId: string,
  input: { testIds: string[]; priority: string; clinicalNotes?: string | null | undefined },
  actor: Actor,
  context: AuditContext,
): Promise<string[]> {
  if (new Set(input.testIds).size !== input.testIds.length)
    throw new AppError(422, 'DUPLICATE_TEST', 'Each test can be ordered once.');
  return withTransaction(db, async (tx) => {
    const doctorId = await doctorIdOfUser(tx, actor.userId);
    const { rows } = await tx.query<{
      id: string;
      patientId: string;
      doctorId: string;
      status: string;
      appointmentId: string;
    }>(
      `SELECT id, patient_id AS "patientId", doctor_id AS "doctorId", status, appointment_id AS "appointmentId"
       FROM encounters WHERE id = $1 FOR UPDATE`,
      [encounterId],
    );
    const e = rows[0];
    if (!e || !doctorId || e.doctorId !== doctorId)
      throw new AppError(404, 'NOT_FOUND', 'Encounter not found');
    if (e.status !== 'in_progress')
      throw new AppError(409, 'ENCOUNTER_COMPLETED', 'Tests are ordered during the consultation.');
    const { rows: tests } = await tx.query<{
      id: string;
      name: string;
      serviceId: string;
      pricePaise: number;
    }>(
      `SELECT t.id, t.name, t.service_id AS "serviceId", s.price_paise::int AS "pricePaise"
       FROM lab_tests t JOIN service_catalogue s ON s.id = t.service_id
       WHERE t.id = ANY($1::uuid[]) AND t.active ORDER BY t.name`,
      [input.testIds],
    );
    if (tests.length !== input.testIds.length)
      throw new AppError(422, 'UNKNOWN_TEST', 'A test was not found.');
    const invoiceId = await draftInvoiceForVisit(
      tx,
      { patientId: e.patientId, appointmentId: e.appointmentId, userId: actor.userId },
      context,
    );
    const ids: string[] = [];
    for (const t of tests) {
      const { rows: o } = await tx.query<{ id: string }>(
        `INSERT INTO lab_orders (encounter_id, patient_id, test_id, ordered_by, priority, clinical_notes, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $4, $4) RETURNING id`,
        [e.id, e.patientId, t.id, actor.userId, input.priority, input.clinicalNotes ?? null],
      );
      await addInvoiceLine(tx, invoiceId, {
        sourceType: 'lab',
        description: `Lab: ${t.name}`,
        serviceId: t.serviceId,
        labOrderId: o[0]!.id,
        qty: 1,
        unitPricePaise: t.pricePaise,
        userId: actor.userId,
      });
      await audit(tx, actor, context, 'lab_order.created', o[0]!.id, e.patientId, { testId: t.id });
      ids.push(o[0]!.id);
    }
    return ids;
  });
}

async function lockOrder(tx: Queryable, id: string) {
  const { rows } = await tx.query<{
    id: string;
    status: string;
    patientId: string;
    testId: string;
    orderedBy: string;
    resultedBy: string | null;
  }>(
    `SELECT id, status, patient_id AS "patientId", test_id AS "testId", ordered_by AS "orderedBy", resulted_by AS "resultedBy"
     FROM lab_orders WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!rows[0]) throw notFound();
  return rows[0];
}

const transition = (from: string, allowed: string[], verb: string) => {
  if (!allowed.includes(from))
    throw new AppError(409, 'INVALID_TRANSITION', `A ${from} order can't be ${verb}.`);
};

export async function collectSample(
  db: Database,
  id: string,
  barcode: string,
  actor: Actor,
  context: AuditContext,
) {
  try {
    return await withTransaction(db, async (tx) => {
      const o = await lockOrder(tx, id);
      transition(o.status, ['ordered'], 'collected');
      await tx.query(
        `UPDATE lab_orders SET status = 'collected', sample_barcode = $2, collected_by = $3, collected_at = now(), updated_by = $3 WHERE id = $1`,
        [id, barcode, actor.userId],
      );
      await audit(tx, actor, context, 'lab_order.collected', id, o.patientId);
    });
  } catch (err) {
    if ((err as { code?: string }).code === '23505')
      throw new AppError(409, 'DUPLICATE_BARCODE', 'This sample barcode is already in use.');
    throw err;
  }
}

/** Enters (or corrects, before verification) results; flags values outside the reference range. */
export async function enterResults(
  db: Database,
  id: string,
  results: {
    parameterId: string;
    valueNum?: number | null | undefined;
    valueText?: string | null | undefined;
  }[],
  actor: Actor,
  context: AuditContext,
) {
  return withTransaction(db, async (tx) => {
    const o = await lockOrder(tx, id);
    transition(o.status, ['collected', 'resulted'], 'given results');
    const { rows: params } = await tx.query<{
      id: string;
      unit: string | null;
      refLow: string | null;
      refHigh: string | null;
      refText: string | null;
    }>(
      `SELECT id, unit, ref_low::text AS "refLow", ref_high::text AS "refHigh", ref_text AS "refText"
       FROM lab_test_parameters WHERE test_id = $1`,
      [o.testId],
    );
    const byId = new Map(params.map((p) => [p.id, p]));
    for (const r of results) {
      const p = byId.get(r.parameterId);
      if (!p)
        throw new AppError(422, 'UNKNOWN_PARAMETER', 'A result does not belong to this test.');
      const v = r.valueNum ?? null;
      const flag =
        v === null || (p.refLow === null && p.refHigh === null)
          ? null
          : p.refLow !== null && v < Number(p.refLow)
            ? 'low'
            : p.refHigh !== null && v > Number(p.refHigh)
              ? 'high'
              : 'normal';
      await tx.query(
        'UPDATE lab_results SET is_current = false WHERE order_id = $1 AND parameter_id = $2 AND is_current',
        [id, r.parameterId],
      );
      await tx.query(
        `INSERT INTO lab_results (order_id, test_id, parameter_id, value_num, value_text, unit, ref_low, ref_high, ref_text, abnormal_flag, entered_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id,
          o.testId,
          r.parameterId,
          v,
          r.valueText ?? null,
          p.unit,
          p.refLow,
          p.refHigh,
          p.refText,
          flag,
          actor.userId,
        ],
      );
    }
    await tx.query(
      `UPDATE lab_orders SET status = 'resulted', resulted_by = $2, resulted_at = now(), updated_by = $2 WHERE id = $1`,
      [id, actor.userId],
    );
    await audit(
      tx,
      actor,
      context,
      o.status === 'resulted' ? 'lab_result.corrected' : 'lab_result.entered',
      id,
      o.patientId,
      { values: results.length },
    );
  });
}

export async function verifyResults(db: Database, id: string, actor: Actor, context: AuditContext) {
  return withTransaction(db, async (tx) => {
    const o = await lockOrder(tx, id);
    transition(o.status, ['resulted'], 'verified');
    if (o.resultedBy === actor.userId) {
      throw new AppError(
        409,
        'SAME_USER',
        'Results must be verified by someone other than the person who entered them.',
      );
    }
    await tx.query(
      `UPDATE lab_orders SET status = 'verified', verified_by = $2, verified_at = now(), updated_by = $2 WHERE id = $1`,
      [id, actor.userId],
    );
    await audit(tx, actor, context, 'lab_result.verified', id, o.patientId);
  });
}

/** The ordering doctor cancels before results; the draft charge is removed. */
export async function cancelOrder(
  db: Database,
  id: string,
  reason: string,
  actor: Actor,
  context: AuditContext,
) {
  return withTransaction(db, async (tx) => {
    const o = await lockOrder(tx, id);
    if (o.orderedBy !== actor.userId) throw notFound();
    transition(o.status, ['ordered', 'collected'], 'cancelled');
    await tx.query(
      `UPDATE lab_orders SET status = 'cancelled', cancelled_by = $2, cancelled_at = now(), cancel_reason = $3, updated_by = $2 WHERE id = $1`,
      [id, actor.userId, reason],
    );
    const removed = await deactivateSourceLine(tx, { labOrderId: id });
    await audit(tx, actor, context, 'lab_order.cancelled', id, o.patientId, {
      chargeRemoved: removed,
    });
  });
}
