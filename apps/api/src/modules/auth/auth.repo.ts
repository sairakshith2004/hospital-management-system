import type { PermissionCode, SessionUser } from '@hospitalos/shared';
import type { Queryable } from '../../db/client.js';

/** Five consecutive failures lock the account for 15 minutes (SE-4, ADR 0004). */
export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_DURATION = '15 minutes';

export interface LoginCandidate {
  id: string;
  passwordHash: string;
  status: string;
  locked: boolean;
}

/** username is citext, so the lookup is case-insensitive. */
export async function findLoginCandidate(
  db: Queryable,
  username: string,
): Promise<LoginCandidate | undefined> {
  const { rows } = await db.query<LoginCandidate>(
    `SELECT id, password_hash AS "passwordHash", status,
            coalesce(locked_until > now(), false) AS locked
     FROM users WHERE username = $1`,
    [username],
  );
  return rows[0];
}

/**
 * Counts one failed password in a single atomic statement. The failure that reaches
 * the threshold locks the account and resets the counter. Returns true if it locked.
 */
export async function recordFailedLogin(db: Queryable, userId: string): Promise<boolean> {
  const { rows } = await db.query<{ locked: boolean }>(
    `UPDATE users SET
       failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END,
       locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + $3::interval
                           ELSE locked_until END
     WHERE id = $1
     RETURNING coalesce(locked_until > now(), false) AS locked`,
    [userId, LOCKOUT_THRESHOLD, LOCKOUT_DURATION],
  );
  return rows[0]?.locked ?? false;
}

/** Clears the failure counter and any expired lock. Writes only if something changes. */
export async function clearFailedLogins(db: Queryable, userId: string): Promise<void> {
  await db.query(
    `UPDATE users SET failed_logins = 0, locked_until = NULL
     WHERE id = $1 AND (failed_logins <> 0 OR locked_until IS NOT NULL)`,
    [userId],
  );
}

export interface SessionUserRow extends SessionUser {
  status: string;
}

/**
 * The signed-in user with their active roles and permissions, read fresh on every
 * request so a role change or deactivation applies immediately (SE-6, AD-8).
 */
export async function findSessionUser(
  db: Queryable,
  userId: string,
): Promise<SessionUserRow | undefined> {
  const { rows } = await db.query<SessionUserRow>(
    `SELECT u.id, u.username::text AS username, e.full_name AS "fullName", u.status,
            coalesce(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}')
              AS roles,
            coalesce(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), '{}')
              AS permissions
     FROM users u
     JOIN employees e ON e.id = u.employee_id
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id AND r.active
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
     LEFT JOIN permissions p ON p.id = rp.permission_id
     WHERE u.id = $1
     GROUP BY u.id, e.full_name`,
    [userId],
  );
  const row = rows[0];
  if (!row) return undefined;
  return { ...row, permissions: row.permissions as PermissionCode[] };
}
