import { describe, expect, it } from 'vitest';
import { leaveDays } from './LeavePage';

describe('leaveDays', () => {
  it('counts calendar days with both ends included', () => {
    expect(leaveDays('2030-01-07', '2030-01-07')).toBe(1);
    expect(leaveDays('2030-01-07', '2030-01-09')).toBe(3);
    expect(leaveDays('2030-12-30', '2031-01-02')).toBe(4);
    expect(leaveDays('2030-03-01', '2030-02-28')).toBe(0);
    expect(leaveDays('', '2030-01-01')).toBe(0);
  });
});
