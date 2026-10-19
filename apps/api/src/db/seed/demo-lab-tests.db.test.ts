import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { connectTest, inRollback } from '../test-db.js';
import { seedDemoData } from './demo-data.js';
import { TEST_DEPARTMENTS } from './demo-lab-department-tests.js';
import { DEMO_LAB_CATALOGUE, seedDemoLabTests } from './demo-lab-tests.js';
import { seedDemoSpecialists } from './demo-specialists.js';

// Runs as hms_app inside a rolled-back transaction: hms_test keeps no demo data.
let app!: pg.Client;
beforeAll(async () => {
  app = await connectTest('app');
});
afterAll(async () => {
  await app?.end();
});

const PARAMS = DEMO_LAB_CATALOGUE.reduce((n, t) => n + t.params.length, 0);
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$synthetic-test-salt$synthetic-test-hash';
/** Department links for tests this seed creates (the starter CBC/FBS/LFT aren't created here). */
const LINKS = DEMO_LAB_CATALOGUE.filter((t) => TEST_DEPARTMENTS[t.code]).length;

it('adds every test with its price and parameters once; a re-run adds nothing', () =>
  inRollback(app, async () => {
    // The departments come from the demo data and the specialists seed.
    await seedDemoData(app, { passwordHash: HASH });
    await seedDemoSpecialists(app, { passwordHash: HASH });
    const first = await seedDemoLabTests(app);
    expect(first).toEqual({
      tests: DEMO_LAB_CATALOGUE.length,
      parameters: PARAMS,
      skipped: 0,
      linkedToDepartments: LINKS,
    });
    const { rows: dept } = await app.query<{ dept: string }>(
      `SELECT d.code AS dept FROM lab_tests t JOIN service_catalogue s ON s.id = t.service_id
         JOIN departments d ON d.id = s.department_id WHERE t.code = 'ECG'`,
    );
    expect(dept[0]?.dept).toBe('CARDIO');

    const { rows } = await app.query<{ tests: number; params: number; text: number }>(
      `SELECT count(DISTINCT t.id)::int AS tests, count(p.id)::int AS params,
              count(p.id) FILTER (WHERE p.ref_text IS NOT NULL)::int AS text
         FROM lab_tests t
         JOIN service_catalogue s ON s.id = t.service_id AND s.kind = 'lab' AND s.code = 'LAB-' || t.code
         JOIN lab_test_parameters p ON p.test_id = t.id
        WHERE t.code = ANY($1)`,
      [DEMO_LAB_CATALOGUE.map((t) => t.code)],
    );
    expect(rows[0]).toEqual({
      tests: DEMO_LAB_CATALOGUE.length,
      params: PARAMS,
      text: DEMO_LAB_CATALOGUE.flatMap((t) => t.params).filter((p) => p[4]).length,
    });

    const second = await seedDemoLabTests(app);
    expect(second).toEqual({
      tests: 0,
      parameters: 0,
      skipped: DEMO_LAB_CATALOGUE.length,
      linkedToDepartments: 0,
    });
    const { rows: audit } = await app.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_logs WHERE action = 'demo_seed.lab_tests_applied' AND occurred_at = now()",
    );
    expect(audit[0]!.n).toBe(1);
  }));

it('leaves a test alone when its price-list code is already taken', () =>
  inRollback(app, async () => {
    await app.query(
      "INSERT INTO service_catalogue (code, name, kind, price_paise) VALUES ('LAB-ESR', 'Existing ESR', 'lab', 1)",
    );
    const r = await seedDemoLabTests(app);
    expect(r.skipped).toBe(1);
    const { rows } = await app.query("SELECT 1 FROM lab_tests WHERE code = 'ESR'");
    expect(rows).toHaveLength(0);
  }));
