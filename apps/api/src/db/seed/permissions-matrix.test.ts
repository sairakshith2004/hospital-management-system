// Checks packages/shared's permission map against docs/permissions.md. It lives in the API
// (which has Node types) because packages/shared is also compiled for the browser.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_CODES, ROLE_NAMES, ROLE_PERMISSIONS } from '@hospitalos/shared';

/** The matrix in docs/permissions.md §2, read as { permission code → roles holding it }. */
function matrixFromDocs(): Map<string, string[]> {
  const doc = readFileSync(new URL('../../../../../docs/permissions.md', import.meta.url), 'utf8');
  const section = doc.split('## 2. Matrix')[1]?.split('Notes:')[0] ?? '';
  const lines = section.split('\n');
  const header = lines.find((l) => l.startsWith('| Permission |')) ?? '';
  const roles = header
    .split('|')
    .slice(2, -1)
    .map((c) => c.trim());
  const matrix = new Map<string, string[]>();
  for (const line of lines) {
    const match = /^\| ([a-z_]+:[^|]+?) \|(.*)\|$/.exec(line);
    if (!match) continue;
    const cells = match[2]!.split('|').map((c) => c.trim());
    const holders = roles.filter((_, i) => cells[i] !== '');
    for (const code of match[1]!.match(/\b[a-z_]+:[a-z_]+\b/g) ?? []) matrix.set(code, holders);
  }
  return matrix;
}

describe('permissions', () => {
  const matrix = matrixFromDocs();
  const codes = PERMISSIONS.map((p) => p.code);

  it('lists exactly the matrix permissions, in matrix order, once each', () => {
    expect(codes).toEqual([...matrix.keys()]);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('uses the area:action format and gives every permission a description', () => {
    for (const { code, description } of PERMISSIONS) {
      expect(code).toMatch(/^[a-z_]+:[a-z_]+$/);
      expect(description.trim()).not.toBe('');
    }
  });

  it('grants each role exactly the permissions marked for it in the matrix', () => {
    for (const role of ROLE_CODES) {
      const fromDocs = codes.filter((code) => matrix.get(code)?.includes(role));
      expect(ROLE_PERMISSIONS[role], role).toEqual(fromDocs);
    }
  });

  it('names all 11 roles and gives every role leave:request', () => {
    expect(Object.keys(ROLE_NAMES)).toEqual([...ROLE_CODES]);
    for (const role of ROLE_CODES) expect(ROLE_PERMISSIONS[role]).toContain('leave:request');
  });
});
