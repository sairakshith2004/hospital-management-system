import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../lib/errors.js';

export interface LoginLimiterOptions {
  limit?: number;
  windowMs?: number;
}

/**
 * Login attempts per client IP: 10 failed attempts per 15 minutes (successful logins
 * don't count). Kept in memory, which is correct for a single API instance; a shared
 * store is needed before running more than one. Excess attempts get 429 RATE_LIMITED
 * with Retry-After, and are not processed or audited.
 */
export function createLoginLimiter({
  limit = 10,
  windowMs = 15 * 60 * 1000,
}: LoginLimiterOptions = {}): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new AppError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.'));
    },
  });
}
