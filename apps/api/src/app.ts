import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import type { Database } from './db/client.js';
import { createLogger } from './lib/logger.js';
import { loadUser, requirePasswordChosen } from './middleware/auth.js';
import { csrfProtection } from './middleware/csrf.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { createLoginLimiter } from './middleware/rate-limit.js';
import { requestId } from './middleware/request-id.js';
import { requestLog } from './middleware/request-log.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { billingRoutes } from './modules/billing/billing.routes.js';
import { clinicalRoutes } from './modules/clinical/clinical.routes.js';
import { communicationRoutes } from './modules/communication/communication.routes.js';
import { EventHub } from './modules/communication/event-hub.js';
import { meetingRoutes } from './modules/communication/meetings.routes.js';
import type { Sfu } from './modules/communication/sfu.js';
import type { Mailer } from './lib/mailer.js';
import { departmentRoutes, doctorRoutes } from './modules/directory/directory.routes.js';
import { inventoryRoutes } from './modules/inventory/inventory.routes.js';
import { operationsRoutes } from './modules/operations/operations.routes.js';
import { reportRoutes } from './modules/reports/doctor-report.routes.js';
import { labRoutes } from './modules/lab/lab.routes.js';
import { patientRoutes } from './modules/patients/patients.routes.js';
import { pharmacyRoutes } from './modules/pharmacy/pharmacy.routes.js';
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
  /** Account lockout after repeated wrong passwords; on by default. */
  lockout?: boolean;
  /** Reverse-proxy hops to trust for req.ip (TRUST_PROXY). */
  trustProxy?: false | number;
  /** Live-update channel for the communication hub; a fresh one by default. */
  events?: EventHub;
  /** LiveKit media server for video meetings; browser-to-browser video without it. */
  sfu?: Sfu;
  /** Sends password-reset links (SMTP); "forgot password" can't email without it. */
  mailer?: Mailer;
  /** The web app's address, for links in emails. */
  appUrl?: string;
  /** Forgot-password and reset-link requests: 5 per IP per 15 minutes by default. */
  passwordLimiter?: RequestHandler;
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
  lockout = true,
  trustProxy = false,
  events = new EventHub(),
  sfu,
  mailer,
  appUrl = 'http://127.0.0.1:5173',
  passwordLimiter = createLoginLimiter({
    limit: 5,
    windowMs: 15 * 60 * 1000,
    countSuccesses: true,
  }),
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
    app.use(requirePasswordChosen);
    api.use(
      '/auth',
      authRoutes({
        db,
        loginLimiter,
        passwordLimiter,
        production,
        lockout,
        mailer,
        appUrl,
        logger,
      }),
    );
    api.use('/departments', departmentRoutes(db));
    api.use('/doctors', doctorRoutes(db));
    api.use('/doctors', schedulingDoctorRoutes(db));
    api.use('/patients', patientRoutes(db));
    api.use('/appointments', appointmentRoutes(db));
    api.use('/queue', queueRoutes(db));
    api.use(inventoryRoutes(db));
    api.use(clinicalRoutes(db));
    api.use(pharmacyRoutes(db));
    api.use(labRoutes(db));
    api.use(billingRoutes(db));
    api.use(adminRoutes(db));
    api.use(operationsRoutes(db));
    api.use(reportRoutes(db));
    api.use(communicationRoutes(db, events));
    api.use(meetingRoutes(db, events, sfu));
  }
  app.use('/api', api);

  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
