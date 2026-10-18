/**
 *   GET  /api/services                       signed in with invoice:read | price:manage | lab_order:create
 *   POST /api/services, PATCH /:id           price:manage (new prices apply to new charges only)
 *   GET  /api/invoices?status=&patientId=&from=&to=   invoice:read
 *   GET  /api/invoices/:id                   invoice:read
 *   POST /api/invoices/:id/issue             invoice:issue (gapless number)
 *   POST /api/invoices/:id/lines             invoice:issue (manual services on drafts)
 *   POST /api/invoices/:id/payments          payment:record (idempotent; never above the balance)
 *   POST /api/invoices/:id/void              invoice:discard_draft (drafts) | invoice:void (unpaid issued)
 *   GET  /api/billing/summary?from=&to=      report:finance
 */
import {
  addManualLineSchema,
  createServiceSchema,
  invoiceListSchema,
  recordPaymentSchema,
  updateServicePriceSchema,
  voidInvoiceSchema,
} from '@hospitalos/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { Database } from '../../db/client.js';
import { auditContext } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { requireAnyPermission, requirePermission, requireUser } from '../../middleware/auth.js';
import { findInvoice, listInvoices } from './billing.repo.js';
import {
  addManualLine,
  createService,
  issueInvoice,
  recordPayment,
  updateService,
  voidInvoice,
} from './billing.service.js';

const uuid = (value: unknown, what = 'Invoice') => {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new AppError(404, 'NOT_FOUND', `${what} not found`);
  return parsed.data;
};

export function billingRoutes(db: Database): Router {
  const router = Router();
  const canRead = requirePermission(db, 'invoice:read');

  router.get(
    '/services',
    requireAnyPermission(db, ['invoice:read', 'price:manage', 'lab_order:create']),
    async (_req, res) => {
      const { rows } = await db.query(
        `SELECT id, code, name, kind, price_paise::int AS "pricePaise", active FROM service_catalogue ORDER BY kind, name`,
      );
      res.json({ services: rows });
    },
  );
  router.post('/services', requirePermission(db, 'price:manage'), async (req, res) => {
    const input = createServiceSchema.parse(req.body);
    const id = await createService(
      db,
      input,
      { userId: requireUser(res).id },
      auditContext(req, res),
    );
    res.status(201).json({ serviceId: id });
  });
  router.patch('/services/:id', requirePermission(db, 'price:manage'), async (req, res) => {
    const input = updateServicePriceSchema.parse(req.body);
    await updateService(
      db,
      uuid(req.params.id, 'Service'),
      input,
      { userId: requireUser(res).id },
      auditContext(req, res),
    );
    res.json({ ok: true });
  });

  router.get('/invoices', canRead, async (req, res) => {
    res.json({ invoices: await listInvoices(db, invoiceListSchema.parse(req.query)) });
  });
  router.get('/invoices/:id', canRead, async (req, res) => {
    const invoice = await findInvoice(db, uuid(req.params.id));
    if (!invoice) throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
    res.json({ invoice });
  });
  router.post('/invoices/:id/issue', requirePermission(db, 'invoice:issue'), async (req, res) => {
    const id = uuid(req.params.id);
    await issueInvoice(db, id, { userId: requireUser(res).id }, auditContext(req, res));
    res.json({ invoice: await findInvoice(db, id) });
  });
  router.post('/invoices/:id/lines', requirePermission(db, 'invoice:issue'), async (req, res) => {
    const id = uuid(req.params.id);
    await addManualLine(
      db,
      id,
      addManualLineSchema.parse(req.body),
      { userId: requireUser(res).id },
      auditContext(req, res),
    );
    res.status(201).json({ invoice: await findInvoice(db, id) });
  });
  router.post(
    '/invoices/:id/payments',
    requirePermission(db, 'payment:record'),
    async (req, res) => {
      const id = uuid(req.params.id);
      const result = await recordPayment(
        db,
        id,
        recordPaymentSchema.parse(req.body),
        { userId: requireUser(res).id },
        auditContext(req, res),
      );
      res
        .status(result.replayed ? 200 : 201)
        .json({ receiptNo: result.receiptNo, invoice: await findInvoice(db, id) });
    },
  );
  router.post(
    '/invoices/:id/void',
    requireAnyPermission(db, ['invoice:discard_draft', 'invoice:void']),
    async (req, res) => {
      const id = uuid(req.params.id);
      const { reason } = voidInvoiceSchema.parse(req.body);
      const user = requireUser(res);
      await voidInvoice(
        db,
        id,
        reason,
        { userId: user.id, canVoidIssued: user.can('invoice:void') },
        auditContext(req, res),
      );
      res.json({ invoice: await findInvoice(db, id) });
    },
  );

  router.get('/billing/summary', requirePermission(db, 'report:finance'), async (req, res) => {
    const { from, to } = z.strictObject({ from: z.iso.date(), to: z.iso.date() }).parse(req.query);
    const { rows } = await db.query(
      `SELECT
         (SELECT count(*)::int FROM invoices WHERE status NOT IN ('draft', 'void')
            AND (issued_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1 AND $2) AS "invoicesIssued",
         (SELECT coalesce(sum(total_paise), 0)::bigint FROM invoices WHERE status NOT IN ('draft', 'void')
            AND (issued_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1 AND $2)::text AS "invoicedPaise",
         (SELECT coalesce(sum(amount_paise), 0)::bigint FROM payments
            WHERE (received_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1 AND $2)::text AS "collectedPaise",
         (SELECT coalesce(json_object_agg(method, total), '{}') FROM (
            SELECT method, sum(amount_paise)::bigint::text AS total FROM payments
            WHERE (received_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1 AND $2 GROUP BY method) m) AS "byMethod",
         (SELECT coalesce(sum(total_paise - paid_paise), 0)::bigint FROM invoices
            WHERE status IN ('issued', 'partially_paid'))::text AS "outstandingPaise",
         (SELECT coalesce(sum(amount_paise), 0)::bigint FROM expenses WHERE status = 'approved'
            AND expense_date BETWEEN $1 AND $2)::text AS "approvedExpensesPaise"`,
      [from, to],
    );
    res.json({ summary: rows[0] });
  });

  return router;
}
