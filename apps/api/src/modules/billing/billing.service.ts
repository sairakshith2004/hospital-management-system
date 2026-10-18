/** Issuing, payments, voiding, manual lines and the price list. */
import { withTransaction, type Database, type Queryable } from '../../db/client.js';
import { recordAudit, type AuditContext } from '../../lib/audit.js';
import { nextDocumentNo } from '../../lib/documents.js';
import { AppError } from '../../lib/errors.js';
import { addInvoiceLine } from './billing.repo.js';

export interface Actor {
  userId: string;
}

interface LockedInvoice {
  id: string;
  patientId: string;
  status: string;
  totalPaise: number;
  paidPaise: number;
}

async function lockInvoice(tx: Queryable, id: string): Promise<LockedInvoice> {
  const { rows } = await tx.query<LockedInvoice>(
    `SELECT id, patient_id AS "patientId", status, total_paise::int AS "totalPaise", paid_paise::int AS "paidPaise"
     FROM invoices WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  return rows[0];
}

const audit = (
  tx: Queryable,
  actor: Actor,
  context: AuditContext,
  inv: LockedInvoice,
  action: string,
  changes?: Record<string, string | number>,
) =>
  recordAudit(
    tx,
    {
      actor: { type: 'user', userId: actor.userId },
      action,
      entityType: 'invoice',
      entityId: inv.id,
      patientId: inv.patientId,
      ...(changes ? { changes } : {}),
    },
    context,
  );

/** draft → issued with the next gapless invoice number. */
export async function issueInvoice(db: Database, id: string, actor: Actor, context: AuditContext) {
  return withTransaction(db, async (tx) => {
    const inv = await lockInvoice(tx, id);
    if (inv.status !== 'draft')
      throw new AppError(409, 'INVALID_TRANSITION', `This invoice is already ${inv.status}.`);
    const lines = await tx.query(
      'SELECT 1 FROM invoice_items WHERE invoice_id = $1 AND is_active',
      [id],
    );
    if (!lines.rowCount)
      throw new AppError(409, 'EMPTY_INVOICE', 'An invoice needs at least one charge.');
    const invoiceNo = await nextDocumentNo(tx, 'INV');
    await tx.query(
      `UPDATE invoices SET status = 'issued', invoice_no = $2, issued_at = now(), issued_by = $3,
         updated_by = $3, version = version + 1 WHERE id = $1`,
      [id, invoiceNo, actor.userId],
    );
    // Nothing to pay (e.g. a free consultation): settled as soon as it is issued.
    await tx.query(`UPDATE invoices SET status = 'paid' WHERE id = $1 AND total_paise = 0`, [id]);
    await audit(tx, actor, context, inv, 'invoice.issued', { invoiceNo });
    return invoiceNo;
  });
}

/**
 * Records a payment against an issued invoice. Idempotent: the same key returns the first
 * payment. A payment can never exceed the balance, and the invoice becomes paid only when
 * completed payments cover its total.
 */
export async function recordPayment(
  db: Database,
  id: string,
  input: {
    amountPaise: number;
    method: string;
    reference?: string | null | undefined;
    idempotencyKey: string;
  },
  actor: Actor,
  context: AuditContext,
): Promise<{ receiptNo: string; replayed: boolean }> {
  return withTransaction(db, async (tx) => {
    const inv = await lockInvoice(tx, id);
    const prior = await tx.query<{ receiptNo: string; invoiceId: string }>(
      'SELECT receipt_no AS "receiptNo", invoice_id AS "invoiceId" FROM payments WHERE idempotency_key = $1',
      [input.idempotencyKey],
    );
    if (prior.rows[0]) {
      if (prior.rows[0].invoiceId !== id)
        throw new AppError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'This payment key was used for another invoice.',
        );
      return { receiptNo: prior.rows[0].receiptNo, replayed: true };
    }
    if (inv.status !== 'issued' && inv.status !== 'partially_paid') {
      throw new AppError(
        409,
        'NOT_PAYABLE',
        inv.status === 'draft'
          ? 'Issue the invoice before taking payment.'
          : `This invoice is ${inv.status}.`,
      );
    }
    const balance = inv.totalPaise - inv.paidPaise;
    if (input.amountPaise > balance) {
      throw new AppError(409, 'OVERPAYMENT', `The balance is only ${(balance / 100).toFixed(2)}.`, {
        balancePaise: balance,
      });
    }
    const receiptNo = await nextDocumentNo(tx, 'RCT');
    await tx.query(
      `INSERT INTO payments (receipt_no, invoice_id, amount_paise, method, reference, idempotency_key, received_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        receiptNo,
        id,
        input.amountPaise,
        input.method,
        input.reference ?? null,
        input.idempotencyKey,
        actor.userId,
      ],
    );
    const paid = inv.paidPaise + input.amountPaise;
    await tx.query(
      `UPDATE invoices SET paid_paise = $2, status = $3, updated_by = $4, version = version + 1 WHERE id = $1`,
      [id, paid, paid === inv.totalPaise ? 'paid' : 'partially_paid', actor.userId],
    );
    await audit(tx, actor, context, inv, 'payment.recorded', {
      receiptNo,
      amountPaise: input.amountPaise,
      method: input.method,
    });
    return { receiptNo, replayed: false };
  });
}

/** Voids a draft, or an issued invoice with nothing paid. The lines and history are kept. */
export async function voidInvoice(
  db: Database,
  id: string,
  reason: string,
  actor: Actor & { canVoidIssued: boolean },
  context: AuditContext,
) {
  return withTransaction(db, async (tx) => {
    const inv = await lockInvoice(tx, id);
    if (
      inv.status === 'draft' ||
      (inv.status === 'issued' && inv.paidPaise === 0 && actor.canVoidIssued)
    ) {
      await tx.query(
        `UPDATE invoices SET status = 'void', void_reason = $2, updated_by = $3, version = version + 1 WHERE id = $1`,
        [id, reason, actor.userId],
      );
      await audit(tx, actor, context, inv, 'invoice.voided', { fromStatus: inv.status });
      return;
    }
    if (inv.status === 'issued' && !actor.canVoidIssued)
      throw new AppError(403, 'FORBIDDEN', 'You do not have permission to do this');
    throw new AppError(
      409,
      'NOT_VOIDABLE',
      inv.paidPaise > 0
        ? 'An invoice with payments cannot be voided.'
        : `This invoice is ${inv.status}.`,
    );
  });
}

/** Adds a priced service (e.g. a procedure) to a draft invoice. */
export async function addManualLine(
  db: Database,
  id: string,
  input: { serviceId: string; qty: number },
  actor: Actor,
  context: AuditContext,
) {
  return withTransaction(db, async (tx) => {
    const inv = await lockInvoice(tx, id);
    if (inv.status !== 'draft')
      throw new AppError(409, 'NOT_DRAFT', 'Charges can only be added to a draft invoice.');
    const { rows } = await tx.query<{ name: string; pricePaise: number; kind: string }>(
      `SELECT name, price_paise::int AS "pricePaise", kind FROM service_catalogue WHERE id = $1 AND active`,
      [input.serviceId],
    );
    const svc = rows[0];
    if (!svc) throw new AppError(422, 'UNKNOWN_SERVICE', 'Service not found.');
    if (svc.kind === 'consultation' || svc.kind === 'lab') {
      throw new AppError(
        422,
        'AUTOMATIC_CHARGE',
        'Consultation and lab charges are added automatically from the visit.',
      );
    }
    await addInvoiceLine(tx, id, {
      sourceType: 'manual',
      description: svc.name,
      serviceId: input.serviceId,
      qty: input.qty,
      unitPricePaise: svc.pricePaise,
      userId: actor.userId,
    });
    await audit(tx, actor, context, inv, 'invoice.line_added', { source: 'manual' });
  });
}

export async function createService(
  db: Database,
  input: { code: string; name: string; kind: string; pricePaise: number },
  actor: Actor,
  context: AuditContext,
) {
  try {
    return await withTransaction(db, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO service_catalogue (code, name, kind, price_paise, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
        [input.code, input.name, input.kind, input.pricePaise, actor.userId],
      );
      await recordAudit(
        tx,
        {
          actor: { type: 'user', userId: actor.userId },
          action: 'price.created',
          entityType: 'service',
          entityId: rows[0]!.id,
          changes: { pricePaise: input.pricePaise },
        },
        context,
      );
      return rows[0]!.id;
    });
  } catch (err) {
    if ((err as { code?: string }).code === '23505')
      throw new AppError(409, 'DUPLICATE', 'A service with this code already exists.');
    throw err;
  }
}

/** New price applies to new charges only: existing invoice lines keep their copied price. */
export async function updateService(
  db: Database,
  id: string,
  input: { pricePaise: number; active?: boolean | undefined },
  actor: Actor,
  context: AuditContext,
) {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ old: number }>(
      'SELECT price_paise::int AS old FROM service_catalogue WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Service not found');
    await tx.query(
      'UPDATE service_catalogue SET price_paise = $2, active = coalesce($3, active), updated_by = $4 WHERE id = $1',
      [id, input.pricePaise, input.active ?? null, actor.userId],
    );
    await recordAudit(
      tx,
      {
        actor: { type: 'user', userId: actor.userId },
        action: 'price.changed',
        entityType: 'service',
        entityId: id,
        changes: { from: rows[0].old, to: input.pricePaise },
      },
      context,
    );
  });
}
