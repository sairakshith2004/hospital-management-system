import { describe, expect, it } from 'vitest';
import { safeNext } from './redirect';

describe('safeNext', () => {
  it.each([
    ['/patients?q=1', '/patients?q=1'],
    ['/', '/'],
    [null, '/'],
    ['', '/'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['javascript:alert(1)', '/'],
  ])('%j → %j', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});
