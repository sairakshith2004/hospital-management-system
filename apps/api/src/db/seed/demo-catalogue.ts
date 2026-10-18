/**
 * Synthetic operating data for hms_dev so every module has something to work with:
 * stock locations, a small medicine catalogue (several brands, strengths and forms of the
 * same ingredients), general supplies, suppliers, lab tests with reference ranges, priced
 * services, expense categories, referral sources and opening stock.
 *
 * Opening stock goes through the real paths: a goods receipt into the store by the demo
 * inventory user (inv1), then a transfer to the pharmacy received by the demo pharmacist
 * (pha1), so every unit has a movement. Every name, code and number is invented; these are
 * not clinical recommendations or real products.
 *
 * Safe to re-run: rows are added only when missing (by code/name), nothing is updated or
 * deleted, and opening stock is created only once (marked by supplier invoice
 * DEMO-OPENING). One audit row with counts when something was added.
 */
import { SYSTEM, recordAudit } from '../../lib/audit.js';
import type { Queryable } from '../client.js';

const LOCK = 4_200_406;

export const DEMO_LOCATIONS = [
  { code: 'MAIN-PHARM', name: 'Main Pharmacy', kind: 'pharmacy' },
  { code: 'GEN-STORE', name: 'General Store', kind: 'store' },
  { code: 'MAIN-LAB', name: 'Main Laboratory', kind: 'lab' },
] as const;

export const DEMO_INGREDIENTS = [
  'paracetamol',
  'amoxicillin',
  'clavulanic acid',
  'cetirizine',
  'omeprazole',
  'metformin',
  'ibuprofen',
];

/** [sku, brand, form, route, unit, [ingredient, strength, unit][], sale price paise] */
export const DEMO_MEDICINES: [
  string,
  string,
  string,
  string,
  string,
  [string, number, string][],
  number,
][] = [
  ['DEMO-PCM-500', 'Demopara', 'tablet', 'oral', 'tablet', [['paracetamol', 500, 'mg']], 200],
  ['DEMO-PCM-650', 'Demopara Forte', 'tablet', 'oral', 'tablet', [['paracetamol', 650, 'mg']], 300],
  ['DEMO-PCM-SYR', 'Demopara Kids', 'syrup', 'oral', 'ml', [['paracetamol', 120, 'mg/5ml']], 50],
  ['DEMO-AMX-500', 'Demomox', 'capsule', 'oral', 'capsule', [['amoxicillin', 500, 'mg']], 900],
  [
    'DEMO-AMC-625',
    'Democlav',
    'tablet',
    'oral',
    'tablet',
    [
      ['amoxicillin', 500, 'mg'],
      ['clavulanic acid', 125, 'mg'],
    ],
    1800,
  ],
  ['DEMO-CTZ-10', 'Democet', 'tablet', 'oral', 'tablet', [['cetirizine', 10, 'mg']], 150],
  ['DEMO-OMZ-20', 'Demozole', 'capsule', 'oral', 'capsule', [['omeprazole', 20, 'mg']], 400],
  ['DEMO-MET-500', 'Demoformin', 'tablet', 'oral', 'tablet', [['metformin', 500, 'mg']], 250],
  ['DEMO-IBU-400', 'Demoprofen', 'tablet', 'oral', 'tablet', [['ibuprofen', 400, 'mg']], 300],
];

export const DEMO_SUPPLIES: [string, string, string, string][] = [
  ['DEMO-GLV-M', 'Examination gloves (M)', 'Consumables', 'pair'],
  ['DEMO-SYR-5', 'Syringe 5 ml', 'Consumables', 'piece'],
  ['DEMO-GAUZE', 'Sterile gauze pad', 'Dressings', 'piece'],
];

/** [code, name, sample, turnaround h, price paise, [parameter, unit, low, high][]] */
export const DEMO_LAB_TESTS: [
  string,
  string,
  string,
  number,
  number,
  [string, string, number | null, number | null][],
][] = [
  [
    'CBC',
    'Complete blood count',
    'Blood (EDTA)',
    6,
    35000,
    [
      ['Haemoglobin', 'g/dL', 12, 17],
      ['WBC count', '10^3/µL', 4, 11],
      ['Platelet count', '10^3/µL', 150, 450],
    ],
  ],
  [
    'FBS',
    'Fasting blood sugar',
    'Blood (fluoride)',
    2,
    12000,
    [['Glucose, fasting', 'mg/dL', 70, 100]],
  ],
  [
    'LFT',
    'Liver function tests',
    'Blood (serum)',
    12,
    60000,
    [
      ['ALT', 'U/L', 7, 56],
      ['AST', 'U/L', 10, 40],
      ['Total bilirubin', 'mg/dL', 0.1, 1.2],
    ],
  ],
];

export const DEMO_SERVICES: [string, string, string, number][] = [
  ['PROC-DRESS', 'Wound dressing', 'procedure', 15000],
  ['PROC-INJ', 'Injection administration', 'procedure', 5000],
  ['OTH-CERT', 'Medical certificate', 'other', 10000],
];

export const DEMO_EXPENSE_CATEGORIES: [string, string][] = [
  ['UTIL', 'Utilities'],
  ['MAINT', 'Repairs and maintenance'],
  ['OFFICE', 'Office supplies'],
];

export const DEMO_REFERRAL_SOURCES = ['Walk-in', 'Doctor referral', 'Newspaper', 'Website'];

export interface DemoCatalogueResult {
  locations: number;
  ingredients: number;
  items: number;
  labTests: number;
  services: number;
  suppliers: number;
  expenseCategories: number;
  referralSources: number;
  openingStock: boolean;
}

async function userByName(db: Queryable, username: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM users WHERE username = $1 AND status = 'active'",
    [username],
  );
  return rows[0]?.id ?? null;
}

const addDays = (n: number) => `(now() AT TIME ZONE 'Asia/Kolkata')::date + ${n}`;

export async function seedDemoCatalogue(db: Queryable): Promise<DemoCatalogueResult> {
  await db.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
  const n = async (sql: string, params: unknown[] = []) =>
    (await db.query(sql, params)).rowCount ?? 0;
  const r: DemoCatalogueResult = {
    locations: 0,
    ingredients: 0,
    items: 0,
    labTests: 0,
    services: 0,
    suppliers: 0,
    expenseCategories: 0,
    referralSources: 0,
    openingStock: false,
  };

  for (const l of DEMO_LOCATIONS) {
    r.locations += await n(
      'INSERT INTO locations (code, name, kind) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING',
      [l.code, l.name, l.kind],
    );
  }
  for (const i of DEMO_INGREDIENTS) {
    r.ingredients += await n(
      'INSERT INTO ingredients (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
      [i],
    );
  }
  for (const [sku, brand, form, route, unit, parts] of DEMO_MEDICINES) {
    const strengths = parts.map(([, v, u]) => `${v} ${u}`).join(' + ');
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO stock_items (sku, kind, name, base_unit, category, reorder_level, tracks_expiry)
       VALUES ($1, 'medicine', $2, $3, 'Medicine', 20, true) ON CONFLICT (sku) DO NOTHING RETURNING id`,
      [sku, `${brand} ${strengths} ${form}`, unit],
    );
    if (!rows[0]) continue;
    r.items += 1;
    await db.query(
      'INSERT INTO medicine_products (stock_item_id, brand_name, manufacturer, dosage_form, route, rx_only) VALUES ($1, $2, $3, $4, $5, true)',
      [rows[0].id, brand, 'Demo Pharma (synthetic)', form, route],
    );
    for (const [ing, value, u] of parts) {
      await db.query(
        `INSERT INTO product_ingredients (product_id, ingredient_id, strength_value, strength_unit)
         SELECT $1, id, $3, $4 FROM ingredients WHERE name = $2`,
        [rows[0].id, ing, value, u],
      );
    }
  }
  for (const [sku, name, category, unit] of DEMO_SUPPLIES) {
    r.items += await n(
      `INSERT INTO stock_items (sku, kind, name, base_unit, category, reorder_level, tracks_expiry)
       VALUES ($1, 'general', $2, $3, $4, 50, false) ON CONFLICT (sku) DO NOTHING`,
      [sku, name, unit, category],
    );
  }
  r.suppliers += await n(
    `INSERT INTO suppliers (code, name, phone) VALUES ('DEMO-SUP-1', 'Demo Medical Distributors (synthetic)', '9000099001')
     ON CONFLICT (code) DO NOTHING`,
  );
  for (const [code, name, kind, price] of DEMO_SERVICES) {
    r.services += await n(
      'INSERT INTO service_catalogue (code, name, kind, price_paise) VALUES ($1, $2, $3, $4) ON CONFLICT (code) DO NOTHING',
      [code, name, kind, price],
    );
  }
  for (const [code, name, sample, tat, price, params] of DEMO_LAB_TESTS) {
    const exists = await db.query('SELECT 1 FROM lab_tests WHERE code = $1', [code]);
    if (exists.rowCount) continue;
    const { rows: svc } = await db.query<{ id: string }>(
      `INSERT INTO service_catalogue (code, name, kind, price_paise) VALUES ($1, $2, 'lab', $3) RETURNING id`,
      [`LAB-${code}`, name, price],
    );
    const { rows: t } = await db.query<{ id: string }>(
      'INSERT INTO lab_tests (code, name, sample_type, service_id, turnaround_hours) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [code, name, sample, svc[0]!.id, tat],
    );
    for (const [i, [p, unit, lo, hi]] of params.entries()) {
      await db.query(
        'INSERT INTO lab_test_parameters (test_id, name, unit, ref_low, ref_high, sort_order) VALUES ($1, $2, $3, $4, $5, $6)',
        [t[0]!.id, p, unit, lo, hi, i],
      );
    }
    r.labTests += 1;
  }
  for (const [code, name] of DEMO_EXPENSE_CATEGORIES) {
    r.expenseCategories += await n(
      'INSERT INTO expense_categories (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING',
      [code, name],
    );
  }
  for (const name of DEMO_REFERRAL_SOURCES) {
    r.referralSources += await n(
      'INSERT INTO referral_sources (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
      [name],
    );
  }

  // Opening stock, once, through a receipt (inv1) and a transfer received by pha1.
  const opened = await db.query(
    "SELECT 1 FROM goods_receipts WHERE supplier_invoice_ref = 'DEMO-OPENING'",
  );
  const inv = await userByName(db, 'inv1');
  const pha = await userByName(db, 'pha1');
  if (!opened.rowCount && inv && pha) {
    const { rows: loc } = await db.query<{ code: string; id: string }>(
      `SELECT code, id FROM locations WHERE code IN ('GEN-STORE', 'MAIN-PHARM')`,
    );
    const store = loc.find((l) => l.code === 'GEN-STORE')!.id;
    const pharmacy = loc.find((l) => l.code === 'MAIN-PHARM')!.id;
    const { rows: grn } = await db.query<{ id: string }>(
      `INSERT INTO goods_receipts (supplier_id, location_id, supplier_invoice_ref, received_by)
       SELECT id, $1, 'DEMO-OPENING', $2 FROM suppliers WHERE code = 'DEMO-SUP-1' RETURNING id`,
      [store, inv],
    );
    const { rows: tr } = await db.query<{ id: string }>(
      `INSERT INTO stock_transfers (from_location_id, to_location_id, reason, dispatched_by)
       VALUES ($1, $2, 'Demo opening stock', $3) RETURNING id`,
      [store, pharmacy, inv],
    );
    const { rows: items } = await db.query<{ id: string; sku: string; kind: string }>(
      `SELECT id, sku, kind FROM stock_items WHERE sku LIKE 'DEMO-%' ORDER BY sku`,
    );
    for (const [k, item] of items.entries()) {
      const med = DEMO_MEDICINES.find((m) => m[0] === item.sku);
      const price = med ? med[6] : 0;
      const expiry = item.kind === 'medicine' ? addDays(k === 0 ? 25 : 300 + k * 10) : 'NULL';
      const qty = item.kind === 'medicine' ? 200 : 500;
      const { rows: b } = await db.query<{ id: string }>(
        `INSERT INTO stock_batches (stock_item_id, location_id, batch_no, expiry_date, unit_cost_paise, sale_price_paise, qty_on_hand, created_by, updated_by)
         VALUES ($1, $2, $3, ${expiry}, $4, $5, $6, $7, $7) RETURNING id`,
        [
          item.id,
          store,
          `DB${String(k + 1).padStart(3, '0')}`,
          Math.round(price * 0.6),
          price,
          qty,
          inv,
        ],
      );
      const { rows: mv } = await db.query<{ id: number }>(
        `INSERT INTO stock_movements (batch_id, location_id, kind, qty, balance_after, ref_type, ref_id, performed_by)
         VALUES ($1, $2, 'receipt', $3, $3, 'goods_receipt', $4, $5) RETURNING id::int`,
        [b[0]!.id, store, qty, grn[0]!.id, inv],
      );
      await db.query(
        `INSERT INTO grn_lines (grn_id, stock_item_id, batch_no, expiry_date, qty, unit_cost_paise, batch_id, stock_movement_id)
         SELECT $1, stock_item_id, batch_no, expiry_date, $2, unit_cost_paise, id, $3 FROM stock_batches WHERE id = $4`,
        [grn[0]!.id, qty, mv[0]!.id, b[0]!.id],
      );
      if (item.kind !== 'medicine') continue;
      // Half of each medicine moves to the pharmacy.
      const half = qty / 2;
      await db.query('UPDATE stock_batches SET qty_on_hand = qty_on_hand - $2 WHERE id = $1', [
        b[0]!.id,
        half,
      ]);
      const { rows: out } = await db.query<{ id: number }>(
        `INSERT INTO stock_movements (batch_id, location_id, kind, qty, balance_after, ref_type, ref_id, performed_by)
         VALUES ($1, $2, 'transfer_out', $3, $4, 'stock_transfer', $5, $6) RETURNING id::int`,
        [b[0]!.id, store, -half, qty - half, tr[0]!.id, inv],
      );
      const { rows: pb } = await db.query<{ id: string }>(
        `INSERT INTO stock_batches (stock_item_id, location_id, batch_no, expiry_date, unit_cost_paise, sale_price_paise, qty_on_hand, created_by, updated_by)
         SELECT stock_item_id, $2, batch_no, expiry_date, unit_cost_paise, sale_price_paise, $3, $4, $4 FROM stock_batches WHERE id = $1 RETURNING id`,
        [b[0]!.id, pharmacy, half, pha],
      );
      const { rows: inn } = await db.query<{ id: number }>(
        `INSERT INTO stock_movements (batch_id, location_id, kind, qty, balance_after, ref_type, ref_id, performed_by)
         VALUES ($1, $2, 'transfer_in', $3, $3, 'stock_transfer', $4, $5) RETURNING id::int`,
        [pb[0]!.id, pharmacy, half, tr[0]!.id, pha],
      );
      await db.query(
        `INSERT INTO stock_transfer_lines (transfer_id, from_location_id, to_location_id, stock_item_id, from_batch_id, to_batch_id, qty, out_movement_id, in_movement_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [tr[0]!.id, store, pharmacy, item.id, b[0]!.id, pb[0]!.id, half, out[0]!.id, inn[0]!.id],
      );
    }
    await db.query(
      `UPDATE stock_transfers SET status = 'received', received_by = $2, received_at = now() WHERE id = $1`,
      [tr[0]!.id, pha],
    );
    r.openingStock = true;
  }

  const changed = Object.entries(r).some(([k, v]) =>
    k === 'openingStock' ? v === true : (v as number) > 0,
  );
  if (changed) {
    await recordAudit(
      db,
      {
        actor: SYSTEM,
        action: 'demo_seed.catalogue_applied',
        entityType: 'system',
        changes: { ...r },
      },
      { requestId: null, ip: null },
    );
  }
  return r;
}
