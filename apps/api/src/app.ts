import express, { type Express } from 'express';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  // Liveness only: exposes no version, environment or configuration details.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}
