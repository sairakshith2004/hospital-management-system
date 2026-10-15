import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('GET /api/health', () => {
  it('returns 200 with a minimal JSON body', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('does not advertise the framework', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('sends a generated X-Request-Id', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.headers['x-request-id']).toMatch(UUID);
  });
});

describe('paths without a route', () => {
  it.each(['/health', '/api/unknown', '/'])(
    '%s returns a JSON 404 in the error shape',
    async (path) => {
      const res = await request(createApp()).get(path);
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toEqual({
        error: { code: 'NOT_FOUND', message: 'Not found', requestId: res.headers['x-request-id'] },
      });
    },
  );
});
