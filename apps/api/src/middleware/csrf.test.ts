import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from './error-handler.js';
import { csrfProtection, newCsrfToken, tokensMatch } from './csrf.js';
import { requestId } from './request-id.js';
import { createLogger } from '../lib/logger.js';

const TOKEN = newCsrfToken();

/** A stand-in session: signed in with TOKEN unless `signedIn` is false. */
function appWith(signedIn: boolean) {
  const app = express();
  app.use(requestId);
  app.use((req, _res, next) => {
    (req as unknown as { session: unknown }).session = signedIn
      ? { userId: 'u-1', csrfToken: TOKEN }
      : {};
    next();
  });
  app.use(csrfProtection);
  app.all('/api/{*rest}', (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler(createLogger({ level: 'silent' })));
  return app;
}

describe('csrfProtection', () => {
  it.each(['post', 'put', 'patch', 'delete'] as const)(
    'refuses %s without a token',
    async (method) => {
      const res = await request(appWith(true))[method]('/api/x');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_INVALID');
    },
  );

  it.each([
    ['a wrong token', newCsrfToken()],
    ['a token of a different length', 'short'],
    ['an empty token', ''],
  ])('refuses %s', async (_label, token) => {
    const res = await request(appWith(true)).post('/api/x').set('X-CSRF-Token', token);
    expect(res.status).toBe(403);
  });

  it('allows the session token', async () => {
    const res = await request(appWith(true)).post('/api/x').set('X-CSRF-Token', TOKEN);
    expect(res.status).toBe(200);
  });

  it.each(['get', 'head', 'options'] as const)('does not check %s', async (method) => {
    expect((await request(appWith(true))[method]('/api/x')).status).toBe(200);
  });

  it('does not check requests without a signed-in session, or the login route', async () => {
    expect((await request(appWith(false)).post('/api/x')).status).toBe(200);
    expect((await request(appWith(true)).post('/api/auth/login')).status).toBe(200);
  });

  it('creates unpredictable 256-bit tokens and compares safely', () => {
    expect(TOKEN).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newCsrfToken()).not.toBe(TOKEN);
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true);
    expect(tokensMatch(undefined, TOKEN)).toBe(false);
    expect(tokensMatch(TOKEN, undefined)).toBe(false);
  });
});
