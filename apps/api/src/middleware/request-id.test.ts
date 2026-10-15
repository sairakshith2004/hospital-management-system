import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { requestIdFromHeader } from './request-id.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VALID = '3f1c2a4e-8b7d-4c6e-9a1b-2c3d4e5f6a7b';

describe('requestIdFromHeader', () => {
  it('reuses a well-formed UUID, lower-cased', () => {
    expect(requestIdFromHeader(VALID)).toBe(VALID);
    expect(requestIdFromHeader(VALID.toUpperCase())).toBe(VALID);
  });

  it.each([
    ['missing', undefined],
    ['not a UUID', 'abc'],
    ['an attempted log injection', `${VALID}\n{"level":60}`],
    ['oversized', 'a'.repeat(500)],
    ['two values', `${VALID}, ${VALID}`],
    ['a UUID with a wrong variant', '3f1c2a4e-8b7d-4c6e-7a1b-2c3d4e5f6a7b'],
  ])('generates a new UUID when the incoming id is %s', (_label, value) => {
    const id = requestIdFromHeader(value);
    expect(id).toMatch(UUID);
    expect(id).not.toBe(value);
  });
});

describe('X-Request-Id over HTTP', () => {
  it('echoes a valid incoming id', async () => {
    const res = await request(createApp()).get('/api/health').set('X-Request-Id', VALID);
    expect(res.headers['x-request-id']).toBe(VALID);
  });

  it('replaces an invalid incoming id and uses the replacement in error bodies', async () => {
    const res = await request(createApp()).get('/nowhere').set('X-Request-Id', 'not-a-uuid');
    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });
});
