import { describe, expect, it } from 'vitest';
import { requestBody } from './use-api';

describe('requestBody', () => {
  it('leaves the id out when it is already in the path', () => {
    expect(requestBody({ id: 'x', decision: 'approved' }, true)).toEqual({ decision: 'approved' });
    expect(requestBody({ id: 'x' }, true)).toEqual({});
  });

  it('sends the body unchanged for a fixed path, and {} for no body', () => {
    expect(requestBody({ id: 'x', name: 'n' }, false)).toEqual({ id: 'x', name: 'n' });
    expect(requestBody({ decision: 'approved' }, true)).toEqual({ decision: 'approved' });
    expect(requestBody(undefined, true)).toEqual({});
  });
});
