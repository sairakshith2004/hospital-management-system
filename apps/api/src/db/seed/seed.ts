/**
 * Reference data that authorization depends on: the settings row, permissions,
 * the 11 system roles and their permissions (from packages/shared). Synthetic only.
 *
 * Runs inside the caller's transaction, so the db:seed script commits it and the
 * database tests roll it back. Idempotent; never deletes or overwrites settings.
 */
import type pg from 'pg';
import { PERMISSIONS, ROLE_CODES, ROLE_NAMES, ROLE_PERMISSIONS } from '@hospitalos/shared';

export const DEMO_HOSPITAL_NAME = 'HospitalOS Demo Hospital';
// Arbitrary constant shared by every seed run; different from the migration lock.
const SEED_LOCK_KEY = 4_200_402;

export interface UpsertCounts {
  inserted: number;
  updated: number;
  unchanged: number;
}

export interface SeedResult {
  settings: 'inserted' | 'unchanged';
  permissions: UpsertCounts;
  roles: UpsertCounts;
  rolePermissions: { inserted: number; unchanged: number };
  audited: boolean;
}

/** The database grants a system role something the code doesn't. Nothing is changed. */
export class SeedDriftError extends Error {
  override name = 'SeedDriftError';
}

const PAIRS = ROLE_CODES.flatMap((role) => ROLE_PERMISSIONS[role].map((code) => [role, code]));

function counts(rows: { inserted: boolean }[], total: number): UpsertCounts {
  const inserted = rows.filter((r) => r.inserted).length;
  return { inserted, updated: rows.length - inserted, unchanged: total - rows.length };
}

export async function seedReferenceData(client: pg.ClientBase): Promise<SeedResult> {
  await client.query('SELECT pg_advisory_xact_lock($1)', [SEED_LOCK_KEY]);
  await assertNoDrift(client);

  const settings = await client.query(
    'INSERT INTO hospital_settings (id, name) VALUES (1, $1) ON CONFLICT (id) DO NOTHING RETURNING id',
    [DEMO_HOSPITAL_NAME],
  );

  const permissions = await client.query<{ inserted: boolean }>(
    `INSERT INTO permissions (code, description)
     SELECT * FROM unnest($1::text[], $2::text[])
     ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description
       WHERE permissions.description IS DISTINCT FROM EXCLUDED.description
     RETURNING (xmax = 0) AS inserted`,
    [PERMISSIONS.map((p) => p.code), PERMISSIONS.map((p) => p.description)],
  );

  const roles = await client.query<{ inserted: boolean }>(
    `INSERT INTO roles (code, name, is_system)
     SELECT code, name, true FROM unnest($1::text[], $2::text[]) AS t(code, name)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_system = true
       WHERE roles.name IS DISTINCT FROM EXCLUDED.name OR NOT roles.is_system
     RETURNING (xmax = 0) AS inserted`,
    [[...ROLE_CODES], ROLE_CODES.map((r) => ROLE_NAMES[r])],
  );

  const rolePermissions = await client.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT r.id, p.id
     FROM unnest($1::text[], $2::text[]) AS t(role_code, permission_code)
     JOIN roles r ON r.code = t.role_code
     JOIN permissions p ON p.code = t.permission_code
     ON CONFLICT DO NOTHING
     RETURNING 1`,
    [PAIRS.map(([role]) => role), PAIRS.map(([, code]) => code)],
  );

  const result: SeedResult = {
    settings: settings.rowCount ? 'inserted' : 'unchanged',
    permissions: counts(permissions.rows, PERMISSIONS.length),
    roles: counts(roles.rows, ROLE_CODES.length),
    rolePermissions: {
      inserted: rolePermissions.rowCount ?? 0,
      unchanged: PAIRS.length - (rolePermissions.rowCount ?? 0),
    },
    audited: false,
  };

  const changed =
    result.settings === 'inserted' ||
    result.permissions.inserted + result.permissions.updated > 0 ||
    result.roles.inserted + result.roles.updated > 0 ||
    result.rolePermissions.inserted > 0;
  if (changed) {
    const summary = {
      settings: result.settings,
      permissions: result.permissions,
      roles: result.roles,
      rolePermissions: result.rolePermissions,
    };
    await client.query(
      `INSERT INTO audit_logs (actor_type, action, entity_type, changes)
       VALUES ('system', 'seed.applied', 'reference_data', $1::jsonb)`,
      [JSON.stringify(summary)],
    );
    result.audited = true;
  }
  return result;
}

/** Fails, listing role:permission pairs, if the database grants more than the code does. */
async function assertNoDrift(client: pg.ClientBase): Promise<void> {
  const extraPermissions = await client.query<{ code: string }>(
    'SELECT code FROM permissions WHERE code <> ALL($1::text[]) ORDER BY code',
    [PERMISSIONS.map((p) => p.code)],
  );
  const extraGrants = await client.query<{ pair: string }>(
    `SELECT r.code || ' ' || p.code AS pair
     FROM role_permissions rp
     JOIN roles r ON r.id = rp.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE r.is_system
       AND (r.code, p.code) NOT IN (SELECT * FROM unnest($1::text[], $2::text[]))
     ORDER BY 1`,
    [PAIRS.map(([role]) => role), PAIRS.map(([, code]) => code)],
  );
  const problems = [
    ...extraPermissions.rows.map((r) => `unknown permission ${r.code}`),
    ...extraGrants.rows.map((r) => `system role grants ${r.pair}`),
  ];
  if (problems.length > 0) {
    throw new SeedDriftError(
      `The database differs from packages/shared; nothing was changed: ${problems.join('; ')}.`,
    );
  }
}
