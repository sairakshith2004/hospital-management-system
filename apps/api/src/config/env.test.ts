import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv } from './env.js';

// Synthetic test values only.
const SECRET = 'a'.repeat(64);
const valid = {
  DATABASE_URL: 'postgres://user:pw@127.0.0.1:5432/hms_dev',
  SESSION_SECRET: SECRET,
};

describe('loadEnv', () => {
  it('accepts a valid configuration and applies defaults', () => {
    expect(loadEnv(valid)).toEqual({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3000,
      DATABASE_URL: valid.DATABASE_URL,
      LOG_LEVEL: 'info',
      SESSION_SECRET: SECRET,
      TRUST_PROXY: false,
      MAIL_FROM: 'HospitalOS <no-reply@hospitalos.local>',
      APP_URL: 'http://127.0.0.1:5173',
    });
  });

  it('accepts an SMTP URL for reset emails, and refuses other schemes', () => {
    expect(loadEnv({ ...valid, SMTP_URL: 'smtp://127.0.0.1:1025' }).SMTP_URL).toBe(
      'smtp://127.0.0.1:1025',
    );
    expect(() => loadEnv({ ...valid, SMTP_URL: 'http://mail.example' })).toThrow('SMTP_URL');
  });

  it('accepts LiveKit settings only all together', () => {
    const lk = {
      LIVEKIT_URL: 'ws://127.0.0.1:7880',
      LIVEKIT_API_KEY: 'zzkey',
      LIVEKIT_API_SECRET: 'b'.repeat(40),
    };
    expect(loadEnv({ ...valid, ...lk }).LIVEKIT_URL).toBe(lk.LIVEKIT_URL);
    expect(() => loadEnv({ ...valid, LIVEKIT_URL: lk.LIVEKIT_URL })).toThrow('LIVEKIT_URL');
    expect(() => loadEnv({ ...valid, ...lk, LIVEKIT_API_SECRET: 'short' })).toThrow(
      'LIVEKIT_API_SECRET',
    );
    expect(() => loadEnv({ ...valid, ...lk, LIVEKIT_URL: 'http://127.0.0.1:7880' })).toThrow(
      'LIVEKIT_URL',
    );
  });

  it('accepts an explicit log level', () => {
    expect(loadEnv({ ...valid, LOG_LEVEL: 'debug' }).LOG_LEVEL).toBe('debug');
  });

  it('coerces PORT from a string', () => {
    expect(loadEnv({ ...valid, PORT: '4000' }).PORT).toBe(4000);
  });

  it.each([
    ['false', false],
    ['1', 1],
    ['3', 3],
  ])('accepts TRUST_PROXY=%s', (value, expected) => {
    expect(loadEnv({ ...valid, TRUST_PROXY: value }).TRUST_PROXY).toBe(expected);
  });

  it.each([
    ['missing DATABASE_URL', { SESSION_SECRET: SECRET }, 'DATABASE_URL'],
    ['non-Postgres DATABASE_URL', { ...valid, DATABASE_URL: 'mysql://u:p@h/db' }, 'DATABASE_URL'],
    ['non-numeric PORT', { ...valid, PORT: 'abc' }, 'PORT'],
    ['out-of-range PORT', { ...valid, PORT: '70000' }, 'PORT'],
    ['unknown NODE_ENV', { ...valid, NODE_ENV: 'staging' }, 'NODE_ENV'],
    ['unknown LOG_LEVEL', { ...valid, LOG_LEVEL: 'verbose' }, 'LOG_LEVEL'],
    ['missing SESSION_SECRET', { DATABASE_URL: valid.DATABASE_URL }, 'SESSION_SECRET'],
    ['short SESSION_SECRET', { ...valid, SESSION_SECRET: 'x'.repeat(31) }, 'SESSION_SECRET'],
    [
      'placeholder SESSION_SECRET',
      { ...valid, SESSION_SECRET: `CHANGE_ME_SESSION${'x'.repeat(32)}` },
      'SESSION_SECRET',
    ],
    ['TRUST_PROXY=true', { ...valid, TRUST_PROXY: 'true' }, 'TRUST_PROXY'],
    ['TRUST_PROXY=4', { ...valid, TRUST_PROXY: '4' }, 'TRUST_PROXY'],
  ])('rejects %s', (_label, source, variable) => {
    expect(() => loadEnv(source)).toThrow(EnvError);
    expect(() => loadEnv(source)).toThrow(variable);
  });

  it.each([
    ['DATABASE_URL', { ...valid, DATABASE_URL: 'not a url SuperSecret123' }],
    ['SESSION_SECRET', { ...valid, SESSION_SECRET: 'SuperSecret123' }],
  ])('never includes the offending %s value in the error', (_name, source) => {
    try {
      loadEnv(source);
      expect.unreachable();
    } catch (err) {
      expect(String((err as Error).message)).not.toContain('SuperSecret123');
    }
  });
});
