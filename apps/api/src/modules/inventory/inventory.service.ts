/**
 * Inventory writes. Every stock change locks its batches (ascending id), records a
 * movement with the resulting balance and writes an audit row, all in one transaction.
 * Location-specific permissions (C1) are checked against the batch's location kind after
 * the lock; the caller supplies `can` from the session, never from the request body.
 */
import {
  hospitalToday,
  type CreateMedicineInput,
  type GoodsReceiptInput,
  type LocationKind,
  type PermissionCode,
} from '@hospitalos/shared';
import { withTransaction, type Database, type Queryable } from '../../db/client.js';
import { recordAudit, type AuditContext } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import {
  findLocation,
  getOrCreateBatch,
  lockBatch,
  moveStock,
  type LockedBatch,
} from './inventory.repo.js';

export interface Actor {
  userId: string;
  can(permission: PermissionCode): boolean;
}

const forbidden = () => new AppError(403, 'FORBIDDEN', 'You do not have permission to do this');

const ADJUST: Partial<Record<LocationKind, PermissionCode>> = {
  pharmacy: 'stock:adjust_pharmacy',
  store: 'stock:adjust_store',
};
const DISPATCH: Partial<Record<LocationKind, PermissionCode>> = {
  pharmacy: 'stock_transfer:dispatch_pharmacy',
  store: 'stock_transfer:dispatch_store',
};
const RECEIVE: Partial<Record<LocationKind, PermissionCode>> = {
  pharmacy: 'stock_transfer:receive_pharmacy',
  store: 'stock_transfer:receive_store',
};

/** The permission a location kind needs for an operation; 403 if none or not held. */
function requireFor(
  map: Partial<Record<LocationKind, PermissionCode>>,
  kind: LocationKind,
  actor: Actor,
) {
  const permission = map[kind];
  if (!permission || !actor.can(permission)) throw forbidden();
  return permission;
}

const audit = (
  tx: Queryable,
  actor: Actor,
  context: AuditContext,
  entry: {
    action: string;
    entityType: string;
    entityId: string;
    changes?: Record<string, string | number | boolean | null | string[]>;
    reason?: string | null;
  },
) => recordAudit(tx, { actor: { type: 'user', userId: actor.userId }, ...entry }, context);

function pgCode(err: unknown) {
  return (err ?? {}) as { code?: string; constraint?: string };
}

export async function createLocation(
  db: Database,
  input: { code: string; name: string; kind: LocationKind },
  actor: Actor,
  context: AuditContext,
) {
  try {
    return await withTransaction(db, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO locations (code, name, kind, created_by, updated_by) VALUES ($1, $2, $3, $4, $4) RETURNING id`,
        [input.code, input.name, input.kind, actor.userId],
      );
      await audit(tx, actor, context, {
        action: 'location.created',
        entityType: 'location',
        entityId: rows[0]!.id,
        changes: { kind: input.kind },
      });
      return (await findLocation(tx, rows[0]!.id))!;
    });
  } catch (err) {
    if (pgCode(err).code === '23505')
      throw new AppError(409, 'DUPLICATE', 'A location with this code already exists.');
    throw err;
  }
}

export async function createIngredient(
  db: Database,
  name: string,
  actor: Actor,
  context: AuditContext,
) {
  try {
    return await withTransaction(db, async (tx) => {
      const { rows } = await tx.query<{ id: string; name: string }>(
        `INSERT INTO ingredients (name, created_by, updated_by) VALUES ($1, $2, $2) RETURNING id, name::text AS name`,
        [name, actor.userId],
      );
      await audit(tx, actor, context, {
        action: 'ingredient.created',
        entityType: 'ingredient',
        entityId: rows[0]!.id,
      });
      return rows[0]!;
    });
  } catch (err) {
    if (pgCode(err).code === '23505')
      throw new AppError(409, 'DUPLICATE', 'This ingredient already exists.');
    throw err;
  }
}

/** "Calpol 500 mg tablet" / "Augmentin 500 mg + 125 mg tablet". */
function medicineName(input: CreateMedicineInput) {
  const strengths = input.ingredients
    .map((i) => `${Number(i.strengthValue)} ${i.strengthUnit}`)
    .join(' + ');
  return `${input.brandName} ${strengths} ${input.dosageForm}`;
}

export async function createMedicine(
  db: Database,
  input: CreateMedicineInput,
  actor: Actor,
  context: AuditContext,
) {
  const ids = input.ingredients.map((i) => i.ingredientId);
  if (new Set(ids).size !== ids.length) {
    throw new AppError(422, 'DUPLICATE_INGREDIENT', 'Each ingredient can appear only once.');
  }
  try {
    return await withTransaction(db, async (tx) => {
      const found = await tx.query('SELECT id FROM ingredients WHERE id = ANY($1::uuid[])', [ids]);
      if (found.rowCount !== ids.length)
        throw new AppError(422, 'UNKNOWN_INGREDIENT', 'An ingredient was not found.');
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO stock_items (sku, kind, name, base_unit, category, reorder_level, tracks_expiry, created_by, updated_by)
         VALUES ($1, 'medicine', $2, $3, 'Medicine', $4, true, $5, $5) RETURNING id`,
        [input.sku, medicineName(input), input.baseUnit, input.reorderLevel, actor.userId],
      );
      const id = rows[0]!.id;
      await tx.query(
        `INSERT INTO medicine_products (stock_item_id, brand_name, manufacturer, dosage_form, route, pack_size, rx_only, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [
          id,
          input.brandName,
          input.manufacturer ?? null,
          input.dosageForm,
          input.route,
          input.packSize ?? null,
          input.rxOnly,
          actor.userId,
        ],
      );
      for (const i of input.ingredients) {
        await tx.query(
          'INSERT INTO product_ingredients (product_id, ingredient_id, strength_value, strength_unit) VALUES ($1, $2, $3, $4)',
          [id, i.ingredientId, i.strengthValue, i.strengthUnit],
        );
      }
      await audit(tx, actor, context, {
        action: 'stock_item.created',
        entityType: 'stock_item',
        entityId: id,
        changes: { kind: 'medicine', sku: input.sku },
      });
      return id;
    });
  } catch (err) {
    if (pgCode(err).code === '23505')
      throw new AppError(409, 'DUPLICATE', 'An item with this SKU already exists.');
    throw err;
  }
}

export async function createGeneralItem(
  db: Database,
  input: {
    sku: string;
    name: string;
    category?: string | null | undefined;
    baseUnit: string;
    tracksExpiry: boolean;
    reorderLevel: number;
  },
  actor: Actor,
  context: AuditContext,
) {
  try {
    return await withTransaction(db, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO stock_items (sku, kind, name, base_unit, category, reorder_level, tracks_expiry, created_by, updated_by)
         VALUES ($1, 'general', $2, $3, $4, $5, $6, $7, $7) RETURNING id`,
        [
          input.sku,
          input.name,
          input.baseUnit,
          input.category ?? null,
          input.reorderLevel,
          input.tracksExpiry,
          actor.userId,
        ],
      );
      await audit(tx, actor, context, {
        action: 'stock_item.created',
        entityType: 'stock_item',
        entityId: rows[0]!.id,
        changes: { kind: 'general', sku: input.sku },
      });
      return rows[0]!.id;
    });
  } catch (err) {
    if (pgCode(err).code === '23505')
      throw new AppError(409, 'DUPLICATE', 'An item with this SKU already exists.');
    throw err;
  }
}

export async function updateItem(
  db: Database,
  id: string,
  input: { reorderLevel?: number | undefined; active?: boolean | undefined },
  actor: Actor,
  context: AuditContext,
) {
  return withTransaction(db, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE stock_items SET reorder_level = coalesce($2, reorder_level), active = coalesce($3, active), updated_by = $4 WHERE id = $1`,
      [id, input.reorderLevel ?? null, input.active ?? null, actor.userId],
    );
    if (!rowCount) throw new AppError(404, 'NOT_FOUND', 'Item not found');
    await audit(tx, actor, context, {
      action: 'stock_item.updated',
      entityType: 'stock_item',
      entityId: id,
      changes: {
        fields: Object.keys(input).filter((k) => input[k as keyof typeof input] !== undefined),
      },
    });
  });
}

async function requireBatch(tx: Queryable, id: string): Promise<LockedBatch> {
  const batch = await lockBatch(tx, id);
  if (!batch) throw new AppError(404, 'NOT_FOUND', 'Batch not found');
  return batch;
}

const IN_KINDS = new Set(['adjustment_in']);

/** Manual adjustment, damage or expiry write-off, with a reason (C1). */
export async function adjustStock(
  db: Database,
  input: {
    batchId: string;
    kind: 'adjustment_in' | 'adjustment_out' | 'damage' | 'expiry_writeoff';
    qty: number;
    reason: string;
  },
  actor: Actor,
  context: AuditContext,
) {
  return withTransaction(db, async (tx) => {
    const batch = await requireBatch(tx, input.batchId);
    requireFor(ADJUST, batch.locationKind, actor);
    const delta = IN_KINDS.has(input.kind) ? input.qty : -input.qty;
    if (delta < 0 && batch.qtyOnHand < input.qty) {
      throw new AppError(409, 'INSUFFICIENT_STOCK', `Only ${batch.qtyOnHand} in this batch.`);
    }
    if (input.kind === 'expiry_writeoff' && !batch.expired) {
      throw new AppError(
        422,
        'NOT_EXPIRED',
        'Only an expired batch can be written off as expired.',
      );
    }
    const { movementId, balanceAfter } = await moveStock(tx, {
      batchId: batch.id,
      locationId: batch.locationId,
      kind: input.kind,
      delta,
      reason: input.reason,
      refType: 'adjustment',
      userId: actor.userId,
    });
    await audit(tx, actor, context, {
      action: 'stock.adjusted',
      entityType: 'stock_batch',
      entityId: batch.id,
      changes: { kind: input.kind, qty: delta, balanceAfter, movementId },
      reason: 'manual',
    });
    return { batchId: batch.id, balanceAfter };
  });
}

/** Quarantine, recall or release a batch. Recalled and quarantined stock is never dispensed. */
export async function setBatchStatus(
  db: Database,
  batchId: string,
  input: { status: 'active' | 'quarantined' | 'recalled'; reason: string },
  actor: Actor,
  context: AuditContext,
) {
  return withTransaction(db, async (tx) => {
    const batch = await requireBatch(tx, batchId);
    requireFor(ADJUST, batch.locationKind, actor);
    if (batch.status === 'recalled' && input.status !== 'recalled') {
      throw new AppError(409, 'RECALLED', 'A recalled batch cannot be released.');
    }
    await tx.query('UPDATE stock_batches SET status = $2, updated_by = $3 WHERE id = $1', [
      batchId,
      input.status,
      actor.userId,
    ]);
    await audit(tx, actor, context, {
      action: 'stock.batch_status',
      entityType: 'stock_batch',
      entityId: batchId,
      changes: { from: batch.status, to: input.status },
    });
  });
}

export async function createSupplier(
  db: Database,
  input: {
    code: string;
    name: string;
    gstin?: string | null | undefined;
    phone?: string | null | undefined;
    email?: string | null | undefined;
  },
  actor: Actor,
  context: AuditContext,
) {
  try {
    return await withTransaction(db, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO suppliers (code, name, gstin, phone, email, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
        [
          input.code,
          input.name,
          input.gstin ?? null,
          input.phone ?? null,
          input.email ?? null,
          actor.userId,
        ],
      );
      await audit(tx, actor, context, {
        action: 'supplier.created',
        entityType: 'supplier',
        entityId: rows[0]!.id,
      });
      return rows[0]!.id;
    });
  } catch (err) {
    if (pgCode(err).code === '23505')
      throw new AppError(409, 'DUPLICATE', 'A supplier with this code already exists.');
    throw err;
  }
}

/** Supplier goods into the general store (C1): batches, receipt movements, GRN, audit. */
export async function createGoodsReceipt(
  db: Database,
  input: GoodsReceiptInput,
  actor: Actor,
  context: AuditContext,
) {
  const today = hospitalToday();
  return withTransaction(db, async (tx) => {
    const location = await findLocation(tx, input.locationId);
    if (!location) throw new AppError(422, 'UNKNOWN_LOCATION', 'Location not found.');
    if (location.kind !== 'store') {
      throw new AppError(
        422,
        'NOT_A_STORE',
        'Supplier goods are received only into a store. Transfer them to the pharmacy afterwards.',
      );
    }
    const supplier = await tx.query('SELECT 1 FROM suppliers WHERE id = $1 AND active', [
      input.supplierId,
    ]);
    if (!supplier.rowCount) throw new AppError(422, 'UNKNOWN_SUPPLIER', 'Supplier not found.');
    const { rows: grn } = await tx.query<{ id: string; grnNo: string }>(
      `INSERT INTO goods_receipts (supplier_id, location_id, supplier_invoice_ref, received_by)
       VALUES ($1, $2, $3, $4) RETURNING id, grn_no AS "grnNo"`,
      [input.supplierId, location.id, input.supplierInvoiceRef ?? null, actor.userId],
    );
    const lines = [...input.lines].sort((a, b) =>
      `${a.stockItemId}|${a.batchNo}`.localeCompare(`${b.stockItemId}|${b.batchNo}`),
    );
    for (const [n, line] of lines.entries()) {
      const { rows: items } = await tx.query<{ tracksExpiry: boolean }>(
        'SELECT tracks_expiry AS "tracksExpiry" FROM stock_items WHERE id = $1 AND active',
        [line.stockItemId],
      );
      const item = items[0];
      if (!item) throw new AppError(422, 'UNKNOWN_ITEM', `Line ${n + 1}: item not found.`);
      const expiry = line.expiryDate ?? null;
      if (item.tracksExpiry && !expiry)
        throw new AppError(
          422,
          'EXPIRY_REQUIRED',
          `Line ${n + 1}: this item needs an expiry date.`,
        );
      if (expiry && expiry < today)
        throw new AppError(422, 'EXPIRED_STOCK', `Line ${n + 1}: the batch has already expired.`);
      const batch = await getOrCreateBatch(tx, {
        stockItemId: line.stockItemId,
        locationId: location.id,
        batchNo: line.batchNo,
        expiryDate: expiry,
        unitCostPaise: line.unitCostPaise,
        salePricePaise: line.salePricePaise,
        userId: actor.userId,
      });
      if ((batch.expiryDate ?? null) !== expiry) {
        throw new AppError(
          422,
          'BATCH_EXPIRY_MISMATCH',
          `Line ${n + 1}: batch ${line.batchNo} is already recorded with a different expiry date.`,
        );
      }
      const { movementId } = await moveStock(tx, {
        batchId: batch.id,
        locationId: location.id,
        kind: 'receipt',
        delta: line.qty,
        refType: 'goods_receipt',
        refId: grn[0]!.id,
        userId: actor.userId,
      });
      await tx.query(
        `INSERT INTO grn_lines (grn_id, stock_item_id, batch_no, expiry_date, qty, unit_cost_paise, batch_id, stock_movement_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          grn[0]!.id,
          line.stockItemId,
          line.batchNo,
          expiry,
          line.qty,
          line.unitCostPaise,
          batch.id,
          movementId,
        ],
      );
    }
    await audit(tx, actor, context, {
      action: 'goods_receipt.created',
      entityType: 'goods_receipt',
      entityId: grn[0]!.id,
      changes: { lines: lines.length, supplierId: input.supplierId },
    });
    return grn[0]!;
  });
}

/** Creates a transfer already dispatched: stock leaves the source batches now. */
export async function createTransfer(
  db: Database,
  input: {
    fromLocationId: string;
    toLocationId: string;
    reason: string;
    lines: { batchId: string; qty: number }[];
  },
  actor: Actor,
  context: AuditContext,
) {
  if (input.fromLocationId === input.toLocationId) {
    throw new AppError(422, 'SAME_LOCATION', 'Choose two different locations.');
  }
  const batchIds = input.lines.map((l) => l.batchId);
  if (new Set(batchIds).size !== batchIds.length) {
    throw new AppError(422, 'DUPLICATE_BATCH', 'Each batch can appear only once.');
  }
  return withTransaction(db, async (tx) => {
    const from = await findLocation(tx, input.fromLocationId);
    const to = await findLocation(tx, input.toLocationId);
    if (!from || !to) throw new AppError(422, 'UNKNOWN_LOCATION', 'Location not found.');
    requireFor(DISPATCH, from.kind, actor);
    if (!RECEIVE[to.kind])
      throw new AppError(
        422,
        'BAD_DESTINATION',
        'Stock can only be transferred to a pharmacy or a store.',
      );
    const { rows: tr } = await tx.query<{ id: string; transferNo: string }>(
      `INSERT INTO stock_transfers (from_location_id, to_location_id, reason, dispatched_by)
       VALUES ($1, $2, $3, $4) RETURNING id, transfer_no AS "transferNo"`,
      [from.id, to.id, input.reason, actor.userId],
    );
    const lines = [...input.lines].sort((a, b) => a.batchId.localeCompare(b.batchId));
    for (const line of lines) {
      const batch = await requireBatch(tx, line.batchId);
      if (batch.locationId !== from.id)
        throw new AppError(422, 'WRONG_LOCATION', `Batch ${batch.batchNo} is not at ${from.name}.`);
      if (batch.status !== 'active' || batch.expired) {
        throw new AppError(
          422,
          'BATCH_UNUSABLE',
          `Batch ${batch.batchNo} is ${batch.expired ? 'expired' : batch.status} and can't be transferred.`,
        );
      }
      if (batch.qtyOnHand < line.qty) {
        throw new AppError(
          409,
          'INSUFFICIENT_STOCK',
          `Batch ${batch.batchNo} has only ${batch.qtyOnHand}.`,
        );
      }
      const { movementId } = await moveStock(tx, {
        batchId: batch.id,
        locationId: from.id,
        kind: 'transfer_out',
        delta: -line.qty,
        refType: 'stock_transfer',
        refId: tr[0]!.id,
        userId: actor.userId,
      });
      await tx.query(
        `INSERT INTO stock_transfer_lines (transfer_id, from_location_id, to_location_id, stock_item_id, from_batch_id, qty, out_movement_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tr[0]!.id, from.id, to.id, batch.stockItemId, batch.id, line.qty, movementId],
      );
    }
    await audit(tx, actor, context, {
      action: 'stock_transfer.dispatched',
      entityType: 'stock_transfer',
      entityId: tr[0]!.id,
      changes: { lines: lines.length, from: from.code, to: to.code },
    });
    return tr[0]!;
  });
}

async function lockTransfer(tx: Queryable, id: string) {
  const { rows } = await tx.query<{
    id: string;
    status: string;
    dispatchedBy: string;
    fromLocationId: string;
    toLocationId: string;
    toKind: LocationKind;
  }>(
    `SELECT t.id, t.status, t.dispatched_by AS "dispatchedBy", t.from_location_id AS "fromLocationId",
            t.to_location_id AS "toLocationId", l.kind AS "toKind"
     FROM stock_transfers t JOIN locations l ON l.id = t.to_location_id
     WHERE t.id = $1 FOR UPDATE OF t`,
    [id],
  );
  const t = rows[0];
  if (!t) throw new AppError(404, 'NOT_FOUND', 'Transfer not found');
  return t;
}

async function transferLines(tx: Queryable, id: string) {
  const { rows } = await tx.query<{ id: string; fromBatchId: string; qty: number }>(
    `SELECT id, from_batch_id AS "fromBatchId", qty FROM stock_transfer_lines WHERE transfer_id = $1 ORDER BY from_batch_id`,
    [id],
  );
  return rows;
}

/** A different user at the destination accepts: the stock lands in a batch with the same number and expiry. */
export async function receiveTransfer(
  db: Database,
  id: string,
  actor: Actor,
  context: AuditContext,
) {
  return withTransaction(db, async (tx) => {
    const t = await lockTransfer(tx, id);
    requireFor(RECEIVE, t.toKind, actor);
    if (t.status !== 'dispatched')
      throw new AppError(409, 'INVALID_TRANSITION', `This transfer is already ${t.status}.`);
    if (t.dispatchedBy === actor.userId) {
      throw new AppError(
        409,
        'SAME_USER',
        'The person who sent a transfer cannot also receive it.',
      );
    }
    for (const line of await transferLines(tx, id)) {
      const source = await requireBatch(tx, line.fromBatchId);
      const dest = await getOrCreateBatch(tx, {
        stockItemId: source.stockItemId,
        locationId: t.toLocationId,
        batchNo: source.batchNo,
        expiryDate: source.expiryDate,
        unitCostPaise: source.unitCostPaise,
        salePricePaise: source.salePricePaise,
        userId: actor.userId,
      });
      if ((dest.expiryDate ?? null) !== (source.expiryDate ?? null)) {
        throw new AppError(
          422,
          'BATCH_EXPIRY_MISMATCH',
          `Batch ${source.batchNo} already exists at the destination with a different expiry.`,
        );
      }
      const { movementId } = await moveStock(tx, {
        batchId: dest.id,
        locationId: t.toLocationId,
        kind: 'transfer_in',
        delta: line.qty,
        refType: 'stock_transfer',
        refId: id,
        userId: actor.userId,
      });
      await tx.query(
        'UPDATE stock_transfer_lines SET to_batch_id = $2, in_movement_id = $3 WHERE id = $1',
        [line.id, dest.id, movementId],
      );
    }
    await tx.query(
      `UPDATE stock_transfers SET status = 'received', received_by = $2, received_at = now() WHERE id = $1`,
      [id, actor.userId],
    );
    await audit(tx, actor, context, {
      action: 'stock_transfer.received',
      entityType: 'stock_transfer',
      entityId: id,
    });
  });
}

/** A different user at the destination refuses: the stock goes back into its source batches. */
export async function rejectTransfer(
  db: Database,
  id: string,
  reason: string,
  actor: Actor,
  context: AuditContext,
) {
  return withTransaction(db, async (tx) => {
    const t = await lockTransfer(tx, id);
    requireFor(RECEIVE, t.toKind, actor);
    if (t.status !== 'dispatched')
      throw new AppError(409, 'INVALID_TRANSITION', `This transfer is already ${t.status}.`);
    if (t.dispatchedBy === actor.userId) {
      throw new AppError(409, 'SAME_USER', 'The person who sent a transfer cannot also reject it.');
    }
    for (const line of await transferLines(tx, id)) {
      const source = await requireBatch(tx, line.fromBatchId);
      const { movementId } = await moveStock(tx, {
        batchId: source.id,
        locationId: t.fromLocationId,
        kind: 'transfer_return',
        delta: line.qty,
        reason,
        refType: 'stock_transfer',
        refId: id,
        userId: actor.userId,
      });
      await tx.query('UPDATE stock_transfer_lines SET return_movement_id = $2 WHERE id = $1', [
        line.id,
        movementId,
      ]);
    }
    await tx.query(
      `UPDATE stock_transfers SET status = 'rejected', rejected_by = $2, rejected_at = now(), rejection_reason = $3 WHERE id = $1`,
      [id, actor.userId, reason],
    );
    await audit(tx, actor, context, {
      action: 'stock_transfer.rejected',
      entityType: 'stock_transfer',
      entityId: id,
      reason: 'rejected',
    });
  });
}
