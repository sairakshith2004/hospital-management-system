import express, { type Express } from 'express';
import type { Logger } from 'pino';
import { createLogger } from './lib/logger.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { requestId } from './middleware/request-id.js';
import { requestLog } from './middleware/request-log.js';

export interface AppOptions {
  /** Defaults to a silent logger, so tests stay quiet unless they capture logs. */
  logger?: Logger;
}

/**
 * Middleware order (docs/architecture.md §1):
 *   requestId → request log → JSON body parser → /api routes → JSON 404 → error handler.
 * The request ID comes first so every log line and error carries it, including body-parser
 * errors. helmet, rate limiting, sessions and CSRF are inserted on Day 5.
 */
export function createApp({
  logger = createLogger({ level: 'silent' }),
}: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(requestLog(logger));
  app.use(express.json({ limit: '100kb' }));

  const api = express.Router();
  // Liveness only: exposes no version, environment or configuration details.
  api.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.use('/api', api);

  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
