import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv } from './env.js';

const valid = { DATABASE_URL: 'postgres://user:pw@127.0.0.1:5432/hms_dev' };

describe('loadEnv', () => {
  it('accepts a valid configuration and applies defaults', () => {
    expect(loadEnv(valid)).toEqual({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3000,
      DATABASE_URL: valid.DATABASE_URL,
    });
  });

  it('coerces PORT from a string', () => {
    expect(loadEnv({ ...valid, PORT: '4000' }).PORT).toBe(4000);
  });

  it.each([
    ['missing DATABASE_URL', {}, 'DATABASE_URL'],
    ['non-Postgres DATABASE_URL', { DATABASE_URL: 'mysql://u:p@h/db' }, 'DATABASE_URL'],
    ['non-numeric PORT', { ...valid, PORT: 'abc' }, 'PORT'],
    ['out-of-range PORT', { ...valid, PORT: '70000' }, 'PORT'],
    ['unknown NODE_ENV', { ...valid, NODE_ENV: 'staging' }, 'NODE_ENV'],
  ])('rejects %s', (_label, source, variable) => {
    expect(() => loadEnv(source)).toThrow(EnvError);
    expect(() => loadEnv(source)).toThrow(variable);
  });

  it('never includes the offending value in the error', () => {
    const secret = 'SuperSecret123';
    try {
      loadEnv({ DATABASE_URL: `not a url ${secret}` });
      expect.unreachable();
    } catch (err) {
      expect(String((err as Error).message)).not.toContain(secret);
    }
  });
});
