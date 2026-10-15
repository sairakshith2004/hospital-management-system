import { describe, expect, it } from 'vitest';
import { ROLE_CODES } from './index.js';

describe('ROLE_CODES', () => {
  it('lists exactly the 11 approved roles, once each', () => {
    expect(ROLE_CODES).toEqual([
      'SA',
      'ADM',
      'REC',
      'DOC',
      'NUR',
      'PHA',
      'LAB',
      'FIN',
      'HR',
      'INV',
      'MKT',
    ]);
    expect(new Set(ROLE_CODES).size).toBe(11);
    expect(ROLE_CODES).not.toContain('EQP');
  });
});
