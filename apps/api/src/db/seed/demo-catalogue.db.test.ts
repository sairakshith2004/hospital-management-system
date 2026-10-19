import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { connectTest, inRollback } from '../test-db.js';
import {
  DEMO_LAB_TESTS,
  DEMO_MEDICINES,
  DEMO_SUPPLIES,
  seedDemoCatalogue,
} from './demo-catalogue.js';
import { seedDemoData } from './demo-data.js';

// Runs as hms_app inside a rolled-back transaction: hms_test keeps no demo data.
let app!: pg.Client;
beforeAll(async () => {
  app = await connectTest('app');
});
afterAll(async () => {
  await app?.end();
});
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$synthetic-test-salt$synthetic-test-hash';

it('adds the demo catalogue and reconciled opening stock once; a re-run adds nothing', () =>
  inRollback(app, async () => {
    await seedDemoData(app, { passwordHash: HASH });
    const first = await seedDemoCatalogue(app);
    expect(first).toMatchObject({
      items: DEMO_MEDICINES.length + DEMO_SUPPLIES.length,
      labTests: DEMO_LAB_TESTS.length,
      openingStock: true,
    });
    // Every batch equals the sum of its movements; the commit-time check runs here too.
    await app.query('SET CONSTRAINTS ALL IMMEDIATE');
    const { rows } = await app.query<{ bad: number }>(
      `SELECT count(*)::int AS bad FROM stock_batches b
       WHERE b.qty_on_hand <> (SELECT coalesce(sum(qty), 0) FROM stock_movements m WHERE m.batch_id = b.id)`,
    );
    expect(rows[0]!.bad).toBe(0);
    await app.query('SET CONSTRAINTS ALL DEFERRED');
    const { rows: ph } = await app.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM stock_batches b JOIN locations l ON l.id = b.location_id WHERE l.code = 'MAIN-PHARM' AND b.qty_on_hand > 0`,
    );
    expect(ph[0]!.n).toBe(DEMO_MEDICINES.length);
    const second = await seedDemoCatalogue(app);
    expect(second).toEqual({
      locations: 0,
      ingredients: 0,
      items: 0,
      labTests: 0,
      services: 0,
      suppliers: 0,
      expenseCategories: 0,
      referralSources: 0,
      openingStock: false,
    });
    const { rows: audit } = await app.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_logs WHERE action = 'demo_seed.catalogue_applied' AND occurred_at = now()",
    );
    expect(audit[0]!.n).toBe(1);
  }));
