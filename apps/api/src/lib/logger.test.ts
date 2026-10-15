import { Writable } from 'node:stream';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { errorHandler } from '../middleware/error-handler.js';
import { requestId } from '../middleware/request-id.js';
import { createLogger } from './logger.js';

/** A logger whose JSON lines are kept in memory. */
function capture() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { lines, logger: createLogger({ level: 'info', destination }) };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

// Synthetic sensitive values. None may appear in any log line.
const SECRETS = {
  patient: 'Ravi Kumar',
  phone: '9876543210',
  password: 'Hunter2-synthetic',
  token: 'synthetic-token-123',
  cookie: 'synthetic-session-456',
  dbPassword: 'synthetic-db-pass',
};

describe('logging', () => {
  it('request lines carry only the allowlisted fields and none of the sensitive input', async () => {
    const { lines, logger } = capture();
    await request(createApp({ logger }))
      .post(`/api/health?q=${encodeURIComponent(SECRETS.patient)}&phone=${SECRETS.phone}`)
      .set('Authorization', `Bearer ${SECRETS.token}`)
      .set('Cookie', `sid=${SECRETS.cookie}`)
      .send({
        password: SECRETS.password,
        phone: SECRETS.phone,
        databaseUrl: `postgres://hms_app:${SECRETS.dbPassword}@127.0.0.1:5432/hms_test`,
      });
    await settle();
    const text = lines.join('');
    for (const value of [...Object.values(SECRETS), 'Ravi', 'postgres://', 'Bearer']) {
      expect(text).not.toContain(value);
    }
    const entry = JSON.parse(lines.at(-1)!);
    expect(Object.keys(entry).sort()).toEqual([
      'durationMs',
      'level',
      'method',
      'msg',
      'path',
      'requestId',
      'service',
      'status',
      'time',
    ]);
    expect(entry).toMatchObject({
      msg: 'request',
      method: 'POST',
      path: '/api/health',
      status: 404,
    });
  });

  it('database errors are logged without their message, detail or values', async () => {
    const { lines, logger } = capture();
    const app = express();
    app.use(requestId);
    app.get('/db-error', () => {
      throw Object.assign(
        new Error(`duplicate key value violates unique constraint; value ${SECRETS.phone}`),
        {
          name: 'DatabaseError',
          code: '23505',
          severity: 'ERROR',
          detail: `Key (phone)=(${SECRETS.phone}) already exists.`,
          table: 'patients',
          constraint: 'patients_phone_key',
          where: `SQL statement with ${SECRETS.patient}`,
        },
      );
    });
    app.use(errorHandler(logger));
    await request(app).get('/db-error');
    await settle();
    const text = lines.join('');
    expect(text).not.toContain(SECRETS.phone);
    expect(text).not.toContain(SECRETS.patient);
    const entry = JSON.parse(lines.at(-1)!);
    expect(entry.err).toMatchObject({
      type: 'DatabaseError',
      code: '23505',
      table: 'patients',
      constraint: 'patients_phone_key',
    });
    expect(entry.err).not.toHaveProperty('message');
    expect(entry.err).not.toHaveProperty('detail');
  });

  it('redacts sensitive keys at the top level and one object down', () => {
    const { lines, logger } = capture();
    logger.info(
      {
        password: 'x-pw-1',
        DATABASE_URL: 'x-url-2',
        user: { passwordHash: 'x-hash-3', email: 'x-mail-4' },
        headers: { authorization: 'x-auth-5', cookie: 'x-cookie-6' },
        patient: { firstName: 'x-first-7', phone: 'x-phone-8', dob: 'x-dob-9' },
      },
      'redaction check',
    );
    const text = lines.join('');
    for (let i = 1; i <= 9; i++) expect(text).not.toMatch(new RegExp(`x-[a-z]+-${i}"`));
    expect(text).toContain('[Redacted]');
  });

  it('the startup line names host, port and environment only', () => {
    const { lines, logger } = capture();
    logger.info({ host: '127.0.0.1', port: 3000, env: 'test' }, 'HospitalOS API listening');
    expect(Object.keys(JSON.parse(lines[0]!)).sort()).toEqual([
      'env',
      'host',
      'level',
      'msg',
      'port',
      'service',
      'time',
    ]);
  });
});
