/**
 * Invoice building blocks used inside other modules' transactions (check-in, dispensing,
 * lab orders). Lock order (ERD §4): the source record first, then the invoice.
 */
import type { InvoiceSourceType, InvoiceSummary, InvoiceView } from '@hospitalos/shared';
import type { Queryable } from '../../db/client.js';
import { recordAudit, type AuditContext } from '../../lib/audit.js';

/** The visit's draft invoice, created if needed, locked for the rest of the transaction. */
export async function draftInvoiceForVisit(
  db: Queryable,
  v: { patientId: string; appointmentId: string; userId: string },
  context: AuditContext,
): Promise<string> {
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM invoices WHERE appointment_id = $1 AND status = 'draft' FOR UPDATE`,
    [v.appointmentId],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO invoices (patient_id, appointment_id, created_by, updated_by) VALUES ($1, $2, $3, $3) RETURNING id`,
    [v.patientId, v.appointmentId, v.userId],
  );
  await recordAudit(
    db,
    {
      actor: { type: 'user', userId: v.userId },
      action: 'invoice.created',
      entityType: 'invoice',
      entityId: rows[0]!.id,
      patientId: v.patientId,
    },
    context,
  );
  return rows[0]!.id;
}

export async function addInvoiceLine(
  db: Queryable,
  invoiceId: string,
  line: {
    sourceType: InvoiceSourceType;
    description: string;
    serviceId?: string | null;
    consultationAppointmentId?: string | null;
    dispensingLineId?: string | null;
    labOrderId?: string | null;
    qty: number;
    unitPricePaise: number;
    userId: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO invoice_items (invoice_id, service_id, description, source_type, consultation_appointment_id,
       dispensing_line_id, lab_order_id, qty, unit_price_paise, line_total_paise, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8::int * $9::bigint, $10)`,
    [
      invoiceId,
      line.serviceId ?? null,
      line.description,
      line.sourceType,
      line.consultationAppointmentId ?? null,
      line.dispensingLineId ?? null,
      line.labOrderId ?? null,
      line.qty,
      line.unitPricePaise,
      line.userId,
    ],
  );
  await recomputeTotals(db, invoiceId);
}

/** subtotal = active lines; total = subtotal − discount + tax (no discounts or tax in the MVP). */
export async function recomputeTotals(db: Queryable, invoiceId: string): Promise<void> {
  await db.query(
    `UPDATE invoices i SET subtotal_paise = s.sum, total_paise = s.sum - i.discount_paise + i.tax_paise, version = version + 1
     FROM (SELECT coalesce(sum(line_total_paise), 0) AS sum FROM invoice_items WHERE invoice_id = $1 AND is_active) s
     WHERE i.id = $1`,
    [invoiceId],
  );
}

/**
 * Deactivates the active line for a source while its invoice is still a draft. Returns
 * false when the line is on an issued invoice (that needs a credit note, which the MVP
 * doesn't have: the charge stays and the cancellation is still recorded).
 */
export async function deactivateSourceLine(
  db: Queryable,
  source: { consultationAppointmentId?: string; labOrderId?: string },
): Promise<boolean> {
  const column = source.consultationAppointmentId ? 'consultation_appointment_id' : 'lab_order_id';
  const value = source.consultationAppointmentId ?? source.labOrderId;
  const { rows } = await db.query<{ id: string; invoiceId: string; status: string }>(
    `SELECT it.id, it.invoice_id AS "invoiceId", i.status FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
     WHERE it.${column} = $1 AND it.is_active FOR UPDATE OF i`,
    [value],
  );
  const line = rows[0];
  if (!line) return true;
  if (line.status !== 'draft') return false;
  await db.query('UPDATE invoice_items SET is_active = false WHERE id = $1', [line.id]);
  await recomputeTotals(db, line.invoiceId);
  return true;
}

const SUMMARY = `i.id, i.invoice_no AS "invoiceNo", i.status,
  json_build_object('id', p.id, 'mrn', p.mrn, 'firstName', p.first_name, 'lastName', p.last_name) AS patient,
  i.appointment_id AS "appointmentId", i.total_paise::int AS "totalPaise", i.paid_paise::int AS "paidPaise",
  (i.total_paise - i.paid_paise)::int AS "balancePaise", i.created_at AS "createdAt", i.issued_at AS "issuedAt"`;

export async function listInvoices(
  db: Queryable,
  f: {
    status?: string | undefined;
    patientId?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
  },
): Promise<InvoiceSummary[]> {
  const { rows } = await db.query<InvoiceSummary>(
    `SELECT ${SUMMARY} FROM invoices i JOIN patients p ON p.id = i.patient_id
     WHERE ($1::text IS NULL OR i.status = $1) AND ($2::uuid IS NULL OR i.patient_id = $2)
       AND ($3::date IS NULL OR (i.created_at AT TIME ZONE 'Asia/Kolkata')::date >= $3)
       AND ($4::date IS NULL OR (i.created_at AT TIME ZONE 'Asia/Kolkata')::date <= $4)
     ORDER BY i.created_at DESC LIMIT 200`,
    [f.status ?? null, f.patientId ?? null, f.from ?? null, f.to ?? null],
  );
  return rows;
}

export async function findInvoice(db: Queryable, id: string): Promise<InvoiceView | undefined> {
  const { rows } = await db.query<InvoiceView>(
    `SELECT ${SUMMARY}, i.subtotal_paise::int AS "subtotalPaise", i.discount_paise::int AS "discountPaise",
            i.tax_paise::int AS "taxPaise", i.void_reason AS "voidReason", i.version,
            (SELECT coalesce(json_agg(json_build_object('id', it.id, 'description', it.description,
                'sourceType', it.source_type, 'qty', it.qty, 'unitPricePaise', it.unit_price_paise,
                'lineTotalPaise', it.line_total_paise, 'isActive', it.is_active) ORDER BY it.created_at), '[]')
             FROM invoice_items it WHERE it.invoice_id = i.id) AS lines,
            (SELECT coalesce(json_agg(json_build_object('id', pm.id, 'receiptNo', pm.receipt_no,
                'amountPaise', pm.amount_paise, 'method', pm.method, 'reference', pm.reference,
                'receivedAt', pm.received_at, 'receivedBy', e.full_name) ORDER BY pm.received_at), '[]')
             FROM payments pm JOIN users u ON u.id = pm.received_by JOIN employees e ON e.id = u.employee_id
             WHERE pm.invoice_id = i.id) AS payments
     FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE i.id = $1`,
    [id],
  );
  return rows[0];
}
