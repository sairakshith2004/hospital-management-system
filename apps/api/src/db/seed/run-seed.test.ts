import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./run-seed.ts', import.meta.url));
const TSX = fileURLToPath(new URL('../../../../../node_modules/.bin/tsx', import.meta.url));

// No database is reachable here: each case must be refused before connecting.
const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(TSX, [SCRIPT, ...args], {
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });

describe('db:seed command line', () => {
  it('refuses a missing or unrecognised target', () => {
    for (const args of [[], ['staging'], ['hms_dev'], ['DEV']]) {
      const result = run(args);
      expect(result.status, args.join(' ')).toBe(1);
      expect(result.stderr).toMatch(/Database mode must be "dev" or "test"/);
    }
  });

  it('refuses a dev seed whose URL names another database or role', () => {
    for (const target of [
      'hms_owner:pw@127.0.0.1:5432/hms_test',
      'hms_app:pw@127.0.0.1:5432/hms_dev',
    ]) {
      const result = run(['dev'], { MIGRATION_DATABASE_URL: `postgres://${target}` });
      expect(result.status, target).toBe(1);
      expect(result.stderr).toMatch(/MIGRATION_DATABASE_URL must connect as hms_owner to hms_dev/);
      expect(result.stdout + result.stderr).not.toContain(':pw@');
    }
  });

  it('refuses when the URL is not set', () => {
    const result = run(['dev']);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/MIGRATION_DATABASE_URL is not set/);
  });
});
