/**
 * Self sign-up for new staff. Creates an employee record and a login that is disabled and
 * marked pending_approval, with no roles: it can't sign in until an administrator approves
 * it (Staff page), and it has no access until the Super Admin assigns a role. Employee
 * numbers are SU-00001, SU-00002, … One audit row per sign-up; only the password hash is kept.
 */
import type { SignupInput } from '@hospitalos/shared';
import { withTransaction, type Database } from '../../db/client.js';
import { SYSTEM, recordAudit, type AuditContext } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';

const LOCK = 4_200_410;

export async function signUp(
  db: Database,
  input: SignupInput,
  context: AuditContext,
): Promise<{ userId: string }> {
  // Hash outside the transaction: it is deliberately slow.
  const passwordHash = await hashPassword(input.password);
  return withTransaction(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
    const dept = await tx.query<{ code: string }>(
      'SELECT code FROM departments WHERE id = $1 AND active',
      [input.departmentId],
    );
    if (!dept.rows[0]) throw new AppError(422, 'UNKNOWN_DEPARTMENT', 'Choose your department.');
    const taken = await tx.query('SELECT 1 FROM users WHERE username = $1', [input.username]);
    if (taken.rowCount)
      throw new AppError(409, 'USERNAME_TAKEN', 'That username is already taken. Try another.');
    const { rows: no } = await tx.query<{ no: string }>(
      `SELECT 'SU-' || lpad((coalesce(max(substring(employee_no FROM 4)::int), 0) + 1)::text, 5, '0') AS no
         FROM employees WHERE employee_no ~ '^SU-[0-9]+$'`,
    );
    const { rows: emp } = await tx.query<{ id: string }>(
      `INSERT INTO employees (employee_no, full_name, department_id, designation)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [no[0]!.no, input.fullName, input.departmentId, input.designation],
    );
    const { rows: user } = await tx.query<{ id: string }>(
      `INSERT INTO users (employee_id, username, password_hash, status, pending_approval)
       VALUES ($1, $2, $3, 'disabled', true) RETURNING id`,
      [emp[0]!.id, input.username, passwordHash],
    );
    await recordAudit(
      tx,
      {
        actor: SYSTEM,
        action: 'user.signed_up',
        entityType: 'user',
        entityId: user[0]!.id,
        changes: { department: dept.rows[0].code, employeeNo: no[0]!.no },
      },
      context,
    );
    return { userId: user[0]!.id };
  });
}

/** Departments a new member of staff can choose: names only, no other data. */
export async function signupDepartments(db: Database) {
  const { rows } = await db.query<{ id: string; name: string }>(
    'SELECT id, name FROM departments WHERE active ORDER BY name',
  );
  return rows;
}
