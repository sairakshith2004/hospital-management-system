/**
 * Authentication and route-level authorization (architecture §3, rule 4).
 *   loadUser          every request: resolves the session to an active user, or none
 *   requireAuth       401 without a signed-in user
 *   requirePermission 401 without a user, 403 (audited) without the permission
 */
import type { PermissionCode, SessionUser } from '@hospitalos/shared';
import type { Request, RequestHandler, Response } from 'express';
import type { Queryable } from '../db/client.js';
import { auditContext, recordAudit } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { findSessionUser } from '../modules/auth/auth.repo.js';
import { SESSION_ABSOLUTE_MS, destroySession } from './session.js';

export interface AuthUser extends SessionUser {
  can(permission: PermissionCode): boolean;
}

export function currentUser(res: Response): AuthUser | undefined {
  return res.locals.user as AuthUser | undefined;
}

/** For handlers behind requireAuth or requirePermission. */
export function requireUser(res: Response): AuthUser {
  const user = currentUser(res);
  if (!user) throw unauthenticated();
  return user;
}

export function unauthenticated(): AppError {
  return new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
}

/**
 * Ends sessions that are past the 12-hour limit or belong to a missing or disabled
 * user, then carries on unauthenticated: public routes still work, protected ones 401.
 */
export function loadUser(db: Queryable): RequestHandler {
  return async (req, res, next) => {
    const { userId, createdAt } = req.session ?? {};
    if (!userId) return next();
    if (typeof createdAt !== 'number' || Date.now() - createdAt > SESSION_ABSOLUTE_MS) {
      await destroySession(req);
      return next();
    }
    const user = await findSessionUser(db, userId);
    if (!user || user.status !== 'active') {
      await destroySession(req);
      return next();
    }
    const granted = new Set<string>(user.permissions);
    const authUser: AuthUser = {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      roles: user.roles,
      permissions: user.permissions,
      can: (permission) => granted.has(permission),
    };
    res.locals.user = authUser;
    next();
  };
}

export const requireAuth: RequestHandler = (_req, res, next) => {
  next(currentUser(res) ? undefined : unauthenticated());
};

function routeLabel(req: Request): string {
  const route = (req.route as { path?: unknown } | undefined)?.path;
  const path = typeof route === 'string' ? `${req.baseUrl}${route}` : req.baseUrl || req.path;
  return `${req.method} ${path}`;
}

/** The route pattern (never the concrete URL, which may hold IDs or search text). */
export function requirePermission(db: Queryable, permission: PermissionCode): RequestHandler {
  return async (req, res, next) => {
    const user = currentUser(res);
    if (!user) return next(unauthenticated());
    if (user.can(permission)) return next();
    await recordAudit(
      db,
      {
        actor: { type: 'user', userId: user.id },
        action: 'access.denied',
        entityType: 'route',
        entityId: routeLabel(req),
        changes: { permission },
      },
      auditContext(req, res),
    );
    next(new AppError(403, 'FORBIDDEN', 'You do not have permission to do this'));
  };
}

/** Like requirePermission, but any one of `permissions` is enough (403 and audited otherwise). */
export function requireAnyPermission(db: Queryable, permissions: PermissionCode[]): RequestHandler {
  return async (req, res, next) => {
    const user = currentUser(res);
    if (!user) return next(unauthenticated());
    if (permissions.some((p) => user.can(p))) return next();
    await recordAudit(
      db,
      {
        actor: { type: 'user', userId: user.id },
        action: 'access.denied',
        entityType: 'route',
        entityId: routeLabel(req),
        changes: { permission: permissions },
      },
      auditContext(req, res),
    );
    next(new AppError(403, 'FORBIDDEN', 'You do not have permission to do this'));
  };
}

/** For checks that depend on the record (e.g. a batch's location kind): 403 and audited. */
export async function denyAccess(
  db: Queryable,
  req: Request,
  res: Response,
  permission: PermissionCode,
): Promise<never> {
  await recordAudit(
    db,
    {
      actor: { type: 'user', userId: requireUser(res).id },
      action: 'access.denied',
      entityType: 'route',
      entityId: routeLabel(req),
      changes: { permission },
    },
    auditContext(req, res),
  );
  throw new AppError(403, 'FORBIDDEN', 'You do not have permission to do this');
}
