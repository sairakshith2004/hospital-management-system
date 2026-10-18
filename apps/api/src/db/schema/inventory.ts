/**
 * Locations, the medicine and supply catalogue, batches, append-only stock movements,
 * suppliers, goods receipts and stock transfers (ERD §3.5, §3.8; reduced for the MVP:
 * no purchase orders, substitutions or dispense returns yet). Grants, the append-only
 * trigger on stock_movements and the trigram index are in the hand-written migration.
 */
import {
  BATCH_STATUSES,
  DOSAGE_FORMS,
  LOCATION_KINDS,
  MOVEMENT_KINDS,
  ROUTES,
  STOCK_ITEM_KINDS,
  STRENGTH_UNITS,
  TRANSFER_STATUSES,
} from '@hospitalos/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, citext, oneOf } from './columns.js';
import { users } from './identity.js';

const userId = () => users.id;

export const locations = pgTable(
  'locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique('locations_code_key'),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    active: boolean('active').notNull().default(true),
    ...auditColumns(userId),
  },
  (t) => [
    // Target of composite keys that require a location of a given kind.
    unique('locations_id_kind_key').on(t.id, t.kind),
    check('locations_kind_check', oneOf(t.kind, LOCATION_KINDS)),
    check('locations_code_format', sql`${t.code} ~ '^[A-Z][A-Z0-9_-]{1,19}$'`),
  ],
);

export const ingredients = pgTable(
  'ingredients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: citext('name').notNull().unique('ingredients_name_key'),
    ...auditColumns(userId),
  },
  (t) => [check('ingredients_name_not_blank', sql`length(trim(${t.name})) > 0`)],
);

export const stockItems = pgTable(
  'stock_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sku: text('sku').notNull().unique('stock_items_sku_key'),
    kind: text('kind').notNull(),
    /** For a medicine: brand, strength and form, e.g. "Calpol 500 mg tablet". */
    name: text('name').notNull(),
    baseUnit: text('base_unit').notNull(),
    category: text('category'),
    reorderLevel: integer('reorder_level').notNull().default(0),
    tracksExpiry: boolean('tracks_expiry').notNull().default(true),
    active: boolean('active').notNull().default(true),
    ...auditColumns(userId),
  },
  (t) => [
    check('stock_items_kind_check', oneOf(t.kind, STOCK_ITEM_KINDS)),
    check('stock_items_reorder_level', sql`${t.reorderLevel} >= 0`),
    check('stock_items_medicine_tracks_expiry', sql`${t.kind} <> 'medicine' OR ${t.tracksExpiry}`),
  ],
);

export const medicineProducts = pgTable(
  'medicine_products',
  {
    stockItemId: uuid('stock_item_id')
      .primaryKey()
      .references(() => stockItems.id, { onDelete: 'restrict' }),
    brandName: text('brand_name').notNull(),
    manufacturer: text('manufacturer'),
    dosageForm: text('dosage_form').notNull(),
    route: text('route').notNull(),
    packSize: text('pack_size'),
    rxOnly: boolean('rx_only').notNull().default(true),
    ...auditColumns(userId),
  },
  (t) => [
    check('medicine_products_dosage_form_check', oneOf(t.dosageForm, DOSAGE_FORMS)),
    check('medicine_products_route_check', oneOf(t.route, ROUTES)),
  ],
);

export const productIngredients = pgTable(
  'product_ingredients',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => medicineProducts.stockItemId, { onDelete: 'restrict' }),
    ingredientId: uuid('ingredient_id')
      .notNull()
      .references(() => ingredients.id, { onDelete: 'restrict' }),
    strengthValue: numeric('strength_value', { precision: 12, scale: 4 }).notNull(),
    strengthUnit: text('strength_unit').notNull(),
  },
  (t) => [
    primaryKey({ name: 'product_ingredients_pkey', columns: [t.productId, t.ingredientId] }),
    index('product_ingredients_ingredient_idx').on(t.ingredientId),
    check('product_ingredients_strength_positive', sql`${t.strengthValue} > 0`),
    check('product_ingredients_unit_check', oneOf(t.strengthUnit, STRENGTH_UNITS)),
  ],
);

export const stockBatches = pgTable(
  'stock_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stockItemId: uuid('stock_item_id')
      .notNull()
      .references(() => stockItems.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    batchNo: text('batch_no').notNull(),
    /** The last day the batch may be used; null only for items that don't expire. */
    expiryDate: date('expiry_date', { mode: 'string' }),
    unitCostPaise: bigint('unit_cost_paise', { mode: 'number' }).notNull().default(0),
    salePricePaise: bigint('sale_price_paise', { mode: 'number' }).notNull().default(0),
    qtyOnHand: integer('qty_on_hand').notNull().default(0),
    status: text('status').notNull().default('active'),
    ...auditColumns(userId),
  },
  (t) => [
    unique('stock_batches_item_location_batch_key').on(t.stockItemId, t.locationId, t.batchNo),
    unique('stock_batches_id_item_key').on(t.id, t.stockItemId),
    unique('stock_batches_id_location_key').on(t.id, t.locationId),
    index('stock_batches_item_location_expiry_idx').on(t.stockItemId, t.locationId, t.expiryDate),
    check('stock_batches_qty_non_negative', sql`${t.qtyOnHand} >= 0`),
    check(
      'stock_batches_prices_non_negative',
      sql`${t.unitCostPaise} >= 0 AND ${t.salePricePaise} >= 0`,
    ),
    check('stock_batches_status_check', oneOf(t.status, BATCH_STATUSES)),
    check('stock_batches_batch_no_not_blank', sql`length(trim(${t.batchNo})) > 0`),
  ],
);

/** Append-only (trigger in the hand-written migration): every change to qty_on_hand. */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    batchId: uuid('batch_id').notNull(),
    locationId: uuid('location_id').notNull(),
    kind: text('kind').notNull(),
    /** Signed: positive into the batch, negative out of it. */
    qty: integer('qty').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    reason: text('reason'),
    refType: text('ref_type'),
    refId: text('ref_id'),
    performedBy: uuid('performed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('stock_movements_id_batch_key').on(t.id, t.batchId),
    foreignKey({
      name: 'stock_movements_batch_location_fk',
      columns: [t.batchId, t.locationId],
      foreignColumns: [stockBatches.id, stockBatches.locationId],
    }).onDelete('restrict'),
    index('stock_movements_batch_idx').on(t.batchId, t.occurredAt),
    index('stock_movements_location_idx').on(t.locationId, t.occurredAt),
    index('stock_movements_ref_idx').on(t.refType, t.refId),
    check('stock_movements_kind_check', oneOf(t.kind, MOVEMENT_KINDS)),
    check('stock_movements_qty_non_zero', sql`${t.qty} <> 0`),
    check('stock_movements_balance_non_negative', sql`${t.balanceAfter} >= 0`),
    check(
      'stock_movements_sign_matches_kind',
      sql`(${t.kind} IN ('receipt', 'adjustment_in', 'transfer_in', 'transfer_return')) = (${t.qty} > 0)`,
    ),
    check(
      'stock_movements_adjustment_reason',
      sql`${t.kind} NOT IN ('adjustment_in', 'adjustment_out', 'damage', 'expiry_writeoff') OR length(trim(coalesce(${t.reason}, ''))) > 0`,
    ),
  ],
);

export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique('suppliers_code_key'),
    name: text('name').notNull(),
    gstin: text('gstin'),
    phone: text('phone'),
    email: citext('email'),
    active: boolean('active').notNull().default(true),
    ...auditColumns(userId),
  },
  (t) => [check('suppliers_name_not_blank', sql`length(trim(${t.name})) > 0`)],
);

export const grnNoSeq = pgSequence('grn_no_seq', {
  startWith: 1,
  increment: 1,
  minValue: 1,
  maxValue: 9_999_999,
  cycle: false,
});

/** Supplier deliveries; received only into a store location (C1). Never edited. */
export const goodsReceipts = pgTable(
  'goods_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    grnNo: text('grn_no')
      .notNull()
      .unique('goods_receipts_grn_no_key')
      .default(sql`('GRN' || lpad(nextval('grn_no_seq')::text, 7, '0'))`),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id').notNull(),
    locationKind: text('location_kind').notNull().default('store'),
    supplierInvoiceRef: text('supplier_invoice_ref'),
    receivedBy: uuid('received_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'goods_receipts_store_location_fk',
      columns: [t.locationId, t.locationKind],
      foreignColumns: [locations.id, locations.kind],
    }).onDelete('restrict'),
    check('goods_receipts_store_only', sql`${t.locationKind} = 'store'`),
    index('goods_receipts_supplier_idx').on(t.supplierId, t.receivedAt),
  ],
);

export const grnLines = pgTable(
  'grn_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    grnId: uuid('grn_id')
      .notNull()
      .references(() => goodsReceipts.id, { onDelete: 'restrict' }),
    stockItemId: uuid('stock_item_id').notNull(),
    batchNo: text('batch_no').notNull(),
    expiryDate: date('expiry_date', { mode: 'string' }),
    qty: integer('qty').notNull(),
    unitCostPaise: bigint('unit_cost_paise', { mode: 'number' }).notNull(),
    batchId: uuid('batch_id').notNull(),
    stockMovementId: bigint('stock_movement_id', { mode: 'number' })
      .notNull()
      .unique('grn_lines_stock_movement_id_key')
      .references(() => stockMovements.id, { onDelete: 'restrict' }),
  },
  (t) => [
    foreignKey({
      name: 'grn_lines_batch_item_fk',
      columns: [t.batchId, t.stockItemId],
      foreignColumns: [stockBatches.id, stockBatches.stockItemId],
    }).onDelete('restrict'),
    index('grn_lines_grn_idx').on(t.grnId),
    check('grn_lines_qty_positive', sql`${t.qty} > 0`),
    check('grn_lines_cost_non_negative', sql`${t.unitCostPaise} >= 0`),
  ],
);

export const transferNoSeq = pgSequence('transfer_no_seq', {
  startWith: 1,
  increment: 1,
  minValue: 1,
  maxValue: 9_999_999,
  cycle: false,
});

/**
 * Stock moving between locations. Simplified lifecycle: created already dispatched (the
 * stock leaves the source), then received by a different user (it lands at the
 * destination) or rejected by a different user (it goes back to the source batch).
 */
export const stockTransfers = pgTable(
  'stock_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transferNo: text('transfer_no')
      .notNull()
      .unique('stock_transfers_transfer_no_key')
      .default(sql`('TRF' || lpad(nextval('transfer_no_seq')::text, 7, '0'))`),
    fromLocationId: uuid('from_location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    toLocationId: uuid('to_location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('dispatched'),
    dispatchedBy: uuid('dispatched_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }).notNull().defaultNow(),
    receivedBy: uuid('received_by').references(() => users.id, { onDelete: 'restrict' }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    rejectedBy: uuid('rejected_by').references(() => users.id, { onDelete: 'restrict' }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('stock_transfers_id_locations_key').on(t.id, t.fromLocationId, t.toLocationId),
    index('stock_transfers_status_idx').on(t.status, t.dispatchedAt),
    check('stock_transfers_status_check', oneOf(t.status, TRANSFER_STATUSES)),
    check('stock_transfers_distinct_locations', sql`${t.fromLocationId} <> ${t.toLocationId}`),
    check('stock_transfers_reason_not_blank', sql`length(trim(${t.reason})) > 0`),
    check(
      'stock_transfers_receiver_not_dispatcher',
      sql`${t.receivedBy} IS NULL OR ${t.receivedBy} <> ${t.dispatchedBy}`,
    ),
    check(
      'stock_transfers_rejecter_not_dispatcher',
      sql`${t.rejectedBy} IS NULL OR ${t.rejectedBy} <> ${t.dispatchedBy}`,
    ),
    check(
      'stock_transfers_fields_match_status',
      sql`CASE ${t.status}
        WHEN 'dispatched' THEN ${t.receivedBy} IS NULL AND ${t.rejectedBy} IS NULL
        WHEN 'received' THEN ${t.receivedBy} IS NOT NULL AND ${t.receivedAt} IS NOT NULL AND ${t.rejectedBy} IS NULL
        WHEN 'rejected' THEN ${t.rejectedBy} IS NOT NULL AND ${t.rejectedAt} IS NOT NULL AND ${t.receivedBy} IS NULL
          AND length(trim(coalesce(${t.rejectionReason}, ''))) > 0
      END`,
    ),
  ],
);

export const stockTransferLines = pgTable(
  'stock_transfer_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transferId: uuid('transfer_id').notNull(),
    fromLocationId: uuid('from_location_id').notNull(),
    toLocationId: uuid('to_location_id').notNull(),
    stockItemId: uuid('stock_item_id').notNull(),
    fromBatchId: uuid('from_batch_id').notNull(),
    /** The destination batch, set when the transfer is received. */
    toBatchId: uuid('to_batch_id'),
    qty: integer('qty').notNull(),
    outMovementId: bigint('out_movement_id', { mode: 'number' })
      .notNull()
      .unique('stock_transfer_lines_out_movement_key'),
    inMovementId: bigint('in_movement_id', { mode: 'number' }).unique(
      'stock_transfer_lines_in_movement_key',
    ),
    returnMovementId: bigint('return_movement_id', { mode: 'number' }).unique(
      'stock_transfer_lines_return_movement_key',
    ),
  },
  (t) => [
    foreignKey({
      name: 'stock_transfer_lines_transfer_fk',
      columns: [t.transferId, t.fromLocationId, t.toLocationId],
      foreignColumns: [
        stockTransfers.id,
        stockTransfers.fromLocationId,
        stockTransfers.toLocationId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'stock_transfer_lines_from_batch_location_fk',
      columns: [t.fromBatchId, t.fromLocationId],
      foreignColumns: [stockBatches.id, stockBatches.locationId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'stock_transfer_lines_from_batch_item_fk',
      columns: [t.fromBatchId, t.stockItemId],
      foreignColumns: [stockBatches.id, stockBatches.stockItemId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'stock_transfer_lines_to_batch_location_fk',
      columns: [t.toBatchId, t.toLocationId],
      foreignColumns: [stockBatches.id, stockBatches.locationId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'stock_transfer_lines_to_batch_item_fk',
      columns: [t.toBatchId, t.stockItemId],
      foreignColumns: [stockBatches.id, stockBatches.stockItemId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'stock_transfer_lines_out_movement_fk',
      columns: [t.outMovementId, t.fromBatchId],
      foreignColumns: [stockMovements.id, stockMovements.batchId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'stock_transfer_lines_in_movement_fk',
      columns: [t.inMovementId, t.toBatchId],
      foreignColumns: [stockMovements.id, stockMovements.batchId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'stock_transfer_lines_return_movement_fk',
      columns: [t.returnMovementId, t.fromBatchId],
      foreignColumns: [stockMovements.id, stockMovements.batchId],
    }).onDelete('restrict'),
    index('stock_transfer_lines_transfer_idx').on(t.transferId),
    check('stock_transfer_lines_qty_positive', sql`${t.qty} > 0`),
    check(
      'stock_transfer_lines_in_or_return',
      sql`num_nonnulls(${t.inMovementId}, ${t.returnMovementId}) <= 1`,
    ),
    check(
      'stock_transfer_lines_in_has_batch',
      sql`(${t.inMovementId} IS NULL) = (${t.toBatchId} IS NULL)`,
    ),
  ],
);
