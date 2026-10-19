import { describe, expect, it } from 'vitest';
import { DOSAGE_FORMS, ROUTES, STRENGTH_UNITS } from '@hospitalos/shared';
import { FORMULARY, FORMULARY_PREFIX, parseComposition } from './demo-formulary.js';

describe('demo formulary data', () => {
  it('is a broad catalogue with unique, prefixed SKUs', () => {
    expect(FORMULARY.length).toBeGreaterThanOrEqual(140);
    const skus = FORMULARY.map((p) => p.sku);
    expect(new Set(skus).size).toBe(skus.length);
    for (const sku of skus) expect(sku.startsWith(FORMULARY_PREFIX)).toBe(true);
    expect(new Set(FORMULARY.map((p) => p.category)).size).toBeGreaterThanOrEqual(15);
  });

  it('uses only the dosage forms, routes and strength units the database allows', () => {
    for (const p of FORMULARY) {
      expect(DOSAGE_FORMS).toContain(p.form);
      expect(ROUTES).toContain(p.route);
      for (const [name, value, unit] of parseComposition(p.composition)) {
        expect(name.trim().length).toBeGreaterThan(0);
        expect(value).toBeGreaterThan(0);
        expect(STRENGTH_UNITS).toContain(unit);
      }
      expect(p.price).toBeGreaterThan(0);
      expect(p.brand.startsWith('Demo ')).toBe(true); // invented brands only
    }
  });

  it('covers every dosage form and includes over-the-counter products', () => {
    expect(new Set(FORMULARY.map((p) => p.form))).toEqual(new Set(DOSAGE_FORMS));
    expect(FORMULARY.some((p) => !p.rxOnly)).toBe(true);
  });

  it('parses combinations and rejects unknown units', () => {
    expect(parseComposition('amoxicillin 500 mg + clavulanic acid 125 mg')).toEqual([
      ['amoxicillin', 500, 'mg'],
      ['clavulanic acid', 125, 'mg'],
    ]);
    expect(parseComposition('sodium chloride 0.9 %')).toEqual([['sodium chloride', 0.9, '%']]);
    expect(() => parseComposition('insulin 100 IU/ml')).toThrow(/not understood/);
  });
});
