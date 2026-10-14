import { createApp } from './app.js';
import { EnvError, loadEnv } from './config/env.js';

function main(): void {
  const env = loadEnv();
  const server = createApp().listen(env.PORT, env.HOST, () => {
    console.log(`HospitalOS API listening on http://${env.HOST}:${env.PORT} (${env.NODE_ENV})`);
  });
  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

try {
  main();
} catch (err) {
  if (err instanceof EnvError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
