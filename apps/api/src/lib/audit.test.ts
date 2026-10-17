import { describe, expect, it } from 'vitest';
import type { Queryable } from '../db/client.js';
import { AuditEntryError, SYSTEM, recordAudit, validateAuditEntry } from './audit.js';

function fakeDb() {
  const calls: { text: string; params: unknown[] }[] = [];
  const db: Queryable = {
    query: async (text, params = []) => {
      calls.push({ text, params });
      return { rows: [], rowCount: 1, command: 'INSERT', oid: 0, fields: [] };
    },
  };
  return { db, calls };
}

const context = { requestId: '00000000-0000-4000-8000-000000000000', ip: '127.0.0.1' };

describe('recordAudit', () => {
  it('writes a system actor with no user ID', async () => {
    const { db, calls } = fakeDb();
    await recordAudit(
      db,
      { actor: SYSTEM, action: 'auth.login_failed', entityType: 'user', reason: 'unknown_user' },
      context,
    );
    expect(calls[0]?.params).toEqual([
      'system',
      null,
      'auth.login_failed',
      'user',
      null,
      null,
      'unknown_user',
      null,
      context.requestId,
      context.ip,
    ]);
  });

  it('writes a user actor and JSON changes', async () => {
    const { db, calls } = fakeDb();
    await recordAudit(
      db,
      {
        actor: { type: 'user', userId: 'u-1' },
        action: 'access.denied',
        entityType: 'route',
        entityId: 'GET /api/x',
        changes: { permission: 'audit:read' },
      },
      context,
    );
    expect(calls[0]?.params.slice(0, 2)).toEqual(['user', 'u-1']);
    expect(calls[0]?.params[7]).toBe('{"permission":"audit:read"}');
  });

  it.each([
    'password',
    'newPassword',
    'password_hash',
    'csrfToken',
    'sid',
    'sessionId',
    'cookie',
    'apiSecret',
  ])('refuses a changes key that could hold a secret: %s', async (key) => {
    const { db, calls } = fakeDb();
    const entry = {
      actor: SYSTEM,
      action: 'user.updated',
      entityType: 'user',
      changes: { [key]: 'x' },
    };
    expect(() => validateAuditEntry(entry)).toThrow(AuditEntryError);
    await expect(recordAudit(db, entry, context)).rejects.toThrow(AuditEntryError);
    expect(calls).toHaveLength(0);
  });

  it.each(['login', 'Auth.Login', 'auth.', 'auth login'])(
    'refuses the action name %j',
    (action) => {
      expect(() => validateAuditEntry({ actor: SYSTEM, action, entityType: 'user' })).toThrow(
        AuditEntryError,
      );
    },
  );
});
