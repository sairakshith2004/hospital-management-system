import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { Queryable } from '../db/client.js';
import { createLogger } from '../lib/logger.js';
import { requireAuth, requirePermission, type AuthUser } from './auth.js';
import { errorHandler } from './error-handler.js';
import { requestId } from './request-id.js';

function fakeDb() {
  const audits: unknown[][] = [];
  const db: Queryable = {
    query: async (_text, params = []) => {
      audits.push(params);
      return { rows: [], rowCount: 1, command: 'INSERT', oid: 0, fields: [] };
    },
  };
  return { db, audits };
}

function user(permissions: string[]): AuthUser {
  return {
    id: 'u-1',
    username: 'zz_user',
    fullName: 'Test Person',
    roles: [],
    mustChangePassword: false,
    permissions: [],
    can: (p) => permissions.includes(p),
  };
}

function appFor(signedIn: AuthUser | undefined, db: Queryable) {
  const app = express();
  app.use(requestId);
  app.use((_req, res, next) => {
    res.locals.user = signedIn;
    next();
  });
  app.get('/api/me', requireAuth, (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/api/audit-logs', requirePermission(db, 'audit:read'), (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler(createLogger({ level: 'silent' })));
  return app;
}

describe('requireAuth', () => {
  it('returns 401 UNAUTHENTICATED without a user', async () => {
    const res = await request(appFor(undefined, fakeDb().db)).get('/api/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Authentication required',
    });
  });

  it('passes a signed-in user', async () => {
    expect((await request(appFor(user([]), fakeDb().db)).get('/api/me')).status).toBe(200);
  });
});

describe('requirePermission', () => {
  it('passes when the user holds the permission, without auditing', async () => {
    const { db, audits } = fakeDb();
    expect((await request(appFor(user(['audit:read']), db)).get('/api/audit-logs')).status).toBe(
      200,
    );
    expect(audits).toHaveLength(0);
  });

  it('returns a generic 403 and audits the denied route pattern and permission', async () => {
    const { db, audits } = fakeDb();
    const res = await request(appFor(user(['queue:read']), db)).get('/api/audit-logs?q=Ravi');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({
      code: 'FORBIDDEN',
      message: 'You do not have permission to do this',
    });
    expect(audits[0]?.slice(0, 5)).toEqual([
      'user',
      'u-1',
      'access.denied',
      'route',
      'GET /api/audit-logs',
    ]);
    expect(JSON.stringify(audits)).not.toContain('Ravi');
  });

  it('returns 401 (not 403) without a user, and audits nothing', async () => {
    const { db, audits } = fakeDb();
    expect((await request(appFor(undefined, db)).get('/api/audit-logs')).status).toBe(401);
    expect(audits).toHaveLength(0);
  });
});
