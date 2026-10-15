import { createApp } from './app.js';
import { EnvError, loadEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';

function main(): void {
  const env = loadEnv();
  const logger = createLogger({ level: env.LOG_LEVEL });
  const server = createApp({ logger }).listen(env.PORT, env.HOST, () => {
    // Never log DATABASE_URL or any other setting beyond these three.
    logger.info({ host: env.HOST, port: env.PORT, env: env.NODE_ENV }, 'HospitalOS API listening');
  });
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

try {
  main();
} catch (err) {
  if (err instanceof EnvError) {
    // The logger isn't built yet. The message names variables and rules, never values.
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
