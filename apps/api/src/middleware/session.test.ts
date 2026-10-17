import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../lib/logger.js';
import {
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  createSession,
  sessionCookieName,
  sessionCookieOptions,
} from './session.js';

describe('session settings', () => {
  it('uses a 30-minute idle timeout and a 12-hour absolute lifetime', () => {
    expect(SESSION_IDLE_MS).toBe(30 * 60 * 1000);
    expect(SESSION_ABSOLUTE_MS).toBe(12 * 60 * 60 * 1000);
  });

  it('names the cookie __Host-hms.sid in production and hms.sid in development', () => {
    expect(sessionCookieName(true)).toBe('__Host-hms.sid');
    expect(sessionCookieName(false)).toBe('hms.sid');
  });

  it('makes the cookie httpOnly and SameSite=Lax, and Secure only in production', () => {
    expect(sessionCookieOptions(true)).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
    });
    expect(sessionCookieOptions(false).secure).toBe(false);
  });

  it('builds the middleware and a closable store without touching the database', () => {
    const pool = {
      query: () => {
        throw new Error('no queries expected at construction');
      },
    } as unknown as pg.Pool;
    const setup = createSession({
      pool,
      secret: 'x'.repeat(64),
      production: false,
      logger: createLogger({ level: 'silent' }),
      prune: false,
    });
    expect(typeof setup.middleware).toBe('function');
    expect(() => setup.store.close()).not.toThrow();
  });
});
