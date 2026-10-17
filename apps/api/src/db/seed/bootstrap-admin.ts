/**
 * Creates the first system administrator (SA). One time only: it refuses whenever any
 * user already holds the SA role, active or not, so it can never create a second
 * administrator or reset an existing one. Runs inside the caller's transaction, as
 * hms_app, whose existing grants cover every insert here.
 */
import type { Queryable } from '../client.js';
import { SYSTEM, recordAudit } from '../../lib/audit.js';

// Arbitrary constant; different from the migration (…401) and seed (…402) locks.
const BOOTSTRAP_LOCK_KEY = 4_200_403;

export const USERNAME_PATTERN = /^[a-z][a-z0-9._-]{2,49}$/;

export class BootstrapError extends Error {
  override name = 'BootstrapError';
}

export interface BootstrapInput {
  username: string;
  /** Already hashed; the plain password never reaches this function. */
  passwordHash: string;
}

async function one<T extends Record<string, unknown>>(
  db: Queryable,
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  return (await db.query<T>(sql, params)).rows[0];
}

export async function bootstrapAdmin(
  db: Queryable,
  { username, passwordHash }: BootstrapInput,
): Promise<{ userId: string }> {
  if (!USERNAME_PATTERN.test(username)) {
    throw new BootstrapError(
      'Username must be 3–50 characters: lower-case letters, digits, dot, dash or underscore, starting with a letter.',
    );
  }
  await db.query('SELECT pg_advisory_xact_lock($1)', [BOOTSTRAP_LOCK_KEY]);

  const role = await one<{ id: string }>(db, "SELECT id FROM roles WHERE code = 'SA'");
  if (!role) throw new BootstrapError('The SA role is missing. Run the reference-data seed first.');

  const holders = await one<{ n: number }>(
    db,
    'SELECT count(*)::int AS n FROM user_roles WHERE role_id = $1',
    [role.id],
  );
  if ((holders?.n ?? 0) > 0) {
    throw new BootstrapError(
      'An administrator already exists. Bootstrap refused; nothing was changed.',
    );
  }
  if (await one(db, 'SELECT 1 FROM users WHERE username = $1', [username])) {
    throw new BootstrapError('That username is already taken. Nothing was changed.');
  }

  await db.query(
    `INSERT INTO departments (code, name) VALUES ('ADMIN', 'Administration')
     ON CONFLICT (code) DO NOTHING`,
  );
  const department = await one<{ id: string }>(
    db,
    "SELECT id FROM departments WHERE code = 'ADMIN'",
  );
  const employee = await one<{ id: string }>(
    db,
    `INSERT INTO employees (employee_no, full_name, department_id, designation)
     VALUES ('SA-0001', 'System Administrator', $1, 'System Administrator') RETURNING id`,
    [department!.id],
  );
  const user = await one<{ id: string }>(
    db,
    'INSERT INTO users (employee_id, username, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [employee!.id, username, passwordHash],
  );
  await db.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [user!.id, role.id]);
  await recordAudit(
    db,
    {
      actor: SYSTEM,
      action: 'user.created',
      entityType: 'user',
      entityId: user!.id,
      reason: 'bootstrap',
      changes: { roles: ['SA'] },
    },
    { requestId: null, ip: null },
  );
  return { userId: user!.id };
}
