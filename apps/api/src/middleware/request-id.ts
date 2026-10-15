import { randomUUID } from 'node:crypto';
import type { RequestHandler, Response } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';

// A canonical UUID (any version 1–8, RFC 4122/9562 variant). Nothing else is trusted.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Reuses a well-formed incoming UUID, so a caller can correlate its own logs; anything
 * else (missing, malformed, oversized, several values) gets a fresh UUID. This keeps
 * arbitrary caller text out of logs and responses.
 */
export function requestIdFromHeader(value: string | undefined): string {
  return value !== undefined && UUID.test(value) ? value.toLowerCase() : randomUUID();
}

/** Sets res.locals.requestId and the X-Request-Id response header. Runs first. */
export const requestId: RequestHandler = (req, res, next) => {
  const id = requestIdFromHeader(req.get(REQUEST_ID_HEADER));
  res.locals.requestId = id;
  res.set(REQUEST_ID_HEADER, id);
  next();
};

export function getRequestId(res: Response): string {
  const id: unknown = res.locals.requestId;
  return typeof id === 'string' ? id : '';
}
