/**
 *   POST /api/auth/login   JSON { username, password } → 200 { user, csrfToken } | 401
 *   GET  /api/auth/me      → 200 { user, csrfToken } | 401
 *   POST /api/auth/logout  X-CSRF-Token required → 204 | 401 | 403
 *   There is no public sign-up: HR creates staff accounts (user:create, 2026-10-27).
 *   An account left pending by the old sign-up that signs in with the right password gets
 *   403 ACCOUNT_PENDING until an administrator approves or rejects it.
 */
import type { AuthResponse } from '@hospitalos/shared';
import { Router, type RequestHandler, type Response } from 'express';
import type { Database } from '../../db/client.js';
import { auditContext, recordAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { requireAuth, requireUser, type AuthUser } from '../../middleware/auth.js';
import { newCsrfToken } from '../../middleware/csrf.js';
import {
  destroySession,
  regenerateSession,
  saveSession,
  sessionCookieName,
  sessionCookieOptions,
} from '../../middleware/session.js';
import { findSessionUser } from './auth.repo.js';
import { LoginBody } from './auth.schemas.js';
import { authenticate } from './auth.service.js';

export interface AuthRoutesOptions {
  db: Database;
  loginLimiter: RequestHandler;
  production: boolean;
  /** Account lockout after repeated wrong passwords (on unless turned off for development). */
  lockout?: boolean;
}

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');

/** Login must be JSON: a cross-site HTML form can't send it (login CSRF). */
const requireJson: RequestHandler = (req, _res, next) => {
  next(
    req.is('application/json')
      ? undefined
      : new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'The request body must be JSON'),
  );
};

function toBody(
  user: Pick<AuthUser, 'id' | 'username' | 'fullName' | 'roles' | 'permissions'>,
  csrfToken: string,
): AuthResponse {
  return {
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      roles: user.roles,
      permissions: user.permissions,
    },
    csrfToken,
  };
}

export function authRoutes({
  db,
  loginLimiter,
  production,
  lockout = true,
}: AuthRoutesOptions): Router {
  const router = Router();

  router.post('/login', loginLimiter, requireJson, async (req, res: Response) => {
    const body = LoginBody.parse(req.body);
    const context = auditContext(req, res);
    const result = await authenticate(db, body, context, { lockout });
    if (!result.ok && result.reason === 'pending')
      throw new AppError(
        403,
        'ACCOUNT_PENDING',
        'Your account is waiting for approval by a hospital administrator.',
      );
    if (!result.ok) throw invalidCredentials();

    // A new session ID at login, so an ID planted beforehand is useless (fixation).
    await regenerateSession(req);
    const csrfToken = newCsrfToken();
    req.session.userId = result.userId;
    req.session.createdAt = Date.now();
    req.session.csrfToken = csrfToken;
    await saveSession(req);

    const user = await findSessionUser(db, result.userId);
    if (!user) throw invalidCredentials();
    await recordAudit(
      db,
      {
        actor: { type: 'user', userId: result.userId },
        action: 'auth.login_succeeded',
        entityType: 'user',
        entityId: result.userId,
      },
      context,
    );
    res.json(toBody(user, csrfToken));
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json(toBody(requireUser(res), req.session.csrfToken ?? ''));
  });

  router.post('/logout', requireAuth, async (req, res) => {
    const user = requireUser(res);
    // The session row is deleted first: if that fails, the request fails (500) rather
    // than reporting a logout that didn't happen.
    await destroySession(req);
    res.clearCookie(sessionCookieName(production), sessionCookieOptions(production));
    await recordAudit(
      db,
      {
        actor: { type: 'user', userId: user.id },
        action: 'auth.logout',
        entityType: 'user',
        entityId: user.id,
      },
      auditContext(req, res),
    );
    res.status(204).end();
  });

  return router;
}
