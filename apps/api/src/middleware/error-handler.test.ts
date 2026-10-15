import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import { errorHandler, notFound } from './error-handler.js';
import { requestId } from './request-id.js';

// Synthetic values that must never reach a response.
const INTERNAL =
  'internal failure contacting postgres://hms_app:synthetic-pass@127.0.0.1:5432/hms_dev';
const DETAIL = 'Key (phone)=(9876543210) already exists.';

function testApp() {
  const app = express();
  app.use(requestId);
  app.use(express.json({ limit: '100kb' }));
  app.get('/app-error', () => {
    throw new AppError(409, 'EXAMPLE_CONFLICT', 'This example conflicts');
  });
  app.post('/validate', (req) => {
    z.object({ age: z.number().int() }).parse(req.body);
  });
  app.get('/boom', () => {
    throw Object.assign(new Error(INTERNAL), { detail: DETAIL });
  });
  app.get('/async-boom', async () => {
    await Promise.resolve();
    throw new Error(INTERNAL);
  });
  app.use(notFound);
  app.use(errorHandler(createLogger({ level: 'silent' })));
  return app;
}

function expectShape(res: request.Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/application\/json/);
  expect(Object.keys(res.body)).toEqual(['error']);
  expect(res.body.error).toMatchObject({ code, requestId: res.headers['x-request-id'] });
  expect(typeof res.body.error.message).toBe('string');
}

describe('error responses', () => {
  it('404: unknown path', async () => {
    const res = await request(testApp()).get('/missing');
    expectShape(res, 404, 'NOT_FOUND');
  });

  it('400: malformed JSON body', async () => {
    const res = await request(testApp())
      .post('/validate')
      .set('Content-Type', 'application/json')
      .send('{"age":');
    expectShape(res, 400, 'INVALID_JSON');
  });

  it('413: body over the 100 KB limit', async () => {
    const res = await request(testApp())
      .post('/validate')
      .send({ filler: 'x'.repeat(110_000) });
    expectShape(res, 413, 'PAYLOAD_TOO_LARGE');
  });

  it('AppError: its own status, code and message', async () => {
    const res = await request(testApp()).get('/app-error');
    expectShape(res, 409, 'EXAMPLE_CONFLICT');
    expect(res.body.error.message).toBe('This example conflicts');
  });

  it('422: validation lists field paths, never the submitted values', async () => {
    const res = await request(testApp()).post('/validate').send({ age: 'Ravi Kumar 9876543210' });
    expectShape(res, 422, 'VALIDATION_FAILED');
    expect(res.body.error.details).toEqual([{ path: 'age', message: expect.any(String) }]);
    expect(res.text).not.toContain('Ravi');
    expect(res.text).not.toContain('9876543210');
  });

  it.each(['/boom', '/async-boom'])('500 from %s: generic message, no internals', async (path) => {
    const res = await request(testApp()).get(path);
    expectShape(res, 500, 'INTERNAL_ERROR');
    expect(res.body.error.message).toBe('Something went wrong');
    for (const leak of [
      'internal failure',
      'postgres://',
      'synthetic-pass',
      '9876543210',
      'Error:',
      '    at ',
    ]) {
      expect(res.text).not.toContain(leak);
    }
  });
});
