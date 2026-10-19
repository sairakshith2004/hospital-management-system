import { describe, expect, it } from 'vitest';
import { USERNAME_RULE } from '@hospitalos/shared';
import { DEMO_DEPARTMENTS, DEMO_STAFF } from './demo-data.js';
import { SPECIALIST_DEPARTMENTS, SPECIALIST_DOCTORS } from './demo-specialists.js';

describe('demo specialists data', () => {
  it('adds new clinical departments with valid, unused codes', () => {
    const codes = SPECIALIST_DEPARTMENTS.map(([c]) => c);
    expect(codes.length).toBeGreaterThanOrEqual(15);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) {
      expect(c).toMatch(/^[A-Z][A-Z0-9_-]{1,19}$/);
      expect(DEMO_DEPARTMENTS.map((d) => d.code)).not.toContain(c);
    }
  });

  it('gives every doctor a unique first-name username, employee number and registration', () => {
    const all = [
      ...DEMO_STAFF.map((s) => s.username),
      ...SPECIALIST_DOCTORS.map((d) => d.username),
    ];
    expect(new Set(all).size).toBe(all.length);
    const known = new Set([
      ...DEMO_DEPARTMENTS.map((d) => d.code),
      ...SPECIALIST_DEPARTMENTS.map(([c]) => c),
    ]);
    const nos = [
      ...DEMO_STAFF.map((s) => s.employeeNo),
      ...SPECIALIST_DOCTORS.map((d) => d.employeeNo),
    ];
    expect(new Set(nos).size).toBe(nos.length);
    for (const d of SPECIALIST_DOCTORS) {
      expect(d.username).toMatch(USERNAME_RULE);
      expect(d.fullName.toLowerCase()).toContain(d.username);
      expect(known.has(d.department)).toBe(true);
      expect(d.slotMinutes).toBeGreaterThanOrEqual(5);
      expect(d.hours.start < d.hours.end).toBe(true);
    }
    // Every new department has at least one doctor.
    for (const [code] of SPECIALIST_DEPARTMENTS)
      expect(SPECIALIST_DOCTORS.some((d) => d.department === code)).toBe(true);
  });
});
