import { PERMISSIONS, ROLE_CODES, ROLE_PERMISSIONS } from '@hospitalos/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SeedDriftError, seedReferenceData } from './seed/seed.js';
import { connectTest, inRollback } from './test-db.js';

const PAIR_COUNT = ROLE_CODES.reduce((n, role) => n + ROLE_PERMISSIONS[role].length, 0);

let owner!: pg.Client;
beforeAll(async () => {
  owner = await connectTest('owner');
});
afterAll(async () => {
  await owner?.end();
});

describe('seedReferenceData (every test rolled back)', () => {
  it('creates the settings row, all permissions, the 11 system roles and their grants', () =>
    inRollback(owner, async () => {
      await seedReferenceData(owner);
      const { rows } = await owner.query(
        `SELECT (SELECT count(*)::int FROM hospital_settings) AS settings,
                (SELECT count(*)::int FROM permissions) AS permissions,
                (SELECT count(*)::int FROM roles WHERE is_system) AS roles,
                (SELECT count(*)::int FROM role_permissions rp
                   JOIN roles r ON r.id = rp.role_id WHERE r.is_system) AS grants`,
      );
      expect(rows[0]).toEqual({
        settings: 1,
        permissions: PERMISSIONS.length,
        roles: 11,
        grants: PAIR_COUNT,
      });
    }));

  it('grants each system role exactly its permissions from packages/shared', () =>
    inRollback(owner, async () => {
      await seedReferenceData(owner);
      const { rows } = await owner.query<{ role: string; codes: string[] }>(
        `SELECT r.code AS role, array_agg(p.code ORDER BY p.code COLLATE "C") AS codes
         FROM roles r
         JOIN role_permissions rp ON rp.role_id = r.id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE r.is_system
         GROUP BY r.code`,
      );
      expect(Object.fromEntries(rows.map((r) => [r.role, r.codes]))).toEqual(
        Object.fromEntries(ROLE_CODES.map((role) => [role, [...ROLE_PERMISSIONS[role]].sort()])),
      );
    }));

  it('is idempotent: a second run changes nothing and writes no audit row', () =>
    inRollback(owner, async () => {
      await seedReferenceData(owner);
      expect(await seedReferenceData(owner)).toEqual({
        settings: 'unchanged',
        permissions: { inserted: 0, updated: 0, unchanged: PERMISSIONS.length },
        roles: { inserted: 0, updated: 0, unchanged: 11 },
        rolePermissions: { inserted: 0, unchanged: PAIR_COUNT },
        audited: false,
      });
    }));

  it('adds newly introduced permissions and their grants to an already-seeded database', () =>
    inRollback(owner, async () => {
      await seedReferenceData(owner);
      // The database as it was before Day 3 Phase 3B: without the two scheduling permissions.
      const NEW = ['appointment:reschedule', 'appointment:read_all'];
      await owner.query(
        `DELETE FROM role_permissions WHERE permission_id IN
           (SELECT id FROM permissions WHERE code = ANY($1::text[]))`,
        [NEW],
      );
      await owner.query('DELETE FROM permissions WHERE code = ANY($1::text[])', [NEW]);
      const result = await seedReferenceData(owner);
      expect(result).toEqual({
        settings: 'unchanged',
        permissions: { inserted: 2, updated: 0, unchanged: PERMISSIONS.length - 2 },
        roles: { inserted: 0, updated: 0, unchanged: 11 },
        rolePermissions: { inserted: 5, unchanged: PAIR_COUNT - 5 },
        audited: true,
      });
      const { rows } = await owner.query<{ pair: string }>(
        `SELECT r.code || ' ' || p.code AS pair FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
         WHERE p.code = ANY($1::text[]) ORDER BY 1`,
        [NEW],
      );
      expect(rows.map((r) => r.pair)).toEqual([
        'ADM appointment:read_all',
        'REC appointment:read_all',
        'REC appointment:reschedule',
        'SA appointment:read_all', // the Super Admin oversees everything (permissions.md note 13)
        'SA appointment:reschedule',
      ]);
    }));

  it('writes one system audit row, with counts only, when it changes something', () =>
    inRollback(owner, async () => {
      await seedReferenceData(owner);
      await owner.query("UPDATE permissions SET description = 'stale' WHERE code = 'audit:read'");
      const result = await seedReferenceData(owner);
      expect(result.permissions.updated).toBe(1);
      expect(result.audited).toBe(true);
      const { rows } = await owner.query(
        `SELECT actor_type, actor_user_id, changes FROM audit_logs
         WHERE action = 'seed.applied' ORDER BY id DESC LIMIT 1`,
      );
      expect(rows[0]).toMatchObject({ actor_type: 'system', actor_user_id: null });
      expect(JSON.stringify(rows[0].changes)).not.toContain('stale');
    }));

  it('never overwrites settings changed after seeding', () =>
    inRollback(owner, async () => {
      await seedReferenceData(owner);
      await owner.query('UPDATE hospital_settings SET discount_limit_bp = 500');
      await seedReferenceData(owner);
      const { rows } = await owner.query('SELECT discount_limit_bp FROM hospital_settings');
      expect(rows[0]).toEqual({ discount_limit_bp: 500 });
    }));

  it('refuses to run, naming the difference, when a system role holds an extra permission', () =>
    inRollback(owner, async () => {
      await seedReferenceData(owner);
      await owner.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT r.id, p.id FROM roles r, permissions p
         WHERE r.code = 'MKT' AND p.code = 'audit:read'`,
      );
      const run = seedReferenceData(owner);
      await expect(run).rejects.toThrow(SeedDriftError);
      await expect(run).rejects.toThrow('system role grants MKT audit:read');
    }));
});
