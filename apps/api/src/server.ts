import type { RequestHandler } from 'express';
import { createApp } from './app.js';
import { EventHub } from './modules/communication/event-hub.js';
import { createLiveKitSfu } from './modules/communication/sfu.js';
import { EnvError, loadEnv } from './config/env.js';
import { assertNotSuperuser, createPool } from './db/client.js';
import { createLogger } from './lib/logger.js';
import { dummyHash } from './lib/password.js';
import { createSession } from './middleware/session.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({ level: env.LOG_LEVEL });
  const production = env.NODE_ENV === 'production';

  const pool = createPool(env.DATABASE_URL, logger);
  await assertNotSuperuser(pool);
  await dummyHash(); // computed once up front, so the first failed login isn't faster

  const session = createSession({
    pool,
    secret: env.SESSION_SECRET,
    production,
    logger,
    prune: true,
  });
  const events = new EventHub();
  const sfu =
    env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET
      ? createLiveKitSfu({
          url: env.LIVEKIT_URL,
          apiKey: env.LIVEKIT_API_KEY,
          apiSecret: env.LIVEKIT_API_SECRET,
        })
      : undefined;
  // Local development: unlimited sign-in attempts (no per-IP limit, no account lockout),
  // so testing many accounts never blocks you. Production and tests keep both protections.
  const development = env.NODE_ENV === 'development';
  const noLimit: RequestHandler = (_req, _res, next) => next();
  const app = createApp({
    logger,
    events,
    ...(sfu && { sfu }),
    db: pool,
    session: session.middleware,
    production,
    ...(development && { loginLimiter: noLimit, lockout: false }),
    trustProxy: env.TRUST_PROXY,
  });

  const server = app.listen(env.PORT, env.HOST, () => {
    // Never log DATABASE_URL, SESSION_SECRET or any other setting beyond these three.
    logger.info({ host: env.HOST, port: env.PORT, env: env.NODE_ENV }, 'HospitalOS API listening');
  });
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    // Stop accepting requests, then stop the session cleanup timer, then close the pool.
    // Live-update streams never finish on their own, so end them first.
    events.closeAll();
    server.close(() => {
      session.store.close();
      void pool.end().finally(() => process.exit(0));
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  if (err instanceof EnvError) {
    // The logger isn't built yet. The message names variables and rules, never values.
    console.error(err.message);
  } else {
    console.error(`Failed to start: ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exit(1);
});
