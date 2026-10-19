/**
 *   GET   /api/locations                         signed in
 *   POST  /api/locations                         department:manage
 *   GET   /api/ingredients?q=                    medicine:search | medicine:catalog_manage
 *   POST  /api/ingredients                       medicine:catalog_manage
 *   GET   /api/stock?q=&locationId=&kind=&low=   medicine:search | catalogue/stock roles (read-only view)
 *   GET   /api/stock/:id                         same
 *   POST  /api/stock/medicines | /items          medicine:catalog_manage
 *   PATCH /api/stock/:id                         medicine:catalog_manage (reorder level, active)
 *   GET   /api/stock/movements                   stock roles (not doctors)
 *   POST  /api/stock/adjustments                 stock:adjust_pharmacy | stock:adjust_store, by the batch's location (C1)
 *   POST  /api/stock/batches/:id/status          same
 *   GET   /api/suppliers, POST /api/suppliers    goods_receipt:create | supplier:manage; POST supplier:manage
 *   GET   /api/goods-receipts[/:id], POST        goods_receipt:create (store locations only)
 *   GET   /api/transfers[/:id], POST             dispatch permission of the source location kind
 *   POST  /api/transfers/:id/receive | /reject   receive permission of the destination kind, another user
 */
import {
  LOCATION_KINDS,
  batchStatusSchema,
  createGeneralItemSchema,
  createIngredientSchema,
  createMedicineSchema,
  createSupplierSchema,
  createTransferSchema,
  goodsReceiptSchema,
  rejectTransferSchema,
  stockAdjustmentSchema,
  stockSearchSchema,
  type PermissionCode,
} from '@hospitalos/shared';
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { Database } from '../../db/client.js';
import { auditContext } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import {
  requireAnyPermission,
  requireAuth,
  requirePermission,
  requireUser,
} from '../../middleware/auth.js';
import {
  listLocations,
  listMovements,
  listSuppliers,
  searchIngredients,
  searchStock,
} from './inventory.repo.js';
import {
  adjustStock,
  createGeneralItem,
  createGoodsReceipt,
  createIngredient,
  createLocation,
  createMedicine,
  createSupplier,
  createTransfer,
  receiveTransfer,
  rejectTransfer,
  setBatchStatus,
  updateItem,
  type Actor,
} from './inventory.service.js';

const STOCK_ROLES: PermissionCode[] = [
  'medicine:catalog_manage',
  'stock:adjust_pharmacy',
  'stock:adjust_store',
  'goods_receipt:create',
  'stock_transfer:dispatch_pharmacy',
  'stock_transfer:dispatch_store',
  'stock_transfer:receive_pharmacy',
  'stock_transfer:receive_store',
];
const STOCK_VIEW: PermissionCode[] = ['medicine:search', ...STOCK_ROLES];
const TRANSFER_ROLES: PermissionCode[] = [
  'stock_transfer:dispatch_pharmacy',
  'stock_transfer:dispatch_store',
  'stock_transfer:receive_pharmacy',
  'stock_transfer:receive_store',
];

const uuid = (value: unknown, what = 'Record') => {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new AppError(404, 'NOT_FOUND', `${what} not found`);
  return parsed.data;
};
const actorOf = (res: Response): Actor => {
  const user = requireUser(res);
  return { userId: user.id, can: (p) => user.can(p) };
};

export function inventoryRoutes(db: Database): Router {
  const router = Router();

  router.get('/locations', requireAuth, async (_req, res) => {
    res.json({ locations: await listLocations(db) });
  });
  router.post('/locations', requirePermission(db, 'department:manage'), async (req, res) => {
    const input = z
      .strictObject({
        code: z
          .string()
          .trim()
          .regex(/^[A-Z][A-Z0-9_-]{1,19}$/, 'Code: 2–20 capital letters, digits, _ or -'),
        name: z.string().trim().min(1).max(80),
        kind: z.enum(LOCATION_KINDS),
      })
      .parse(req.body);
    res
      .status(201)
      .json({ location: await createLocation(db, input, actorOf(res), auditContext(req, res)) });
  });

  router.get(
    '/ingredients',
    requireAnyPermission(db, ['medicine:search', 'medicine:catalog_manage']),
    async (req, res) => {
      const { q } = z.object({ q: z.string().trim().max(60).default('') }).parse(req.query);
      res.json({ ingredients: await searchIngredients(db, q) });
    },
  );
  router.post(
    '/ingredients',
    requirePermission(db, 'medicine:catalog_manage'),
    async (req, res) => {
      const { name } = createIngredientSchema.parse(req.body);
      res.status(201).json({
        ingredient: await createIngredient(db, name, actorOf(res), auditContext(req, res)),
      });
    },
  );

  router.get('/stock/movements', requireAnyPermission(db, STOCK_ROLES), async (req, res) => {
    const f = z
      .strictObject({
        locationId: z.uuid().optional(),
        stockItemId: z.uuid().optional(),
        batchId: z.uuid().optional(),
      })
      .parse(req.query);
    res.json({ movements: await listMovements(db, f) });
  });
  router.get('/stock', requireAnyPermission(db, STOCK_VIEW), async (req, res) => {
    const { low, ...rest } = z
      .object({ low: z.enum(['true', 'false']).optional() })
      .loose()
      .parse(req.query);
    const f = stockSearchSchema.parse(rest);
    res.json({ items: await searchStock(db, { ...f, lowOnly: low === 'true' }) });
  });
  router.get('/stock/:id', requireAnyPermission(db, STOCK_VIEW), async (req, res) => {
    const id = uuid(req.params.id, 'Item');
    const [item] = await searchStock(db, { q: '', id }, 1);
    if (!item) throw new AppError(404, 'NOT_FOUND', 'Item not found');
    res.json({ item });
  });
  router.post(
    '/stock/medicines',
    requirePermission(db, 'medicine:catalog_manage'),
    async (req, res) => {
      const input = createMedicineSchema.parse(req.body);
      const id = await createMedicine(db, input, actorOf(res), auditContext(req, res));
      res.status(201).json({ item: (await searchStock(db, { q: '', id }, 1))[0] });
    },
  );
  router.post(
    '/stock/items',
    requirePermission(db, 'medicine:catalog_manage'),
    async (req, res) => {
      const input = createGeneralItemSchema.parse(req.body);
      const id = await createGeneralItem(db, input, actorOf(res), auditContext(req, res));
      res.status(201).json({ item: (await searchStock(db, { q: '', id }, 1))[0] });
    },
  );
  router.patch('/stock/:id', requirePermission(db, 'medicine:catalog_manage'), async (req, res) => {
    const id = uuid(req.params.id, 'Item');
    const input = z
      .strictObject({
        reorderLevel: z.int().min(0).max(1_000_000).optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body);
    await updateItem(db, id, input, actorOf(res), auditContext(req, res));
    res.json({ item: (await searchStock(db, { q: '', id }, 1))[0] ?? null });
  });
  router.post(
    '/stock/adjustments',
    requireAnyPermission(db, ['stock:adjust_pharmacy', 'stock:adjust_store']),
    async (req, res) => {
      const input = stockAdjustmentSchema.parse(req.body);
      res.status(201).json(await adjustStock(db, input, actorOf(res), auditContext(req, res)));
    },
  );
  router.post(
    '/stock/batches/:id/status',
    requireAnyPermission(db, ['stock:adjust_pharmacy', 'stock:adjust_store']),
    async (req, res) => {
      const id = uuid(req.params.id, 'Batch');
      const input = batchStatusSchema.parse(req.body);
      await setBatchStatus(db, id, input, actorOf(res), auditContext(req, res));
      res.json({ ok: true });
    },
  );

  router.get(
    '/suppliers',
    requireAnyPermission(db, ['supplier:manage', 'goods_receipt:create']),
    async (_req, res) => {
      res.json({ suppliers: await listSuppliers(db) });
    },
  );
  router.post('/suppliers', requirePermission(db, 'supplier:manage'), async (req, res) => {
    const input = createSupplierSchema.parse(req.body);
    const id = await createSupplier(db, input, actorOf(res), auditContext(req, res));
    res.status(201).json({ supplier: (await listSuppliers(db)).find((s) => s.id === id) });
  });

  router.get(
    '/goods-receipts',
    requireAnyPermission(db, ['goods_receipt:create', 'supplier:manage']),
    async (_req, res) => {
      const { rows } = await db.query(
        `SELECT g.id, g.grn_no AS "grnNo", g.received_at AS "receivedAt", g.supplier_invoice_ref AS "supplierInvoiceRef",
              json_build_object('id', s.id, 'name', s.name) AS supplier,
              json_build_object('id', l.id, 'name', l.name) AS location,
              e.full_name AS "receivedBy",
              (SELECT count(*)::int FROM grn_lines x WHERE x.grn_id = g.id) AS lines,
              (SELECT coalesce(sum(x.qty * x.unit_cost_paise), 0)::bigint FROM grn_lines x WHERE x.grn_id = g.id)::int AS "valuePaise"
       FROM goods_receipts g JOIN suppliers s ON s.id = g.supplier_id JOIN locations l ON l.id = g.location_id
       JOIN users u ON u.id = g.received_by JOIN employees e ON e.id = u.employee_id
       ORDER BY g.received_at DESC LIMIT 100`,
      );
      res.json({ receipts: rows });
    },
  );
  router.get(
    '/goods-receipts/:id',
    requireAnyPermission(db, ['goods_receipt:create', 'supplier:manage']),
    async (req, res) => {
      const id = uuid(req.params.id, 'Receipt');
      const { rows } = await db.query(
        `SELECT g.id, g.grn_no AS "grnNo", g.received_at AS "receivedAt", g.supplier_invoice_ref AS "supplierInvoiceRef",
              json_build_object('id', s.id, 'name', s.name) AS supplier,
              json_build_object('id', l.id, 'name', l.name) AS location,
              (SELECT json_agg(json_build_object('id', x.id, 'item', i.name, 'sku', i.sku, 'batchNo', x.batch_no,
                 'expiryDate', x.expiry_date, 'qty', x.qty, 'unitCostPaise', x.unit_cost_paise) ORDER BY i.name)
               FROM grn_lines x JOIN stock_items i ON i.id = x.stock_item_id WHERE x.grn_id = g.id) AS lines
       FROM goods_receipts g JOIN suppliers s ON s.id = g.supplier_id JOIN locations l ON l.id = g.location_id
       WHERE g.id = $1`,
        [id],
      );
      if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Receipt not found');
      res.json({ receipt: rows[0] });
    },
  );
  router.post(
    '/goods-receipts',
    requirePermission(db, 'goods_receipt:create'),
    async (req, res) => {
      const input = goodsReceiptSchema.parse(req.body);
      res.status(201).json({
        receipt: await createGoodsReceipt(db, input, actorOf(res), auditContext(req, res)),
      });
    },
  );

  router.get('/transfers', requireAnyPermission(db, TRANSFER_ROLES), async (_req, res) => {
    const { rows } = await db.query(
      `SELECT t.id, t.transfer_no AS "transferNo", t.status, t.reason, t.dispatched_at AS "dispatchedAt",
              t.received_at AS "receivedAt", t.rejected_at AS "rejectedAt", t.rejection_reason AS "rejectionReason",
              t.dispatched_by AS "dispatchedById",
              json_build_object('id', f.id, 'name', f.name, 'kind', f.kind) AS "from",
              json_build_object('id', d.id, 'name', d.name, 'kind', d.kind) AS "to",
              (SELECT json_agg(json_build_object('item', i.name, 'batchNo', b.batch_no, 'qty', x.qty) ORDER BY i.name)
               FROM stock_transfer_lines x JOIN stock_batches b ON b.id = x.from_batch_id
               JOIN stock_items i ON i.id = x.stock_item_id WHERE x.transfer_id = t.id) AS lines
       FROM stock_transfers t JOIN locations f ON f.id = t.from_location_id JOIN locations d ON d.id = t.to_location_id
       ORDER BY t.dispatched_at DESC LIMIT 100`,
    );
    res.json({ transfers: rows });
  });
  router.post(
    '/transfers',
    requireAnyPermission(db, ['stock_transfer:dispatch_pharmacy', 'stock_transfer:dispatch_store']),
    async (req, res) => {
      const input = createTransferSchema.parse(req.body);
      res
        .status(201)
        .json({ transfer: await createTransfer(db, input, actorOf(res), auditContext(req, res)) });
    },
  );
  router.post(
    '/transfers/:id/receive',
    requireAnyPermission(db, ['stock_transfer:receive_pharmacy', 'stock_transfer:receive_store']),
    async (req, res) => {
      await receiveTransfer(
        db,
        uuid(req.params.id, 'Transfer'),
        actorOf(res),
        auditContext(req, res),
      );
      res.json({ ok: true });
    },
  );
  router.post(
    '/transfers/:id/reject',
    requireAnyPermission(db, ['stock_transfer:receive_pharmacy', 'stock_transfer:receive_store']),
    async (req, res) => {
      const { reason } = rejectTransferSchema.parse(req.body);
      await rejectTransfer(
        db,
        uuid(req.params.id, 'Transfer'),
        reason,
        actorOf(res),
        auditContext(req, res),
      );
      res.json({ ok: true });
    },
  );

  return router;
}
