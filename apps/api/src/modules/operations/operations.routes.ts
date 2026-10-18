/**
 * HR, finance, equipment and marketing MVPs. Each write is one transaction with its audit
 * row; decided leave and expenses are final (trigger), nobody decides their own request.
 *
 * HR         GET  /api/hr/attendance?date=          attendance:manage | employee:read
 *            POST /api/hr/attendance                attendance:manage (upsert one employee-day)
 *            POST /api/hr/employees/:id/status      employee:manage
 *            GET  /api/hr/leave?scope=mine|all      leave:request (mine) | leave:approve (all)
 *            POST /api/hr/leave                     leave:request (for yourself)
 *            POST /api/hr/leave/:id/decide          leave:approve (not your own)
 *            POST /api/hr/leave/:id/cancel          the requester, while pending
 * Finance    GET/POST /api/finance/categories       expense:create | expense:approve | report:finance; POST expense:create
 *            GET  /api/finance/expenses             expense:create | expense:approve | report:finance
 *            POST /api/finance/expenses             expense:create
 *            POST /api/finance/expenses/:id/decide  expense:approve (not your own)
 * Equipment  GET  /api/equipment                    equipment:manage | maintenance:log
 *            POST /api/equipment                    equipment:manage
 *            POST /api/equipment/:id/status         equipment:manage
 *            GET  /api/equipment/:id/maintenance    equipment:manage | maintenance:log
 *            POST /api/equipment/:id/maintenance    maintenance:log
 * Marketing  GET/POST /api/enquiries, POST /:id/status, GET/POST /:id/follow-ups,
 *            POST /api/enquiry-follow-ups/:id/done  enquiry:manage (contact details only, no clinical data)
 *            GET/POST /api/referral-sources         enquiry:manage | campaign:manage
 *            GET/POST /api/campaigns, POST /:id/status   campaign:manage (GET also report:marketing)
 *            GET  /api/marketing/summary            report:marketing (aggregates only)
 */
import {
  attendanceSchema,
  campaignSchema,
  campaignStatusSchema,
  enquiryFollowUpSchema,
  enquirySchema,
  enquiryUpdateSchema,
  equipmentSchema,
  equipmentStatusSchema,
  expenseCategorySchema,
  expenseDecisionSchema,
  expenseSchema,
  leaveDecisionSchema,
  leaveRequestSchema,
  maintenanceLogSchema,
  referralSourceSchema,
} from '@hospitalos/shared';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { withTransaction, type Database, type Queryable } from '../../db/client.js';
import { auditContext, recordAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { requireAnyPermission, requirePermission, requireUser } from '../../middleware/auth.js';

const uuid = (value: unknown, what = 'Record') => {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new AppError(404, 'NOT_FOUND', `${what} not found`);
  return parsed.data;
};
const pgCode = (err: unknown) => (err as { code?: string }).code;

/** Runs `work` in a transaction and writes its audit row in the same one. */
async function audited<T>(
  db: Database,
  req: Request,
  res: Response,
  entry: {
    action: string;
    entityType: string;
    reason?: string;
    changes?: Record<string, string | number | boolean | null>;
  },
  work: (tx: Queryable, userId: string) => Promise<{ id: string; result: T }>,
): Promise<T> {
  const userId = requireUser(res).id;
  return withTransaction(db, async (tx) => {
    const { id, result } = await work(tx, userId);
    await recordAudit(
      tx,
      { actor: { type: 'user', userId }, entityId: id, ...entry },
      auditContext(req, res),
    );
    return result;
  });
}

async function myEmployeeId(db: Queryable, userId: string) {
  const { rows } = await db.query<{ id: string }>(
    'SELECT employee_id AS id FROM users WHERE id = $1',
    [userId],
  );
  return rows[0]!.id;
}

export function operationsRoutes(db: Database): Router {
  const router = Router();

  // ---- HR ----
  router.get(
    '/hr/attendance',
    requireAnyPermission(db, ['attendance:manage', 'employee:read']),
    async (req, res) => {
      const { date } = z.object({ date: z.iso.date() }).parse(req.query);
      const { rows } = await db.query(
        `SELECT e.id AS "employeeId", e.employee_no AS "employeeNo", e.full_name AS "fullName", d.name AS department,
              a.id, a.status, to_char(a.check_in, 'HH24:MI') AS "checkIn", to_char(a.check_out, 'HH24:MI') AS "checkOut", a.notes,
              EXISTS (SELECT 1 FROM leave_requests l WHERE l.employee_id = e.id AND l.status = 'approved'
                        AND $1::date BETWEEN l.start_date AND l.end_date) AS "onLeave"
       FROM employees e JOIN departments d ON d.id = e.department_id
       LEFT JOIN attendance a ON a.employee_id = e.id AND a.work_date = $1
       WHERE e.employment_status <> 'exited' ORDER BY d.name, e.full_name`,
        [date],
      );
      res.json({ date, rows });
    },
  );
  router.post('/hr/attendance', requirePermission(db, 'attendance:manage'), async (req, res) => {
    const input = attendanceSchema.parse(req.body);
    await audited(
      db,
      req,
      res,
      { action: 'attendance.recorded', entityType: 'employee', changes: { status: input.status } },
      async (tx, userId) => {
        await tx.query(
          `INSERT INTO attendance (employee_id, work_date, status, check_in, check_out, notes, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         ON CONFLICT (employee_id, work_date) DO UPDATE SET status = EXCLUDED.status, check_in = EXCLUDED.check_in,
           check_out = EXCLUDED.check_out, notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by`,
          [
            input.employeeId,
            input.workDate,
            input.status,
            input.checkIn ?? null,
            input.checkOut ?? null,
            input.notes ?? null,
            userId,
          ],
        );
        return { id: input.employeeId, result: null };
      },
    ).catch((err) => {
      if (pgCode(err) === '23503')
        throw new AppError(422, 'UNKNOWN_EMPLOYEE', 'Employee not found.');
      if (pgCode(err) === '23514')
        throw new AppError(422, 'INVALID_TIMES', 'Check-out must be after check-in.');
      throw err;
    });
    res.json({ ok: true });
  });
  router.post(
    '/hr/employees/:id/status',
    requirePermission(db, 'employee:manage'),
    async (req, res) => {
      const id = uuid(req.params.id, 'Employee');
      const { status, reason } = z
        .strictObject({
          status: z.enum(['active', 'on_leave', 'exited']),
          reason: z.string().trim().min(1).max(200),
        })
        .parse(req.body);
      await audited(
        db,
        req,
        res,
        {
          action: 'employee.status_changed',
          entityType: 'employee',
          reason,
          changes: { to: status },
        },
        async (tx, userId) => {
          const { rowCount } = await tx.query(
            'UPDATE employees SET employment_status = $2, updated_by = $3 WHERE id = $1',
            [id, status, userId],
          );
          if (!rowCount) throw new AppError(404, 'NOT_FOUND', 'Employee not found');
          // Someone who has left loses access at once.
          if (status === 'exited') {
            await tx.query(
              `UPDATE users SET status = 'disabled', updated_by = $2 WHERE employee_id = $1`,
              [id, userId],
            );
            await tx.query(
              `DELETE FROM sessions WHERE sess->>'userId' IN (SELECT id::text FROM users WHERE employee_id = $1)`,
              [id],
            );
          }
          return { id, result: null };
        },
      );
      res.json({ ok: true });
    },
  );

  router.get(
    '/hr/leave',
    requireAnyPermission(db, ['leave:request', 'leave:approve']),
    async (req, res) => {
      const user = requireUser(res);
      const { scope } = z
        .object({ scope: z.enum(['mine', 'all']).default('mine') })
        .parse(req.query);
      if (scope === 'all' && !user.can('leave:approve'))
        throw new AppError(403, 'FORBIDDEN', 'You do not have permission to do this');
      const { rows } = await db.query(
        `SELECT l.id, l.kind, l.start_date::text AS "startDate", l.end_date::text AS "endDate", l.reason, l.status,
              l.decided_at AS "decidedAt", l.decision_note AS "decisionNote", l.created_at AS "createdAt",
              json_build_object('id', e.id, 'fullName', e.full_name, 'employeeNo', e.employee_no) AS employee,
              (l.created_by = $2) AS mine
       FROM leave_requests l JOIN employees e ON e.id = l.employee_id
       WHERE $1 = 'all' OR l.created_by = $2 ORDER BY l.created_at DESC LIMIT 200`,
        [scope, user.id],
      );
      res.json({ requests: rows });
    },
  );
  router.post('/hr/leave', requirePermission(db, 'leave:request'), async (req, res) => {
    const input = leaveRequestSchema.parse(req.body);
    const id = await audited(
      db,
      req,
      res,
      { action: 'leave.requested', entityType: 'leave_request' },
      async (tx, userId) => {
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO leave_requests (employee_id, kind, start_date, end_date, reason, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
          [
            await myEmployeeId(tx, userId),
            input.kind,
            input.startDate,
            input.endDate,
            input.reason,
            userId,
          ],
        );
        return { id: rows[0]!.id, result: rows[0]!.id };
      },
    );
    res.status(201).json({ leaveId: id });
  });
  router.post('/hr/leave/:id/decide', requirePermission(db, 'leave:approve'), async (req, res) => {
    const id = uuid(req.params.id, 'Leave request');
    const { decision, note } = leaveDecisionSchema.parse(req.body);
    await audited(
      db,
      req,
      res,
      { action: `leave.${decision}`, entityType: 'leave_request' },
      async (tx, userId) => {
        const { rows } = await tx.query<{ status: string; createdBy: string }>(
          'SELECT status, created_by AS "createdBy" FROM leave_requests WHERE id = $1 FOR UPDATE',
          [id],
        );
        if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Leave request not found');
        if (rows[0].createdBy === userId)
          throw new AppError(409, 'SELF_DECISION', "You can't decide your own leave.");
        if (rows[0].status !== 'pending')
          throw new AppError(
            409,
            'INVALID_TRANSITION',
            `This request is already ${rows[0].status}.`,
          );
        await tx.query(
          'UPDATE leave_requests SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4, updated_by = $3 WHERE id = $1',
          [id, decision, userId, note ?? null],
        );
        return { id, result: null };
      },
    );
    res.json({ ok: true });
  });
  router.post('/hr/leave/:id/cancel', requirePermission(db, 'leave:request'), async (req, res) => {
    const id = uuid(req.params.id, 'Leave request');
    await audited(
      db,
      req,
      res,
      { action: 'leave.cancelled', entityType: 'leave_request' },
      async (tx, userId) => {
        const { rows } = await tx.query<{ status: string; createdBy: string }>(
          'SELECT status, created_by AS "createdBy" FROM leave_requests WHERE id = $1 FOR UPDATE',
          [id],
        );
        if (!rows[0] || rows[0].createdBy !== userId)
          throw new AppError(404, 'NOT_FOUND', 'Leave request not found');
        if (rows[0].status !== 'pending')
          throw new AppError(409, 'INVALID_TRANSITION', 'Only a pending request can be cancelled.');
        await tx.query(
          `UPDATE leave_requests SET status = 'cancelled', updated_by = $2 WHERE id = $1`,
          [id, userId],
        );
        return { id, result: null };
      },
    );
    res.json({ ok: true });
  });

  // ---- Finance ----
  const financeView = requireAnyPermission(db, [
    'expense:create',
    'expense:approve',
    'report:finance',
  ]);
  router.get('/finance/categories', financeView, async (_req, res) => {
    const { rows } = await db.query(
      'SELECT id, code, name, active FROM expense_categories ORDER BY name',
    );
    res.json({ categories: rows });
  });
  router.post('/finance/categories', requirePermission(db, 'expense:create'), async (req, res) => {
    const input = expenseCategorySchema.parse(req.body);
    const id = await audited(
      db,
      req,
      res,
      { action: 'expense_category.created', entityType: 'expense_category' },
      async (tx, userId) => {
        const { rows } = await tx.query<{ id: string }>(
          'INSERT INTO expense_categories (code, name, created_by, updated_by) VALUES ($1, $2, $3, $3) RETURNING id',
          [input.code, input.name, userId],
        );
        return { id: rows[0]!.id, result: rows[0]!.id };
      },
    ).catch((err) => {
      if (pgCode(err) === '23505')
        throw new AppError(409, 'DUPLICATE', 'A category with this code exists.');
      throw err;
    });
    res.status(201).json({ categoryId: id });
  });
  router.get('/finance/expenses', financeView, async (req, res) => {
    const f = z
      .object({
        status: z.enum(['submitted', 'approved', 'rejected']).optional(),
        from: z.iso.date().optional(),
        to: z.iso.date().optional(),
      })
      .parse(req.query);
    const { rows } = await db.query(
      `SELECT x.id, x.expense_no AS "expenseNo", x.expense_date::text AS "expenseDate", x.amount_paise::int AS "amountPaise",
              x.payee, x.description, x.status, x.decided_at AS "decidedAt", x.decision_note AS "decisionNote",
              json_build_object('id', c.id, 'name', c.name) AS category,
              ce.full_name AS "submittedBy", de.full_name AS "decidedBy", (x.created_by = $4) AS mine
       FROM expenses x JOIN expense_categories c ON c.id = x.category_id
       JOIN users cu ON cu.id = x.created_by JOIN employees ce ON ce.id = cu.employee_id
       LEFT JOIN users du ON du.id = x.decided_by LEFT JOIN employees de ON de.id = du.employee_id
       WHERE ($1::text IS NULL OR x.status = $1) AND ($2::date IS NULL OR x.expense_date >= $2)
         AND ($3::date IS NULL OR x.expense_date <= $3)
       ORDER BY x.expense_date DESC, x.expense_no DESC LIMIT 200`,
      [f.status ?? null, f.from ?? null, f.to ?? null, requireUser(res).id],
    );
    res.json({ expenses: rows });
  });
  router.post('/finance/expenses', requirePermission(db, 'expense:create'), async (req, res) => {
    const input = expenseSchema.parse(req.body);
    const id = await audited(
      db,
      req,
      res,
      {
        action: 'expense.submitted',
        entityType: 'expense',
        changes: { amountPaise: input.amountPaise },
      },
      async (tx, userId) => {
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO expenses (category_id, expense_date, amount_paise, payee, description, created_by, updated_by)
         SELECT id, $2, $3, $4, $5, $6, $6 FROM expense_categories WHERE id = $1 AND active RETURNING id`,
          [
            input.categoryId,
            input.expenseDate,
            input.amountPaise,
            input.payee,
            input.description,
            userId,
          ],
        );
        if (!rows[0]) throw new AppError(422, 'UNKNOWN_CATEGORY', 'Category not found.');
        return { id: rows[0].id, result: rows[0].id };
      },
    );
    res.status(201).json({ expenseId: id });
  });
  router.post(
    '/finance/expenses/:id/decide',
    requirePermission(db, 'expense:approve'),
    async (req, res) => {
      const id = uuid(req.params.id, 'Expense');
      const { decision, note } = expenseDecisionSchema.parse(req.body);
      await audited(
        db,
        req,
        res,
        { action: `expense.${decision}`, entityType: 'expense' },
        async (tx, userId) => {
          const { rows } = await tx.query<{ status: string; createdBy: string }>(
            'SELECT status, created_by AS "createdBy" FROM expenses WHERE id = $1 FOR UPDATE',
            [id],
          );
          if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Expense not found');
          if (rows[0].createdBy === userId)
            throw new AppError(409, 'SELF_DECISION', "You can't approve your own expense.");
          if (rows[0].status !== 'submitted')
            throw new AppError(
              409,
              'INVALID_TRANSITION',
              `This expense is already ${rows[0].status}.`,
            );
          await tx.query(
            'UPDATE expenses SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4, updated_by = $3 WHERE id = $1',
            [id, decision, userId, note ?? null],
          );
          return { id, result: null };
        },
      );
      res.json({ ok: true });
    },
  );

  // ---- Equipment ----
  const equipmentView = requireAnyPermission(db, ['equipment:manage', 'maintenance:log']);
  router.get('/equipment', equipmentView, async (_req, res) => {
    const { rows } = await db.query(
      `SELECT q.id, q.asset_tag AS "assetTag", q.name, q.category, q.serial_no AS "serialNo", q.location_note AS "locationNote",
              q.status, q.purchase_date::text AS "purchaseDate", q.maintenance_interval_days AS "maintenanceIntervalDays",
              q.next_maintenance_due::text AS "nextMaintenanceDue",
              CASE WHEN d.id IS NULL THEN NULL ELSE json_build_object('id', d.id, 'name', d.name) END AS department,
              (q.next_maintenance_due IS NOT NULL AND q.next_maintenance_due <= (now() AT TIME ZONE 'Asia/Kolkata')::date) AS "maintenanceDue"
       FROM equipment q LEFT JOIN departments d ON d.id = q.department_id
       ORDER BY (q.status = 'retired'), q.next_maintenance_due NULLS LAST, q.name`,
    );
    res.json({ equipment: rows });
  });
  router.post('/equipment', requirePermission(db, 'equipment:manage'), async (req, res) => {
    const input = equipmentSchema.parse(req.body);
    const id = await audited(
      db,
      req,
      res,
      { action: 'equipment.registered', entityType: 'equipment' },
      async (tx, userId) => {
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO equipment (asset_tag, name, category, serial_no, department_id, location_note, purchase_date,
           maintenance_interval_days, next_maintenance_due, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
           CASE WHEN $8::int IS NULL THEN NULL ELSE coalesce($7::date, (now() AT TIME ZONE 'Asia/Kolkata')::date) + $8::int END, $9, $9)
         RETURNING id`,
          [
            input.assetTag,
            input.name,
            input.category ?? null,
            input.serialNo ?? null,
            input.departmentId ?? null,
            input.locationNote ?? null,
            input.purchaseDate ?? null,
            input.maintenanceIntervalDays ?? null,
            userId,
          ],
        );
        return { id: rows[0]!.id, result: rows[0]!.id };
      },
    ).catch((err) => {
      if (pgCode(err) === '23505')
        throw new AppError(
          409,
          'DUPLICATE',
          'This asset tag or serial number is already registered.',
        );
      throw err;
    });
    res.status(201).json({ equipmentId: id });
  });
  router.post(
    '/equipment/:id/status',
    requirePermission(db, 'equipment:manage'),
    async (req, res) => {
      const id = uuid(req.params.id, 'Equipment');
      const { status } = equipmentStatusSchema.parse(req.body);
      await audited(
        db,
        req,
        res,
        { action: 'equipment.status_changed', entityType: 'equipment', changes: { to: status } },
        async (tx, userId) => {
          const { rowCount } = await tx.query(
            `UPDATE equipment SET status = $2, updated_by = $3 WHERE id = $1 AND status <> 'retired'`,
            [id, status, userId],
          );
          if (!rowCount) throw new AppError(409, 'RETIRED', 'Equipment not found, or retired.');
          return { id, result: null };
        },
      );
      res.json({ ok: true });
    },
  );
  router.get('/equipment/:id/maintenance', equipmentView, async (req, res) => {
    const { rows } = await db.query(
      `SELECT m.id, m.kind, m.performed_on::text AS "performedOn", m.notes, m.outcome, m.next_due::text AS "nextDue",
              e.full_name AS "loggedBy", m.logged_at AS "loggedAt"
       FROM maintenance_logs m JOIN users u ON u.id = m.logged_by JOIN employees e ON e.id = u.employee_id
       WHERE m.equipment_id = $1 ORDER BY m.performed_on DESC, m.logged_at DESC`,
      [uuid(req.params.id, 'Equipment')],
    );
    res.json({ logs: rows });
  });
  router.post(
    '/equipment/:id/maintenance',
    requirePermission(db, 'maintenance:log'),
    async (req, res) => {
      const id = uuid(req.params.id, 'Equipment');
      const input = maintenanceLogSchema.parse(req.body);
      await audited(
        db,
        req,
        res,
        {
          action: 'maintenance.logged',
          entityType: 'equipment',
          changes: { kind: input.kind, outcome: input.outcome },
        },
        async (tx, userId) => {
          const { rows } = await tx.query<{ status: string; interval: number | null }>(
            'SELECT status, maintenance_interval_days AS interval FROM equipment WHERE id = $1 FOR UPDATE',
            [id],
          );
          if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Equipment not found');
          if (rows[0].status === 'retired')
            throw new AppError(409, 'RETIRED', 'This equipment is retired.');
          const nextDue = input.nextDue ?? null;
          await tx.query(
            `INSERT INTO maintenance_logs (equipment_id, kind, performed_on, notes, outcome, next_due, logged_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, input.kind, input.performedOn, input.notes, input.outcome, nextDue, userId],
          );
          await tx.query(
            `UPDATE equipment SET status = $2, updated_by = $3,
           next_maintenance_due = coalesce($4::date, CASE WHEN maintenance_interval_days IS NULL THEN next_maintenance_due
                                                         ELSE $5::date + maintenance_interval_days END)
         WHERE id = $1`,
            [id, input.outcome, userId, nextDue, input.performedOn],
          );
          return { id, result: null };
        },
      );
      res.status(201).json({ ok: true });
    },
  );

  // ---- Marketing and enquiries ----
  const enquiries = requirePermission(db, 'enquiry:manage');
  router.get(
    '/referral-sources',
    requireAnyPermission(db, ['enquiry:manage', 'campaign:manage']),
    async (_req, res) => {
      const { rows } = await db.query(
        'SELECT id, name::text AS name, active FROM referral_sources ORDER BY name',
      );
      res.json({ sources: rows });
    },
  );
  router.post(
    '/referral-sources',
    requireAnyPermission(db, ['enquiry:manage', 'campaign:manage']),
    async (req, res) => {
      const { name } = referralSourceSchema.parse(req.body);
      const id = await audited(
        db,
        req,
        res,
        { action: 'referral_source.created', entityType: 'referral_source' },
        async (tx, userId) => {
          const { rows } = await tx.query<{ id: string }>(
            'INSERT INTO referral_sources (name, created_by, updated_by) VALUES ($1, $2, $2) RETURNING id',
            [name, userId],
          );
          return { id: rows[0]!.id, result: rows[0]!.id };
        },
      ).catch((err) => {
        if (pgCode(err) === '23505')
          throw new AppError(409, 'DUPLICATE', 'This source already exists.');
        throw err;
      });
      res.status(201).json({ sourceId: id });
    },
  );
  router.get('/enquiries', enquiries, async (req, res) => {
    const { status } = z
      .object({ status: z.enum(['open', 'follow_up', 'converted', 'closed']).optional() })
      .parse(req.query);
    const { rows } = await db.query(
      `SELECT q.id, q.enquiry_no AS "enquiryNo", q.name, q.phone, q.channel, q.subject, q.notes, q.status, q.created_at AS "createdAt",
              CASE WHEN r.id IS NULL THEN NULL ELSE json_build_object('id', r.id, 'name', r.name) END AS "referralSource",
              CASE WHEN c.id IS NULL THEN NULL ELSE json_build_object('id', c.id, 'name', c.name) END AS campaign,
              CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object('id', p.id, 'mrn', p.mrn) END AS "convertedPatient",
              (SELECT count(*)::int FROM enquiry_follow_ups f WHERE f.enquiry_id = q.id AND NOT f.done) AS "openFollowUps"
       FROM enquiries q LEFT JOIN referral_sources r ON r.id = q.referral_source_id LEFT JOIN campaigns c ON c.id = q.campaign_id
       LEFT JOIN patients p ON p.id = q.converted_patient_id
       WHERE $1::text IS NULL OR q.status = $1 ORDER BY q.created_at DESC LIMIT 200`,
      [status ?? null],
    );
    res.json({ enquiries: rows });
  });
  router.post('/enquiries', enquiries, async (req, res) => {
    const input = enquirySchema.parse(req.body);
    const id = await audited(
      db,
      req,
      res,
      { action: 'enquiry.created', entityType: 'enquiry', changes: { channel: input.channel } },
      async (tx, userId) => {
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO enquiries (name, phone, channel, referral_source_id, campaign_id, subject, notes, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING id`,
          [
            input.name,
            input.phone,
            input.channel,
            input.referralSourceId ?? null,
            input.campaignId ?? null,
            input.subject,
            input.notes ?? null,
            userId,
          ],
        );
        return { id: rows[0]!.id, result: rows[0]!.id };
      },
    );
    res.status(201).json({ enquiryId: id });
  });
  router.post('/enquiries/:id/status', enquiries, async (req, res) => {
    const id = uuid(req.params.id, 'Enquiry');
    const { status, convertedPatientId } = enquiryUpdateSchema.parse(req.body);
    if ((status === 'converted') !== !!convertedPatientId) {
      throw new AppError(
        422,
        'PATIENT_REQUIRED',
        'A converted enquiry links to the registered patient (and only then).',
      );
    }
    await audited(
      db,
      req,
      res,
      { action: 'enquiry.status_changed', entityType: 'enquiry', changes: { to: status } },
      async (tx, userId) => {
        const { rowCount } = await tx.query(
          'UPDATE enquiries SET status = $2, converted_patient_id = $3, updated_by = $4 WHERE id = $1',
          [id, status, convertedPatientId ?? null, userId],
        );
        if (!rowCount) throw new AppError(404, 'NOT_FOUND', 'Enquiry not found');
        return { id, result: null };
      },
    );
    res.json({ ok: true });
  });
  router.get('/enquiries/:id/follow-ups', enquiries, async (req, res) => {
    const { rows } = await db.query(
      `SELECT f.id, f.note, f.due_on::text AS "dueOn", f.done, f.created_at AS "createdAt", e.full_name AS "createdBy"
       FROM enquiry_follow_ups f JOIN users u ON u.id = f.created_by JOIN employees e ON e.id = u.employee_id
       WHERE f.enquiry_id = $1 ORDER BY f.created_at`,
      [uuid(req.params.id, 'Enquiry')],
    );
    res.json({ followUps: rows });
  });
  router.post('/enquiries/:id/follow-ups', enquiries, async (req, res) => {
    const id = uuid(req.params.id, 'Enquiry');
    const input = enquiryFollowUpSchema.parse(req.body);
    await audited(
      db,
      req,
      res,
      { action: 'enquiry.follow_up_added', entityType: 'enquiry' },
      async (tx, userId) => {
        const { rowCount } = await tx.query(
          `INSERT INTO enquiry_follow_ups (enquiry_id, note, due_on, created_by) SELECT id, $2, $3, $4 FROM enquiries WHERE id = $1`,
          [id, input.note, input.dueOn ?? null, userId],
        );
        if (!rowCount) throw new AppError(404, 'NOT_FOUND', 'Enquiry not found');
        await tx.query(
          `UPDATE enquiries SET status = 'follow_up', updated_by = $2 WHERE id = $1 AND status = 'open'`,
          [id, userId],
        );
        return { id, result: null };
      },
    );
    res.status(201).json({ ok: true });
  });
  router.post('/enquiry-follow-ups/:id/done', enquiries, async (req, res) => {
    const id = uuid(req.params.id, 'Follow-up');
    await audited(
      db,
      req,
      res,
      { action: 'enquiry.follow_up_done', entityType: 'enquiry_follow_up' },
      async (tx) => {
        const { rowCount } = await tx.query(
          'UPDATE enquiry_follow_ups SET done = true WHERE id = $1 AND NOT done',
          [id],
        );
        if (!rowCount) throw new AppError(404, 'NOT_FOUND', 'Follow-up not found');
        return { id, result: null };
      },
    );
    res.json({ ok: true });
  });

  router.get(
    '/campaigns',
    requireAnyPermission(db, ['campaign:manage', 'report:marketing', 'enquiry:manage']),
    async (_req, res) => {
      const { rows } = await db.query(
        `SELECT c.id, c.name, c.channel, c.start_date::text AS "startDate", c.end_date::text AS "endDate", c.status,
              c.budget_paise::int AS "budgetPaise", c.notes,
              (SELECT count(*)::int FROM enquiries q WHERE q.campaign_id = c.id) AS enquiries,
              (SELECT count(*)::int FROM enquiries q WHERE q.campaign_id = c.id AND q.status = 'converted') AS converted
       FROM campaigns c ORDER BY c.start_date DESC`,
      );
      res.json({ campaigns: rows });
    },
  );
  router.post('/campaigns', requirePermission(db, 'campaign:manage'), async (req, res) => {
    const input = campaignSchema.parse(req.body);
    const id = await audited(
      db,
      req,
      res,
      { action: 'campaign.created', entityType: 'campaign' },
      async (tx, userId) => {
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO campaigns (name, channel, start_date, end_date, budget_paise, notes, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id`,
          [
            input.name,
            input.channel,
            input.startDate,
            input.endDate ?? null,
            input.budgetPaise,
            input.notes ?? null,
            userId,
          ],
        );
        return { id: rows[0]!.id, result: rows[0]!.id };
      },
    );
    res.status(201).json({ campaignId: id });
  });
  router.post(
    '/campaigns/:id/status',
    requirePermission(db, 'campaign:manage'),
    async (req, res) => {
      const id = uuid(req.params.id, 'Campaign');
      const { status } = campaignStatusSchema.parse(req.body);
      await audited(
        db,
        req,
        res,
        { action: 'campaign.status_changed', entityType: 'campaign', changes: { to: status } },
        async (tx, userId) => {
          const { rowCount } = await tx.query(
            'UPDATE campaigns SET status = $2, updated_by = $3 WHERE id = $1',
            [id, status, userId],
          );
          if (!rowCount) throw new AppError(404, 'NOT_FOUND', 'Campaign not found');
          return { id, result: null };
        },
      );
      res.json({ ok: true });
    },
  );
  router.get('/marketing/summary', requirePermission(db, 'report:marketing'), async (_req, res) => {
    const { rows } = await db.query(
      `SELECT
         (SELECT coalesce(json_object_agg(status, n), '{}') FROM (SELECT status, count(*)::int AS n FROM enquiries GROUP BY status) s) AS "byStatus",
         (SELECT coalesce(json_object_agg(channel, n), '{}') FROM (SELECT channel, count(*)::int AS n FROM enquiries GROUP BY channel) s) AS "byChannel",
         (SELECT coalesce(json_agg(json_build_object('source', r.name, 'enquiries', n)), '[]') FROM (
            SELECT referral_source_id, count(*)::int AS n FROM enquiries WHERE referral_source_id IS NOT NULL GROUP BY referral_source_id) s
          JOIN referral_sources r ON r.id = s.referral_source_id) AS "bySource"`,
    );
    res.json({ summary: rows[0] });
  });

  return router;
}
