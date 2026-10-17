/**
 * Server-side sessions (ADR 0004): express-session with the PostgreSQL `sessions` table,
 * through the API's hms_app pool. No session exists until login.
 */
import connectPgSimple from 'connect-pg-simple';
import type { CookieOptions, Request, RequestHandler } from 'express';
import session from 'express-session';
import type pg from 'pg';
import type { Logger } from 'pino';

/** Idle timeout: each request pushes the expiry this far ahead (rolling). */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
/** Absolute lifetime from login, whatever the activity. Enforced in loadUser. */
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;

/**
 * In production the __Host- prefix makes the browser refuse the cookie unless it is
 * Secure, has Path=/ and no Domain, so no subdomain or plain-HTTP page can set it.
 */
export function sessionCookieName(production: boolean): string {
  return production ? '__Host-hms.sid' : 'hms.sid';
}

export function sessionCookieOptions(production: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure: production, path: '/' };
}

export interface SessionOptions {
  pool: pg.Pool;
  secret: string;
  production: boolean;
  logger: Logger;
  /** Delete expired rows every 15 minutes. Off in tests. */
  prune: boolean;
}

export interface SessionSetup {
  middleware: RequestHandler;
  store: session.Store & { close(): void };
}

export function createSession(options: SessionOptions): SessionSetup {
  const PgStore = connectPgSimple(session);
  const store = new PgStore({
    pool: options.pool,
    tableName: 'sessions',
    createTableIfMissing: false, // migration 0002 owns the table
    pruneSessionInterval: options.prune ? 15 * 60 : false,
    errorLog: (...args: unknown[]) => {
      const err = args.find((a) => a instanceof Error);
      options.logger.error({ err }, 'session store error');
    },
  });
  const middleware = session({
    name: sessionCookieName(options.production),
    secret: options.secret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    unset: 'destroy',
    cookie: { ...sessionCookieOptions(options.production), maxAge: SESSION_IDLE_MS },
  });
  return { middleware, store };
}

export function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) =>
    req.session.regenerate((err: unknown) => (err ? reject(err) : resolve())),
  );
}

export function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) =>
    req.session.save((err: unknown) => (err ? reject(err) : resolve())),
  );
}

export function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) =>
    req.session.destroy((err: unknown) => (err ? reject(err) : resolve())),
  );
}
