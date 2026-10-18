import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./run-demo-formulary.ts', import.meta.url));
const TSX = fileURLToPath(new URL('../../../../../node_modules/.bin/tsx', import.meta.url));
const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(TSX, [SCRIPT, ...args], {
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });

describe('db:seed:demo:formulary command line', () => {
  it('refuses in production, without "dev", or with a non-dev URL', () => {
    expect(run(['dev'], { NODE_ENV: 'production' }).stderr).toMatch(/development only/);
    for (const args of [[], ['test'], ['dev', 'x']])
      expect(run(args).stderr).toMatch(/only targets hms_dev/);
    const wrong = run(['dev'], { DATABASE_URL: 'postgres://hms_app:pw@127.0.0.1:5432/hms_test' });
    expect(wrong.stderr).toMatch(/DATABASE_URL must connect as hms_app to hms_dev/);
    expect(wrong.stdout + wrong.stderr).not.toContain(':pw@');
  });
});
