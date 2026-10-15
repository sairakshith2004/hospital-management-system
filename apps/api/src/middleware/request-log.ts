import type { RequestHandler } from 'express';
import type { Logger } from 'pino';
import { getRequestId } from './request-id.js';

/**
 * One line per finished request, built from an allowlist: request ID, method, path
 * WITHOUT the query string (searches such as patient names travel in the query),
 * status and duration. Headers, cookies and bodies are never logged.
 */
export function requestLog(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      const entry = {
        requestId: getRequestId(res),
        method: req.method,
        path: req.originalUrl.split('?', 1)[0] ?? '',
        status: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
      };
      if (res.statusCode >= 500) logger.error(entry, 'request');
      else if (res.statusCode >= 400) logger.warn(entry, 'request');
      else logger.info(entry, 'request');
    });
    next();
  };
}
