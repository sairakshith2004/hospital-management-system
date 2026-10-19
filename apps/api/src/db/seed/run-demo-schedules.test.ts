import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./run-demo-schedules.ts', import.meta.url));
const TSX = fileURLToPath(new URL('../../../../../node_modules/.bin/tsx', import.meta.url));

// No database is reachable here: each case must be refused before connecting.
const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(TSX, [SCRIPT, ...args], {
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });

describe('db:seed:demo:schedules command line', () => {
  it('refuses in production', () => {
    const result = run(['dev'], { NODE_ENV: 'production' });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/development only/);
  });

  it('refuses unless explicitly run for dev', () => {
    for (const args of [[], ['test'], ['hms_dev'], ['dev', 'extra']]) {
      const result = run(args);
      expect(result.status, args.join(' ')).toBe(1);
      expect(result.stderr).toMatch(/only targets hms_dev/);
    }
  });

  it('refuses a DATABASE_URL for another database or role, or none', () => {
    for (const target of [
      'hms_app:pw@127.0.0.1:5432/hms_test',
      'hms_owner:pw@127.0.0.1:5432/hms_dev',
    ]) {
      const result = run(['dev'], { DATABASE_URL: `postgres://${target}` });
      expect(result.status, target).toBe(1);
      expect(result.stderr).toMatch(/DATABASE_URL must connect as hms_app to hms_dev/);
      expect(result.stdout + result.stderr).not.toContain(':pw@');
    }
    const missing = run(['dev']);
    expect(missing.stderr).toMatch(/DATABASE_URL is not set/);
  });
});
