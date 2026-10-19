import { describe, expect, it } from 'vitest';
import { createLabTestSchema } from '@hospitalos/shared';
import { DEMO_LAB_TESTS } from './demo-catalogue.js';
import { DEMO_DEPARTMENTS } from './demo-data.js';
import { DEPARTMENT_DIAGNOSTICS, TEST_DEPARTMENTS } from './demo-lab-department-tests.js';
import { DEMO_LAB_CATALOGUE } from './demo-lab-tests.js';
import { SPECIALIST_DEPARTMENTS } from './demo-specialists.js';

describe('demo lab test catalogue data', () => {
  it('is a broad catalogue with unique codes that do not repeat the starter tests', () => {
    expect(DEMO_LAB_CATALOGUE.length).toBeGreaterThanOrEqual(100);
    const codes = DEMO_LAB_CATALOGUE.map((t) => t.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const [starter] of DEMO_LAB_TESTS) expect(codes).not.toContain(starter);
    expect(new Set(DEMO_LAB_CATALOGUE.map((t) => t.category)).size).toBeGreaterThanOrEqual(15);
    expect(DEMO_LAB_CATALOGUE.some((t) => t.code.startsWith('HC-'))).toBe(true);
  });

  it('passes the same validation as a test added in the app', () => {
    for (const t of DEMO_LAB_CATALOGUE) {
      const parsed = createLabTestSchema.safeParse({
        code: t.code,
        name: t.name,
        sampleType: t.sample,
        turnaroundHours: t.turnaroundHours,
        pricePaise: t.pricePaise,
        parameters: t.params.map(([name, unit, refLow, refHigh, refText]) => ({
          name,
          unit,
          refLow,
          refHigh,
          refText,
        })),
      });
      expect(parsed.success, `${t.code}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      expect(t.pricePaise).toBeGreaterThan(0);
    }
  });

  it('gives every parameter a unique name within its test and some kind of reference', () => {
    for (const t of DEMO_LAB_CATALOGUE) {
      const names = t.params.map(([name]) => name);
      expect(new Set(names).size, t.code).toBe(names.length);
      for (const [name, , low, high, text] of t.params) {
        expect(low !== null || high !== null || Boolean(text), `${t.code} ${name}`).toBe(true);
      }
    }
  });

  it('links tests only to clinical departments that exist, and gives every one its own tests', () => {
    const clinical = new Set([
      ...DEMO_DEPARTMENTS.filter((d) => d.isClinical).map((d) => d.code),
      ...SPECIALIST_DEPARTMENTS.map(([c]) => c),
    ]);
    const codes = new Set([
      ...DEMO_LAB_CATALOGUE.map((t) => t.code),
      ...DEMO_LAB_TESTS.map(([c]) => c),
    ]);
    for (const [test, dept] of Object.entries(TEST_DEPARTMENTS)) {
      expect(codes.has(test), test).toBe(true);
      expect(clinical.has(dept), dept).toBe(true);
    }
    for (const dept of clinical) {
      expect(Object.values(TEST_DEPARTMENTS).includes(dept), dept).toBe(true);
    }
    expect(Object.keys(DEPARTMENT_DIAGNOSTICS).length).toBeGreaterThanOrEqual(15);
  });
});
