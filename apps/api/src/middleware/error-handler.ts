import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { getRequestId } from './request-id.js';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: { path: string; message: string }[];
    data?: Record<string, unknown>;
  };
}

function send(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: ErrorBody['error']['details'],
  data?: ErrorBody['error']['data'],
): void {
  const body: ErrorBody = {
    error: {
      code,
      message,
      requestId: getRequestId(res),
      ...(details ? { details } : {}),
      ...(data ? { data } : {}),
    },
  };
  res.status(status).json(body);
}

/** Every path no route handled. The API serves nothing outside /api. */
export const notFound: RequestHandler = (_req, res) => {
  send(res, 404, 'NOT_FOUND', 'Not found');
};

/**
 * Turns every error into { error: { code, message, requestId } }. Only AppError messages
 * and fixed texts reach the client; exception messages, stacks and database details never
 * do. Unexpected errors are logged (see serializeError) and answered with a generic 500.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err instanceof AppError) {
      send(res, err.status, err.code, err.message, undefined, err.data);
      return;
    }
    if (err instanceof ZodError) {
      // Field paths and rule messages only; the submitted values are never echoed.
      const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      send(res, 422, 'VALIDATION_FAILED', 'The request is not valid', details);
      return;
    }
    const { type, status } = (err ?? {}) as { type?: unknown; status?: unknown };
    if (type === 'entity.parse.failed') {
      send(res, 400, 'INVALID_JSON', 'The request body is not valid JSON');
      return;
    }
    if (type === 'entity.too.large') {
      send(res, 413, 'PAYLOAD_TOO_LARGE', 'The request body is too large');
      return;
    }
    if (typeof status === 'number' && status >= 400 && status < 500) {
      // Other body-parser errors (unsupported charset or encoding, aborted request).
      send(res, status, 'BAD_REQUEST', 'The request could not be processed');
      return;
    }
    logger.error({ err, requestId: getRequestId(res) }, 'unhandled error');
    send(res, 500, 'INTERNAL_ERROR', 'Something went wrong');
  };
}
