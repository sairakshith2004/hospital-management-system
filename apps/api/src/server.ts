import { createApp } from './app.js';
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
  const app = createApp({
    logger,
    db: pool,
    session: session.middleware,
    production,
    trustProxy: env.TRUST_PROXY,
  });

  const server = app.listen(env.PORT, env.HOST, () => {
    // Never log DATABASE_URL, SESSION_SECRET or any other setting beyond these three.
    logger.info({ host: env.HOST, port: env.PORT, env: env.NODE_ENV }, 'HospitalOS API listening');
  });
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    // Stop accepting requests, then stop the session cleanup timer, then close the pool.
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
