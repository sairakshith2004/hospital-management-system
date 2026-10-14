import { describe, expect, it } from 'vitest';
import { ROLE_CODES } from './index.js';

describe('ROLE_CODES', () => {
  it('lists the 12 documented roles exactly once', () => {
    expect(ROLE_CODES).toHaveLength(12);
    expect(new Set(ROLE_CODES).size).toBe(12);
  });
});
