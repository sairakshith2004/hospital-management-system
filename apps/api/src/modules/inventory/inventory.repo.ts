/** Inventory SQL: catalogue, batches, append-only movements, suppliers, receipts, transfers. */
import type {
  BatchStock,
  Ingredient,
  Location,
  LocationKind,
  MovementKind,
  StockItemView,
  StockMovementView,
  Supplier,
} from '@hospitalos/shared';
import type { Queryable } from '../../db/client.js';

const TODAY = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;

export async function listLocations(db: Queryable): Promise<Location[]> {
  const { rows } = await db.query<Location>(
    'SELECT id, code, name, kind FROM locations WHERE active ORDER BY kind, name',
  );
  return rows;
}

export async function findLocation(db: Queryable, id: string): Promise<Location | undefined> {
  const { rows } = await db.query<Location>(
    'SELECT id, code, name, kind FROM locations WHERE id = $1 AND active',
    [id],
  );
  return rows[0];
}

export async function searchIngredients(db: Queryable, q: string): Promise<Ingredient[]> {
  const { rows } = await db.query<Ingredient>(
    `SELECT id, name::text AS name FROM ingredients
     WHERE $1 = '' OR name ILIKE '%' || $1 || '%' OR name::text % $1
     ORDER BY similarity(name::text, $1) DESC, name LIMIT 50`,
    [q],
  );
  return rows;
}

/**
 * Stock items with their batches. `q` matches SKU, item or brand name, or any ingredient
 * name (partial or fuzzy), so a doctor can look up "paracetamol" and see every brand,
 * strength and form, and where it is in stock.
 */
export async function searchStock(
  db: Queryable,
  f: {
    q: string;
    locationId?: string | undefined;
    kind?: string | undefined;
    lowOnly?: boolean;
    id?: string;
  },
  limit = 50,
): Promise<StockItemView[]> {
  const { rows } = await db.query<StockItemView>(
    `WITH items AS (
       SELECT s.* FROM stock_items s
       LEFT JOIN medicine_products m ON m.stock_item_id = s.id
       WHERE s.active
         AND ($4::uuid IS NULL OR s.id = $4)
         AND ($3::text IS NULL OR s.kind = $3)
         AND ($1 = '' OR s.sku ILIKE $1 || '%' OR s.name ILIKE '%' || $1 || '%' OR s.name % $1
              OR m.brand_name ILIKE '%' || $1 || '%'
              OR EXISTS (SELECT 1 FROM product_ingredients pi JOIN ingredients i ON i.id = pi.ingredient_id
                         WHERE pi.product_id = s.id AND (i.name ILIKE '%' || $1 || '%' OR i.name::text % $1)))
     ),
     batches AS (
       SELECT b.stock_item_id,
              json_agg(json_build_object(
                'id', b.id, 'batchNo', b.batch_no, 'expiryDate', b.expiry_date,
                'qtyOnHand', b.qty_on_hand, 'status', b.status, 'salePricePaise', b.sale_price_paise,
                'location', json_build_object('id', l.id, 'code', l.code, 'name', l.name, 'kind', l.kind))
                ORDER BY l.kind, b.expiry_date NULLS LAST, b.batch_no) AS batches,
              coalesce(sum(b.qty_on_hand) FILTER (
                WHERE b.status = 'active' AND (b.expiry_date IS NULL OR b.expiry_date >= ${TODAY})), 0)::int AS available
       FROM stock_batches b JOIN locations l ON l.id = b.location_id
       WHERE b.stock_item_id IN (SELECT id FROM items)
         AND ($2::uuid IS NULL OR b.location_id = $2)
         AND (b.qty_on_hand > 0 OR b.status <> 'active')
       GROUP BY b.stock_item_id
     )
     SELECT s.id, s.sku, s.kind, s.name, s.base_unit AS "baseUnit", s.category,
            s.reorder_level AS "reorderLevel", s.tracks_expiry AS "tracksExpiry",
            CASE WHEN m.stock_item_id IS NULL THEN NULL ELSE json_build_object(
              'brandName', m.brand_name, 'manufacturer', m.manufacturer, 'dosageForm', m.dosage_form,
              'route', m.route, 'packSize', m.pack_size, 'rxOnly', m.rx_only,
              'ingredients', (SELECT coalesce(json_agg(json_build_object('id', i.id, 'name', i.name,
                  'strengthValue', pi.strength_value::text, 'strengthUnit', pi.strength_unit) ORDER BY i.name), '[]')
                FROM product_ingredients pi JOIN ingredients i ON i.id = pi.ingredient_id
                WHERE pi.product_id = s.id)) END AS medicine,
            coalesce(b.available, 0) AS "totalAvailable",
            coalesce(b.batches, '[]') AS batches
     FROM items s
     LEFT JOIN medicine_products m ON m.stock_item_id = s.id
     LEFT JOIN batches b ON b.stock_item_id = s.id
     WHERE NOT $5 OR coalesce(b.available, 0) <= s.reorder_level
     ORDER BY ($1 <> '' AND s.sku ILIKE $1 || '%') DESC, s.name
     LIMIT $6`,
    [f.q, f.locationId ?? null, f.kind ?? null, f.id ?? null, f.lowOnly ?? false, limit],
  );
  return rows;
}

export interface LockedBatch {
  id: string;
  stockItemId: string;
  locationId: string;
  locationKind: LocationKind;
  batchNo: string;
  expiryDate: string | null;
  qtyOnHand: number;
  status: string;
  salePricePaise: number;
  unitCostPaise: number;
  expired: boolean;
}

/** Locks one batch (callers lock several in ascending id order). */
export async function lockBatch(db: Queryable, id: string): Promise<LockedBatch | undefined> {
  const { rows } = await db.query<LockedBatch>(
    `SELECT b.id, b.stock_item_id AS "stockItemId", b.location_id AS "locationId", l.kind AS "locationKind",
            b.batch_no AS "batchNo", b.expiry_date::text AS "expiryDate", b.qty_on_hand AS "qtyOnHand",
            b.status, b.sale_price_paise::int AS "salePricePaise", b.unit_cost_paise::int AS "unitCostPaise",
            (b.expiry_date IS NOT NULL AND b.expiry_date < ${TODAY}) AS expired
     FROM stock_batches b JOIN locations l ON l.id = b.location_id
     WHERE b.id = $1 FOR UPDATE OF b`,
    [id],
  );
  return rows[0];
}

/**
 * Changes a locked batch's quantity by `delta` and records the movement. Returns the
 * movement id. The CHECK (qty_on_hand >= 0) and the commit-time movement check back it up.
 */
export async function moveStock(
  db: Queryable,
  m: {
    batchId: string;
    locationId: string;
    kind: MovementKind;
    delta: number;
    reason?: string | null;
    refType?: string | null;
    refId?: string | null;
    userId: string;
  },
): Promise<{ movementId: number; balanceAfter: number }> {
  const { rows } = await db.query<{ qty: number }>(
    `UPDATE stock_batches SET qty_on_hand = qty_on_hand + $2, updated_by = $3
     WHERE id = $1 RETURNING qty_on_hand AS qty`,
    [m.batchId, m.delta, m.userId],
  );
  const balanceAfter = rows[0]!.qty;
  const { rows: mv } = await db.query<{ id: number }>(
    `INSERT INTO stock_movements (batch_id, location_id, kind, qty, balance_after, reason, ref_type, ref_id, performed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id::int`,
    [
      m.batchId,
      m.locationId,
      m.kind,
      m.delta,
      balanceAfter,
      m.reason ?? null,
      m.refType ?? null,
      m.refId ?? null,
      m.userId,
    ],
  );
  return { movementId: mv[0]!.id, balanceAfter };
}

/** The batch with this number at this location, created (empty) if it doesn't exist yet. */
export async function getOrCreateBatch(
  db: Queryable,
  b: {
    stockItemId: string;
    locationId: string;
    batchNo: string;
    expiryDate: string | null;
    unitCostPaise: number;
    salePricePaise: number;
    userId: string;
  },
): Promise<{ id: string; expiryDate: string | null }> {
  await db.query(
    `INSERT INTO stock_batches (stock_item_id, location_id, batch_no, expiry_date, unit_cost_paise, sale_price_paise, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     ON CONFLICT (stock_item_id, location_id, batch_no) DO NOTHING`,
    [
      b.stockItemId,
      b.locationId,
      b.batchNo,
      b.expiryDate,
      b.unitCostPaise,
      b.salePricePaise,
      b.userId,
    ],
  );
  const { rows } = await db.query<{ id: string; expiryDate: string | null }>(
    `SELECT id, expiry_date::text AS "expiryDate" FROM stock_batches
     WHERE stock_item_id = $1 AND location_id = $2 AND batch_no = $3 FOR UPDATE`,
    [b.stockItemId, b.locationId, b.batchNo],
  );
  return rows[0]!;
}

export async function listMovements(
  db: Queryable,
  f: {
    locationId?: string | undefined;
    stockItemId?: string | undefined;
    batchId?: string | undefined;
  },
  limit = 200,
): Promise<StockMovementView[]> {
  const { rows } = await db.query<StockMovementView>(
    `SELECT m.id::text AS id, m.kind, m.qty, m.balance_after AS "balanceAfter", m.reason,
            m.ref_type AS "refType", m.ref_id AS "refId", m.occurred_at AS "occurredAt",
            e.full_name AS "performedBy",
            json_build_object('id', b.id, 'batchNo', b.batch_no) AS batch,
            json_build_object('id', s.id, 'sku', s.sku, 'name', s.name) AS item,
            json_build_object('id', l.id, 'code', l.code, 'name', l.name) AS location
     FROM stock_movements m
     JOIN stock_batches b ON b.id = m.batch_id
     JOIN stock_items s ON s.id = b.stock_item_id
     JOIN locations l ON l.id = m.location_id
     JOIN users u ON u.id = m.performed_by
     JOIN employees e ON e.id = u.employee_id
     WHERE ($1::uuid IS NULL OR m.location_id = $1)
       AND ($2::uuid IS NULL OR b.stock_item_id = $2)
       AND ($3::uuid IS NULL OR m.batch_id = $3)
     ORDER BY m.id DESC LIMIT $4`,
    [f.locationId ?? null, f.stockItemId ?? null, f.batchId ?? null, limit],
  );
  return rows;
}

export async function listSuppliers(db: Queryable): Promise<Supplier[]> {
  const { rows } = await db.query<Supplier>(
    `SELECT id, code, name, gstin, phone, email::text AS email, active FROM suppliers ORDER BY active DESC, name`,
  );
  return rows;
}

export async function listBatchesForLocation(
  db: Queryable,
  locationId: string,
): Promise<BatchStock[]> {
  const { rows } = await db.query<BatchStock>(
    `SELECT b.id, b.batch_no AS "batchNo", b.expiry_date::text AS "expiryDate", b.qty_on_hand AS "qtyOnHand",
            b.status, b.sale_price_paise::int AS "salePricePaise",
            json_build_object('id', l.id, 'code', l.code, 'name', l.name, 'kind', l.kind) AS location
     FROM stock_batches b JOIN locations l ON l.id = b.location_id
     WHERE b.location_id = $1 AND b.qty_on_hand > 0 ORDER BY b.expiry_date NULLS LAST`,
    [locationId],
  );
  return rows;
}
