import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import type { Database } from './db/client.js';
import { createLogger } from './lib/logger.js';
import { loadUser } from './middleware/auth.js';
import { csrfProtection } from './middleware/csrf.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { createLoginLimiter } from './middleware/rate-limit.js';
import { requestId } from './middleware/request-id.js';
import { requestLog } from './middleware/request-log.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { departmentRoutes, doctorRoutes } from './modules/directory/directory.routes.js';
import { patientRoutes } from './modules/patients/patients.routes.js';
import {
  appointmentRoutes,
  queueRoutes,
  schedulingDoctorRoutes,
} from './modules/scheduling/scheduling.routes.js';

export interface AppOptions {
  /** Defaults to a silent logger, so tests stay quiet unless they capture logs. */
  logger?: Logger;
  /**
   * Database and session middleware. Without them only the public routes (health) are
   * mounted, which is what the infrastructure unit tests use. server.ts always passes both.
   */
  db?: Database;
  session?: RequestHandler;
  loginLimiter?: RequestHandler;
  production?: boolean;
  /** Reverse-proxy hops to trust for req.ip (TRUST_PROXY). */
  trustProxy?: false | number;
}

/**
 * Middleware order (docs/architecture.md §1):
 *   helmet → requestId → request log → JSON body parser → session → loadUser → csrf
 *   → /api routes → JSON 404 → error handler.
 */
export function createApp({
  logger = createLogger({ level: 'silent' }),
  db,
  session,
  loginLimiter = createLoginLimiter(),
  production = false,
  trustProxy = false,
}: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  // API responses hold user details and the CSRF token: never cache or revalidate them.
  app.set('etag', false);
  app.set('trust proxy', trustProxy);
  app.use(helmet());
  app.use(requestId);
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(requestLog(logger));
  app.use(express.json({ limit: '100kb' }));

  const api = express.Router();
  // Liveness only: exposes no version, environment or configuration details.
  api.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  if (db && session) {
    app.use(session);
    app.use(loadUser(db));
    app.use(csrfProtection);
    api.use('/auth', authRoutes({ db, loginLimiter, production }));
    api.use('/departments', departmentRoutes(db));
    api.use('/doctors', doctorRoutes(db));
    api.use('/doctors', schedulingDoctorRoutes(db));
    api.use('/patients', patientRoutes(db));
    api.use('/appointments', appointmentRoutes(db));
    api.use('/queue', queueRoutes(db));
  }
  app.use('/api', api);

  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
