import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { connectTest, inRollback } from '../test-db.js';
import { seedDemoCatalogue } from './demo-catalogue.js';
import { seedDemoData } from './demo-data.js';
import { FORMULARY, seedDemoFormulary } from './demo-formulary.js';

// Runs as hms_app inside a rolled-back transaction: hms_test keeps no demo data.
let app!: pg.Client;
beforeAll(async () => {
  app = await connectTest('app');
});
afterAll(async () => {
  await app?.end();
});
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$synthetic-test-salt$synthetic-test-hash';

it('refuses without the demo catalogue locations', () =>
  inRollback(app, async () => {
    const { rows } = await app.query(
      "SELECT 1 FROM locations WHERE code IN ('GEN-STORE', 'MAIN-PHARM')",
    );
    if (rows.length === 2) return; // hms_test already has them; nothing to prove here
    await expect(seedDemoFormulary(app)).rejects.toThrow(/db:seed:demo:catalogue first/);
  }));

it('adds the formulary with reconciled opening stock once; a re-run adds nothing', () =>
  inRollback(app, async () => {
    await seedDemoData(app, { passwordHash: HASH });
    await seedDemoCatalogue(app);
    const first = await seedDemoFormulary(app);
    expect(first).toMatchObject({
      products: FORMULARY.length,
      stockedItems: FORMULARY.length,
      batches: FORMULARY.length * 2,
      supplier: 1,
    });

    // Every batch equals the sum of its movements; the commit-time check runs here too.
    await app.query('SET CONSTRAINTS ALL IMMEDIATE');
    const { rows: bad } = await app.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM stock_batches b
       WHERE b.qty_on_hand <> (SELECT coalesce(sum(qty), 0) FROM stock_movements m WHERE m.batch_id = b.id)`,
    );
    expect(bad[0]!.n).toBe(0);
    await app.query('SET CONSTRAINTS ALL DEFERRED');

    // Every formulary product is in the pharmacy, with its ingredients and dosage form.
    const { rows: ph } = await app.query<{ n: number }>(
      `SELECT count(DISTINCT s.id)::int AS n FROM stock_items s
         JOIN medicine_products mp ON mp.stock_item_id = s.id
         JOIN product_ingredients pi ON pi.product_id = s.id
         JOIN stock_batches b ON b.stock_item_id = s.id AND b.qty_on_hand > 0
         JOIN locations l ON l.id = b.location_id AND l.code = 'MAIN-PHARM'
        WHERE s.sku LIKE 'DF-%'`,
    );
    expect(ph[0]!.n).toBe(FORMULARY.length);

    // The deliberate warnings exist: near expiry (within 30 days) and below reorder level.
    const { rows: warn } = await app.query<{ near: number; low: number }>(
      `SELECT
         (SELECT count(DISTINCT b.stock_item_id)::int FROM stock_batches b JOIN stock_items s ON s.id = b.stock_item_id
           WHERE s.sku LIKE 'DF-%' AND b.expiry_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date + 30) AS near,
         (SELECT count(*)::int FROM stock_items s
           WHERE s.sku LIKE 'DF-%' AND s.reorder_level >=
             (SELECT coalesce(sum(b.qty_on_hand), 0) FROM stock_batches b WHERE b.stock_item_id = s.id)) AS low`,
    );
    expect(warn[0]!.near).toBe(FORMULARY.filter((p) => p.stock?.expiryDays).length);
    expect(warn[0]!.low).toBe(FORMULARY.filter((p) => p.stock?.qty).length);

    const second = await seedDemoFormulary(app);
    expect(second).toEqual({
      ingredients: 0,
      products: 0,
      supplier: 0,
      stockedItems: 0,
      batches: 0,
    });
    const { rows: audit } = await app.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_logs WHERE action = 'demo_seed.formulary_applied' AND occurred_at = now()",
    );
    expect(audit[0]!.n).toBe(1);
  }));
