import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./run-reset-password.ts', import.meta.url));
const TSX = fileURLToPath(new URL('../../../../../node_modules/.bin/tsx', import.meta.url));

/** Runs the script with piped (non-terminal) stdin, as a script or CI job would. */
function run(env: Record<string, string>, input = 'Synthetic-Passw0rd-123\n') {
  return spawnSync(TSX, [SCRIPT, '--username', 'zz_admin'], {
    input,
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });
}

describe('db:reset-password command line', () => {
  it('refuses when stdin is not an interactive terminal (no piped passwords)', () => {
    const result = run({ NODE_ENV: 'development' });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/interactive terminal/);
    expect(result.stdout + result.stderr).not.toContain('Synthetic-Passw0rd-123');
  });

  it('refuses in production', () => {
    const result = run({ NODE_ENV: 'production' });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/development only/);
  });
});
