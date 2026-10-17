import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./run-demo-seed.ts', import.meta.url));
const TSX = fileURLToPath(new URL('../../../../../node_modules/.bin/tsx', import.meta.url));

const run = (env: Record<string, string>) =>
  spawnSync(TSX, [SCRIPT], {
    input: 'Synthetic-Passw0rd-123\n',
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });

describe('db:seed:demo command line', () => {
  it('refuses without an interactive terminal', () => {
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
