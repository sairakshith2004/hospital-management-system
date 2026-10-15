import { describe, expect, it } from 'vitest';
import {
  DbConfigError,
  adminUrl,
  appUrl,
  checkVar,
  describeTarget,
  migrationUrl,
  parseMode,
} from './db-env.js';

const SECRET = 'S3cretValue';
const url = (user: string, db: string, host = '127.0.0.1') =>
  `postgres://${user}:${SECRET}@${host}:5432/${db}`;

const env = {
  ADMIN_DATABASE_URL: url('hms', 'hms_dev'),
  MIGRATION_DATABASE_URL: url('hms_owner', 'hms_dev'),
  TEST_MIGRATION_DATABASE_URL: url('hms_owner', 'hms_test'),
  DATABASE_URL: url('hms_app', 'hms_dev'),
  TEST_DATABASE_URL: url('hms_app', 'hms_test'),
};

describe('database target guards', () => {
  it('accepts each role on its expected database', () => {
    expect(databaseTargets()).toEqual([
      'hms@127.0.0.1:5432/hms_dev',
      'hms_owner@127.0.0.1:5432/hms_dev',
      'hms_owner@127.0.0.1:5432/hms_test',
      'hms_app@127.0.0.1:5432/hms_dev',
      'hms_app@127.0.0.1:5432/hms_test',
    ]);
  });

  it('rejects a migration URL pointing at the wrong database', () => {
    const bad = { ...env, MIGRATION_DATABASE_URL: url('hms_owner', 'hms_test') };
    expect(() => migrationUrl('dev', bad)).toThrow(
      'MIGRATION_DATABASE_URL must connect as hms_owner to hms_dev.',
    );
  });

  it('rejects a test migration URL pointing at the development database', () => {
    const bad = { ...env, TEST_MIGRATION_DATABASE_URL: url('hms_owner', 'hms_dev') };
    expect(() => migrationUrl('test', bad)).toThrow(DbConfigError);
  });

  it('rejects the superuser in place of the owner or application role', () => {
    expect(() =>
      migrationUrl('dev', { ...env, MIGRATION_DATABASE_URL: url('hms', 'hms_dev') }),
    ).toThrow(DbConfigError);
    expect(() => appUrl('dev', { ...env, DATABASE_URL: url('hms', 'hms_dev') })).toThrow(
      'DATABASE_URL must connect as hms_app to hms_dev.',
    );
  });

  it('names a missing variable', () => {
    expect(() => appUrl('test', {})).toThrow('TEST_DATABASE_URL is not set.');
  });

  it('rejects an admin URL that is not on this machine', () => {
    const remote = { ...env, ADMIN_DATABASE_URL: url('hms', 'hms_dev', 'db.example.com') };
    expect(() => adminUrl(remote)).toThrow('must point at 127.0.0.1 or localhost');
  });

  it('accepts only the dev and test modes', () => {
    expect(parseMode('test')).toBe('test');
    expect(() => parseMode('production')).toThrow(DbConfigError);
    expect(() => parseMode(undefined)).toThrow(DbConfigError);
  });

  it('never includes the password in errors, descriptions or checks', () => {
    const bad = {
      ADMIN_DATABASE_URL: url('hms', 'hms_dev', 'remote.example.com'),
      MIGRATION_DATABASE_URL: url('hms', 'hms_dev'),
      TEST_MIGRATION_DATABASE_URL: `not a url ${SECRET}`,
      DATABASE_URL: url('hms_app', 'hms_test'),
      TEST_DATABASE_URL: `mysql://u:${SECRET}@h/db`,
    };
    const outputs = [
      ...(Object.keys(bad) as (keyof typeof bad)[]).map((name) => checkVar(name, bad)),
      describeTarget(new URL(env.DATABASE_URL)),
    ];
    for (const output of outputs) expect(output).not.toContain(SECRET);
    expect(outputs.slice(0, 5).every((o) => o.startsWith('invalid: '))).toBe(true);
  });

  it('reports a fully configured environment as set', () => {
    const names = Object.keys(env) as (keyof typeof env)[];
    expect(names.map((name) => checkVar(name, env))).toEqual(names.map(() => 'set'));
  });
});

function databaseTargets(): string[] {
  return [
    adminUrl(env),
    migrationUrl('dev', env),
    migrationUrl('test', env),
    appUrl('dev', env),
    appUrl('test', env),
  ].map(describeTarget);
}

describe('test database targets', () => {
  const withVar = (name: string, value: string) => ({ ...env, [name]: value });

  /** The DbConfigError message thrown by `run`; fails the test if nothing is thrown. */
  function messageOf(run: () => unknown): string {
    try {
      run();
    } catch (err) {
      expect(err).toBeInstanceOf(DbConfigError);
      return (err as Error).message;
    }
    throw new Error('expected a DbConfigError');
  }

  it.each(['127.0.0.1', 'localhost'])('accepts %s:5432 for both test variables', (host) => {
    const e = {
      ...env,
      TEST_DATABASE_URL: url('hms_app', 'hms_test', host),
      TEST_MIGRATION_DATABASE_URL: url('hms_owner', 'hms_test', host),
    };
    expect(describeTarget(appUrl('test', e))).toBe(`hms_app@${host}:5432/hms_test`);
    expect(describeTarget(migrationUrl('test', e))).toBe(`hms_owner@${host}:5432/hms_test`);
  });

  it.each([
    [
      'a remote host',
      `postgres://hms_app:${SECRET}@db.example.com:5432/hms_test`,
      'must point at 127.0.0.1:5432',
    ],
    [
      'a private-network host',
      `postgres://hms_app:${SECRET}@10.0.0.5:5432/hms_test`,
      'must point at 127.0.0.1:5432',
    ],
    [
      'another port',
      `postgres://hms_app:${SECRET}@127.0.0.1:5433/hms_test`,
      'must point at 127.0.0.1:5432',
    ],
    [
      'no port (PGPORT could redirect it)',
      `postgres://hms_app:${SECRET}@127.0.0.1/hms_test`,
      'must point at 127.0.0.1:5432',
    ],
    [
      'a host override in the query',
      `postgres://hms_app:${SECRET}@127.0.0.1:5432/hms_test?host=db.example.com`,
      'must not have query parameters',
    ],
    [
      'the development database',
      `postgres://hms_app:${SECRET}@127.0.0.1:5432/hms_dev`,
      'must connect as hms_app to hms_test',
    ],
  ])('rejects %s for TEST_DATABASE_URL without revealing it', (_label, value, rule) => {
    const message = messageOf(() => appUrl('test', withVar('TEST_DATABASE_URL', value)));
    expect(message).toContain(rule);
    expect(message).not.toContain(SECRET);
    expect(checkVar('TEST_DATABASE_URL', withVar('TEST_DATABASE_URL', value))).not.toContain(
      SECRET,
    );
  });

  it('applies the same rules to TEST_MIGRATION_DATABASE_URL', () => {
    const remote = `postgres://hms_owner:${SECRET}@db.example.com:5432/hms_test`;
    const message = messageOf(() =>
      migrationUrl('test', withVar('TEST_MIGRATION_DATABASE_URL', remote)),
    );
    expect(message).toBe(
      'TEST_MIGRATION_DATABASE_URL must point at 127.0.0.1:5432 or localhost:5432.',
    );
    expect(message).not.toContain(SECRET);
  });
});
