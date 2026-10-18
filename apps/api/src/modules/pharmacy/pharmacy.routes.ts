/**
 *   GET  /api/pharmacy/prescriptions?status=open|dispensed|all   prescription:dispense | prescription:close
 *   GET  /api/pharmacy/prescriptions/:id                         same; with the patient's active allergies
 *                                                                 and usable batches (FEFO) per item
 *   POST /api/pharmacy/prescriptions/:id/dispense                prescription:dispense
 *   POST /api/pharmacy/prescriptions/:id/close                   prescription:close
 * Pharmacy sees only what dispensing needs (docs/permissions.md note 2): the prescription,
 * the patient's identifiers and active allergies; never notes or diagnoses.
 */
import { closePrescriptionSchema, dispenseSchema } from '@hospitalos/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { Database } from '../../db/client.js';
import { auditContext } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { requireAnyPermission, requirePermission, requireUser } from '../../middleware/auth.js';
import { PRESCRIPTION_FROM, PRESCRIPTION_JSON } from '../clinical/clinical.repo.js';
import { closePrescription, dispense } from './pharmacy.service.js';

const uuid = (value: unknown) => {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new AppError(404, 'NOT_FOUND', 'Prescription not found');
  return parsed.data;
};

const ALLERGIES = `(SELECT coalesce(json_agg(json_build_object('id', a.id, 'substance', a.substance,
   'reaction', a.reaction, 'severity', a.severity)), '[]') FROM allergies a
   WHERE a.patient_id = p.patient_id AND a.status = 'active')`;

export function pharmacyRoutes(db: Database): Router {
  const router = Router();
  const canView = requireAnyPermission(db, ['prescription:dispense', 'prescription:close']);

  router.get('/pharmacy/prescriptions', canView, async (req, res) => {
    const { status } = z
      .object({ status: z.enum(['open', 'dispensed', 'all']).default('open') })
      .parse(req.query);
    const statuses =
      status === 'open'
        ? ['issued', 'partially_dispensed']
        : status === 'dispensed'
          ? ['dispensed', 'closed']
          : ['issued', 'partially_dispensed', 'dispensed', 'closed', 'cancelled'];
    const { rows } = await db.query(
      `SELECT ${PRESCRIPTION_JSON} AS p, ${ALLERGIES} AS allergies ${PRESCRIPTION_FROM}
       WHERE p.status = ANY($1::text[]) ORDER BY p.issued_at ${status === 'open' ? 'ASC' : 'DESC'} LIMIT 200`,
      [statuses],
    );
    res.json({ prescriptions: rows.map((r) => ({ ...r.p, allergies: r.allergies })) });
  });

  router.get('/pharmacy/prescriptions/:id', canView, async (req, res) => {
    const id = uuid(req.params.id);
    const { rows } = await db.query(
      `SELECT ${PRESCRIPTION_JSON} AS p, ${ALLERGIES} AS allergies,
         (SELECT coalesce(json_agg(json_build_object('itemId', i.id, 'batches', (
             SELECT coalesce(json_agg(json_build_object('id', b.id, 'batchNo', b.batch_no, 'expiryDate', b.expiry_date,
                 'qtyOnHand', b.qty_on_hand, 'salePricePaise', b.sale_price_paise,
                 'location', json_build_object('id', l.id, 'name', l.name))
               ORDER BY b.expiry_date, b.batch_no), '[]')
             FROM stock_batches b JOIN locations l ON l.id = b.location_id
             WHERE b.stock_item_id = i.medicine_product_id AND l.kind = 'pharmacy' AND l.active
               AND b.status = 'active' AND b.qty_on_hand > 0
               AND b.expiry_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date))), '[]')
          FROM prescription_items i WHERE i.prescription_id = p.id) AS availability,
         (SELECT coalesce(json_agg(json_build_object('id', d.id, 'dispenseNo', d.dispense_no, 'dispensedAt', d.dispensed_at,
             'by', de.full_name, 'lines', (SELECT json_agg(json_build_object('product', si.name, 'batchNo', b.batch_no,
                 'qty', dl.qty, 'unitPricePaise', dl.unit_price_paise))
               FROM dispensing_lines dl JOIN stock_batches b ON b.id = dl.batch_id JOIN stock_items si ON si.id = dl.dispensed_product_id
               WHERE dl.dispensing_id = d.id)) ORDER BY d.dispensed_at), '[]')
          FROM dispensings d JOIN users du ON du.id = d.dispensed_by JOIN employees de ON de.id = du.employee_id
          WHERE d.prescription_id = p.id) AS dispensings
       ${PRESCRIPTION_FROM} WHERE p.id = $1`,
      [id],
    );
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Prescription not found');
    const r = rows[0];
    res.json({
      prescription: {
        ...r.p,
        allergies: r.allergies,
        availability: r.availability,
        dispensings: r.dispensings,
      },
    });
  });

  router.post(
    '/pharmacy/prescriptions/:id/dispense',
    requirePermission(db, 'prescription:dispense'),
    async (req, res) => {
      const input = dispenseSchema.parse(req.body);
      const result = await dispense(
        db,
        uuid(req.params.id),
        input,
        { userId: requireUser(res).id },
        auditContext(req, res),
      );
      res.status(result.replayed ? 200 : 201).json(result);
    },
  );

  router.post(
    '/pharmacy/prescriptions/:id/close',
    requirePermission(db, 'prescription:close'),
    async (req, res) => {
      const { reason } = closePrescriptionSchema.parse(req.body);
      await closePrescription(
        db,
        uuid(req.params.id),
        reason,
        { userId: requireUser(res).id },
        auditContext(req, res),
      );
      res.json({ ok: true });
    },
  );

  return router;
}
