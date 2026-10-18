/**
 * Dispensing (ERD §5, MVP: no substitutions or returns). In one transaction, with the
 * global lock order prescription → items → batches (ascending id) → invoice:
 *   1. replay a seen idempotency key;
 *   2. the prescription must be issued or partially dispensed;
 *   3. each requested quantity must fit what is still outstanding on its item;
 *   4. batches are chosen FEFO (first expiry, first out) among active, unexpired batches at
 *      the chosen pharmacy that won't expire before the prescribed course ends; a batch
 *      expiring within near_expiry_days needs the pharmacist's acknowledgement;
 *   5. stock is decremented with a `dispense` movement per batch, dispensing lines and the
 *      visit's invoice lines are written, quantities and the prescription status updated;
 *   6. one `dispensing.created` audit row.
 * Any failure rolls everything back. CHECK (qty_on_hand >= 0) is the last safety net.
 */
import { hospitalToday, type DispenseInput } from '@hospitalos/shared';
import { withTransaction, type Database, type Queryable } from '../../db/client.js';
import { recordAudit, type AuditContext } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { addInvoiceLine, draftInvoiceForVisit } from '../billing/billing.repo.js';
import { findLocation, moveStock } from '../inventory/inventory.repo.js';

export interface Actor {
  userId: string;
}

interface Item {
  id: string;
  productId: string;
  product: string;
  qtyPrescribed: number;
  qtyDispensed: number;
  durationDays: number | null;
}

interface Batch {
  id: string;
  stockItemId: string;
  batchNo: string;
  expiryDate: string;
  qtyOnHand: number;
  salePricePaise: number;
}

const addDays = (day: string, days: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export async function dispense(
  db: Database,
  prescriptionId: string,
  input: DispenseInput,
  actor: Actor,
  context: AuditContext,
): Promise<{ dispensingId: string; dispenseNo: string; replayed: boolean }> {
  const today = hospitalToday();
  const itemIds = input.lines.map((l) => l.prescriptionItemId);
  if (new Set(itemIds).size !== itemIds.length) {
    throw new AppError(422, 'DUPLICATE_ITEM', 'Each prescription item can appear only once.');
  }
  return withTransaction(db, async (tx) => {
    // 1. Idempotency.
    const seen = await tx.query<{ id: string; dispenseNo: string; prescriptionId: string }>(
      `SELECT id, dispense_no AS "dispenseNo", prescription_id AS "prescriptionId" FROM dispensings WHERE idempotency_key = $1`,
      [input.idempotencyKey],
    );
    if (seen.rows[0]) {
      if (seen.rows[0].prescriptionId !== prescriptionId) {
        throw new AppError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'This request key was used for another prescription.',
        );
      }
      return { dispensingId: seen.rows[0].id, dispenseNo: seen.rows[0].dispenseNo, replayed: true };
    }

    // 2. The prescription.
    const { rows: rxRows } = await tx.query<{
      id: string;
      status: string;
      patientId: string;
      appointmentId: string;
    }>(
      `SELECT p.id, p.status, p.patient_id AS "patientId", e.appointment_id AS "appointmentId"
       FROM prescriptions p JOIN encounters e ON e.id = p.encounter_id WHERE p.id = $1 FOR UPDATE OF p`,
      [prescriptionId],
    );
    const rx = rxRows[0];
    if (!rx) throw new AppError(404, 'NOT_FOUND', 'Prescription not found');
    if (rx.status !== 'issued' && rx.status !== 'partially_dispensed') {
      throw new AppError(
        409,
        'NOT_DISPENSABLE',
        `This prescription is ${rx.status.replace('_', ' ')}.`,
      );
    }
    const location = await findLocation(tx, input.locationId);
    if (!location || location.kind !== 'pharmacy') {
      throw new AppError(422, 'NOT_A_PHARMACY', 'Dispense from a pharmacy location.');
    }

    // Allergy check against the dispensed medicines (the prescriber may have acknowledged
    // it; the pharmacist confirms again).
    const { rows: items } = await tx.query<Item>(
      `SELECT i.id, i.medicine_product_id AS "productId", s.name AS product, i.qty_prescribed AS "qtyPrescribed",
              i.qty_dispensed AS "qtyDispensed", i.duration_days AS "durationDays"
       FROM prescription_items i JOIN stock_items s ON s.id = i.medicine_product_id
       WHERE i.prescription_id = $1 AND i.id = ANY($2::uuid[]) ORDER BY i.id FOR UPDATE OF i`,
      [prescriptionId, itemIds],
    );
    if (items.length !== itemIds.length)
      throw new AppError(422, 'UNKNOWN_ITEM', 'An item is not on this prescription.');
    const { rows: conflicts } = await tx.query<{ substance: string; product: string }>(
      `SELECT DISTINCT a.substance, s.name AS product FROM allergies a
       JOIN product_ingredients pi ON pi.product_id = ANY($2::uuid[])
       JOIN ingredients ig ON ig.id = pi.ingredient_id JOIN stock_items s ON s.id = pi.product_id
       WHERE a.patient_id = $1 AND a.status = 'active'
         AND (a.ingredient_id = pi.ingredient_id OR lower(trim(a.substance)) = lower(ig.name::text))`,
      [rx.patientId, items.map((i) => i.productId)],
    );
    if (conflicts.length > 0 && !input.allergyAck) {
      throw new AppError(
        409,
        'ALLERGY_CONFLICT',
        `Recorded allergy matches: ${conflicts.map((c) => `${c.product} (${c.substance})`).join(', ')}.`,
        { conflicts },
      );
    }

    // 3–4. Plan FEFO allocations, locking every candidate batch in ascending id order.
    const want = new Map(input.lines.map((l) => [l.prescriptionItemId, l.qty]));
    for (const item of items) {
      const outstanding = item.qtyPrescribed - item.qtyDispensed;
      if (want.get(item.id)! > outstanding) {
        throw new AppError(
          409,
          'OVER_DISPENSE',
          `${item.product}: only ${outstanding} still to dispense.`,
        );
      }
    }
    const { rows: nearRows } = await tx.query<{ days: number }>(
      'SELECT near_expiry_days AS days FROM hospital_settings WHERE id = 1',
    );
    const nearLimit = addDays(today, nearRows[0]?.days ?? 30);
    const { rows: candidates } = await tx.query<Batch>(
      `SELECT id, stock_item_id AS "stockItemId", batch_no AS "batchNo", expiry_date::text AS "expiryDate",
              qty_on_hand AS "qtyOnHand", sale_price_paise::int AS "salePricePaise"
       FROM stock_batches
       WHERE location_id = $1 AND stock_item_id = ANY($2::uuid[]) AND status = 'active'
         AND qty_on_hand > 0 AND expiry_date >= $3::date
       ORDER BY id FOR UPDATE`,
      [location.id, items.map((i) => i.productId), today],
    );
    const plan: { item: Item; batch: Batch; qty: number }[] = [];
    const nearExpiry: string[] = [];
    for (const item of items) {
      let needed = want.get(item.id)!;
      // The batch must last the whole course, counted from today (conservative, ERD §5).
      const lastDay = item.durationDays ? addDays(today, item.durationDays - 1) : today;
      const usable = candidates
        .filter((b) => b.stockItemId === item.productId && b.expiryDate >= lastDay)
        .sort(
          (a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.batchNo.localeCompare(b.batchNo),
        );
      for (const batch of usable) {
        if (needed === 0) break;
        const take = Math.min(needed, batch.qtyOnHand);
        plan.push({ item, batch, qty: take });
        if (batch.expiryDate <= nearLimit)
          nearExpiry.push(`${item.product} batch ${batch.batchNo} (expires ${batch.expiryDate})`);
        needed -= take;
      }
      if (needed > 0) {
        throw new AppError(
          409,
          'INSUFFICIENT_STOCK',
          `${item.product}: not enough usable stock at ${location.name}.`,
          { itemId: item.id, short: needed },
        );
      }
    }
    if (nearExpiry.length > 0 && !input.nearExpiryAck) {
      throw new AppError(
        409,
        'NEAR_EXPIRY',
        `Near-expiry stock would be used: ${nearExpiry.join('; ')}.`,
        { batches: nearExpiry },
      );
    }

    // 5. Write it all.
    const { rows: dRows } = await tx.query<{ id: string; dispenseNo: string }>(
      `INSERT INTO dispensings (prescription_id, patient_id, location_id, idempotency_key, dispensed_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, dispense_no AS "dispenseNo"`,
      [prescriptionId, rx.patientId, location.id, input.idempotencyKey, actor.userId],
    );
    const dispensing = dRows[0]!;
    const invoiceId = await draftInvoiceForVisit(
      tx,
      { patientId: rx.patientId, appointmentId: rx.appointmentId, userId: actor.userId },
      context,
    );
    for (const p of plan) {
      const { movementId } = await moveStock(tx, {
        batchId: p.batch.id,
        locationId: location.id,
        kind: 'dispense',
        delta: -p.qty,
        refType: 'dispensing',
        refId: dispensing.id,
        userId: actor.userId,
      });
      const { rows: line } = await tx.query<{ id: string }>(
        `INSERT INTO dispensing_lines (dispensing_id, prescription_id, prescription_item_id, batch_id, dispensed_product_id, qty, unit_price_paise, stock_movement_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          dispensing.id,
          prescriptionId,
          p.item.id,
          p.batch.id,
          p.item.productId,
          p.qty,
          p.batch.salePricePaise,
          movementId,
        ],
      );
      await addInvoiceLine(tx, invoiceId, {
        sourceType: 'dispensing',
        description: `${p.item.product} (batch ${p.batch.batchNo})`,
        dispensingLineId: line[0]!.id,
        qty: p.qty,
        unitPricePaise: p.batch.salePricePaise,
        userId: actor.userId,
      });
    }
    for (const item of items) {
      await tx.query(
        'UPDATE prescription_items SET qty_dispensed = qty_dispensed + $2, updated_at = now() WHERE id = $1',
        [item.id, want.get(item.id)!],
      );
    }
    const { rows: left } = await tx.query<{ open: number }>(
      'SELECT count(*)::int AS open FROM prescription_items WHERE prescription_id = $1 AND qty_dispensed < qty_prescribed',
      [prescriptionId],
    );
    await tx.query('UPDATE prescriptions SET status = $2, updated_by = $3 WHERE id = $1', [
      prescriptionId,
      left[0]!.open === 0 ? 'dispensed' : 'partially_dispensed',
      actor.userId,
    ]);

    // 6. Audit.
    await recordAudit(
      tx,
      {
        actor: { type: 'user', userId: actor.userId },
        action: 'dispensing.created',
        entityType: 'dispensing',
        entityId: dispensing.id,
        patientId: rx.patientId,
        changes: {
          prescriptionId,
          lines: plan.length,
          nearExpiryAck: nearExpiry.length > 0,
          allergyAck: conflicts.length > 0,
        },
      },
      context,
    );
    return { dispensingId: dispensing.id, dispenseNo: dispensing.dispenseNo, replayed: false };
  });
}

/** Ends a prescription with items still outstanding (e.g. the patient declined them). */
export async function closePrescription(
  db: Database,
  id: string,
  reason: string,
  actor: Actor,
  context: AuditContext,
) {
  return withTransaction(db, async (tx: Queryable) => {
    const { rows } = await tx.query<{ status: string; patientId: string }>(
      'SELECT status, patient_id AS "patientId" FROM prescriptions WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Prescription not found');
    if (rows[0].status !== 'issued' && rows[0].status !== 'partially_dispensed') {
      throw new AppError(409, 'INVALID_TRANSITION', `This prescription is ${rows[0].status}.`);
    }
    await tx.query(`UPDATE prescriptions SET status = 'closed', updated_by = $2 WHERE id = $1`, [
      id,
      actor.userId,
    ]);
    await recordAudit(
      tx,
      {
        actor: { type: 'user', userId: actor.userId },
        action: 'prescription.closed',
        entityType: 'prescription',
        entityId: id,
        patientId: rows[0].patientId,
        reason: reason.slice(0, 200),
      },
      context,
    );
  });
}
