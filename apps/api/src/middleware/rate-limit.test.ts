import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../lib/logger.js';
import { errorHandler } from './error-handler.js';
import { createLoginLimiter } from './rate-limit.js';
import { requestId } from './request-id.js';

function appWith(limit: number) {
  const app = express();
  app.use(requestId, express.json());
  app.post('/login', createLoginLimiter({ limit, windowMs: 60_000 }), (req, res) => {
    res.status((req.body as { ok?: boolean }).ok ? 200 : 401).json({});
  });
  app.use(errorHandler(createLogger({ level: 'silent' })));
  return app;
}

describe('login rate limiter', () => {
  it('answers attempts beyond the limit with 429 RATE_LIMITED and Retry-After', async () => {
    const app = appWith(2);
    expect((await request(app).post('/login').send({})).status).toBe(401);
    expect((await request(app).post('/login').send({})).status).toBe(401);
    const res = await request(app).post('/login').send({});
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Try again later.',
      requestId: res.headers['x-request-id'],
    });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('does not count successful logins', async () => {
    const app = appWith(2);
    for (let i = 0; i < 5; i += 1) {
      expect((await request(app).post('/login').send({ ok: true })).status).toBe(200);
    }
    expect((await request(app).post('/login').send({})).status).toBe(401);
  });
});
