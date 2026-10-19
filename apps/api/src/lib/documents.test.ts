import { describe, expect, it } from 'vitest';
import { fiscalYear } from './documents.js';

describe('fiscalYear (April–March)', () => {
  it('starts the year on 1 April', () => {
    expect(fiscalYear('2026-03-31')).toBe(2025);
    expect(fiscalYear('2026-04-01')).toBe(2026);
    expect(fiscalYear('2027-01-15')).toBe(2026);
  });
});
