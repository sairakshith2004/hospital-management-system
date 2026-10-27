/**
 * Synchronizer-token CSRF protection (ADR 0004, amended). A random token is created at
 * login and kept in the server-side session. The SPA receives it in the login and /me
 * response bodies and sends it back in the X-CSRF-Token header on every request that
 * changes data. Another site can neither read the token nor set the header.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { CSRF_HEADER } from '@hospitalos/shared';
import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Login has no session yet, so it can't carry a token. It is protected instead by
 * requiring a JSON body (a cross-site HTML form can't send one) and SameSite=Lax.
 */
// Sign-in and sign-up have no session yet; both require a JSON body, which a cross-site
// HTML form can't send.
const EXEMPT_PATHS = new Set([
  '/api/auth/login',
  // Public, JSON-only and without a session: nothing a forged request could ride on.
  '/api/auth/password/forgot',
  '/api/auth/password/reset',
]);

export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export function tokensMatch(received: string | undefined, expected: string | undefined): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method) || EXEMPT_PATHS.has(req.path)) return next();
  // Without a signed-in session there is nothing to forge; the route's own checks decide.
  if (!req.session?.userId) return next();
  if (!tokensMatch(req.get(CSRF_HEADER), req.session.csrfToken)) {
    return next(new AppError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token'));
  }
  next();
};
