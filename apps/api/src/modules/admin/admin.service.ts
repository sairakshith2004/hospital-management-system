/**
 * Staff accounts and role assignment (docs/permissions.md note 1):
 *   - nobody changes their own status or roles;
 *   - HR (user:create) adds new staff and creates their logins; there is no self sign-up;
 *   - ADM (user:manage) disables, re-enables and resets passwords, but never on SA accounts;
 *   - only user_role:assign (SA) grants or revokes roles, and the last active SA can't be
 *     removed or disabled;
 *   - a new account has no roles until one is assigned;
 *   - disabling an account or resetting its password ends its sessions.
 * Every change is audited with a reason; role changes record the role code.
 */
import { ROLE_CODES, SETTINGS, type PermissionCode } from '@hospitalos/shared';
import { withTransaction, type Database, type Queryable } from '../../db/client.js';
import { recordAudit, type AuditContext } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';

export interface Actor {
  userId: string;
  can(permission: PermissionCode): boolean;
}

const forbidden = () => new AppError(403, 'FORBIDDEN', 'You do not have permission to do this');
const pg = (err: unknown) => (err ?? {}) as { code?: string; constraint?: string };

async function audit(
  tx: Queryable,
  actor: Actor,
  context: AuditContext,
  e: {
    action: string;
    entityType: string;
    entityId: string;
    reason: string;
    changes?: Record<string, string | number | boolean | null | string[]>;
  },
) {
  await recordAudit(tx, { actor: { type: 'user', userId: actor.userId }, ...e }, context);
}

async function rolesOf(tx: Queryable, userId: string): Promise<string[]> {
  const { rows } = await tx.query<{ code: string }>(
    'SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1',
    [userId],
  );
  return rows.map((r) => r.code);
}

async function lockUser(tx: Queryable, id: string) {
  const { rows } = await tx.query<{
    id: string;
    status: string;
    username: string;
    pendingApproval: boolean;
  }>(
    'SELECT id, status, username, pending_approval AS "pendingApproval" FROM users WHERE id = $1 FOR UPDATE',
    [id],
  );
  if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'User not found');
  return rows[0];
}

/** ADM may not act on SA accounts; SA (user_role:assign holders) may. */
async function guardTarget(tx: Queryable, actor: Actor, targetId: string) {
  if (targetId === actor.userId)
    throw new AppError(409, 'SELF_CHANGE', "You can't change your own account here.");
  if ((await rolesOf(tx, targetId)).includes('SA') && !actor.can('user_role:assign'))
    throw forbidden();
}

async function endSessions(tx: Queryable, userId: string) {
  await tx.query("DELETE FROM sessions WHERE sess->>'userId' = $1", [userId]);
}

async function activeSaCount(tx: Queryable): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
     WHERE r.code = 'SA' AND u.status = 'active'`,
  );
  return rows[0]!.n;
}

export async function createStaff(
  db: Database,
  input: {
    fullName: string;
    employeeNo: string;
    departmentId: string;
    designation: string;
    username?: string | undefined;
    password?: string | undefined;
    reason: string;
  },
  actor: Actor,
  context: AuditContext,
) {
  if ((input.username === undefined) !== (input.password === undefined)) {
    throw new AppError(422, 'LOGIN_INCOMPLETE', 'Give both a username and a password, or neither.');
  }
  const hash = input.password ? await hashPassword(input.password) : null;
  try {
    return await withTransaction(db, async (tx) => {
      const dept = await tx.query('SELECT 1 FROM departments WHERE id = $1 AND active', [
        input.departmentId,
      ]);
      if (!dept.rowCount) throw new AppError(422, 'UNKNOWN_DEPARTMENT', 'Department not found.');
      const { rows: emp } = await tx.query<{ id: string }>(
        `INSERT INTO employees (employee_no, full_name, department_id, designation, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
        [input.employeeNo, input.fullName, input.departmentId, input.designation, actor.userId],
      );
      await audit(tx, actor, context, {
        action: 'employee.created',
        entityType: 'employee',
        entityId: emp[0]!.id,
        reason: input.reason,
      });
      if (input.username && hash) {
        const { rows: u } = await tx.query<{ id: string }>(
          'INSERT INTO users (employee_id, username, password_hash, created_by, updated_by) VALUES ($1, $2, $3, $4, $4) RETURNING id',
          [emp[0]!.id, input.username, hash, actor.userId],
        );
        await audit(tx, actor, context, {
          action: 'user.created',
          entityType: 'user',
          entityId: u[0]!.id,
          reason: input.reason,
        });
      }
      return emp[0]!.id;
    });
  } catch (err) {
    const e = pg(err);
    if (e.code === '23505') {
      throw new AppError(
        409,
        'DUPLICATE',
        e.constraint?.includes('username')
          ? 'This username is taken.'
          : 'This employee number is taken.',
      );
    }
    throw err;
  }
}

/** Adds a login to an existing employee who has none. */
export async function createLogin(
  db: Database,
  employeeId: string,
  input: { username: string; password: string; reason: string },
  actor: Actor,
  context: AuditContext,
) {
  const hash = await hashPassword(input.password);
  try {
    return await withTransaction(db, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO users (employee_id, username, password_hash, created_by, updated_by)
         SELECT id, $2, $3, $4, $4 FROM employees WHERE id = $1 AND employment_status <> 'exited' RETURNING id`,
        [employeeId, input.username, hash, actor.userId],
      );
      if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Employee not found');
      await audit(tx, actor, context, {
        action: 'user.created',
        entityType: 'user',
        entityId: rows[0].id,
        reason: input.reason,
      });
      return rows[0].id;
    });
  } catch (err) {
    if (pg(err).code === '23505')
      throw new AppError(
        409,
        'DUPLICATE',
        'This username is taken, or the employee already has a login.',
      );
    throw err;
  }
}

export async function setUserStatus(
  db: Database,
  userId: string,
  status: 'active' | 'disabled',
  reason: string,
  actor: Actor,
  context: AuditContext,
) {
  return withTransaction(db, async (tx) => {
    const u = await lockUser(tx, userId);
    await guardTarget(tx, actor, userId);
    // A sign-up waiting for approval: approving activates it, rejecting keeps it disabled.
    const from = u.pendingApproval ? 'pending' : u.status;
    if (from === status) return;
    if (
      status === 'disabled' &&
      (await rolesOf(tx, userId)).includes('SA') &&
      (await activeSaCount(tx)) <= 1
    ) {
      throw new AppError(409, 'LAST_ADMIN', 'The last active Super Admin cannot be disabled.');
    }
    await tx.query(
      'UPDATE users SET status = $2, pending_approval = false, updated_by = $3 WHERE id = $1',
      [userId, status, actor.userId],
    );
    if (status === 'disabled') await endSessions(tx, userId);
    await audit(tx, actor, context, {
      action: 'user.status_changed',
      entityType: 'user',
      entityId: userId,
      reason,
      changes: { from, to: status },
    });
  });
}

export async function resetPassword(
  db: Database,
  userId: string,
  password: string,
  reason: string,
  actor: Actor,
  context: AuditContext,
) {
  const hash = await hashPassword(password);
  return withTransaction(db, async (tx) => {
    await lockUser(tx, userId);
    await guardTarget(tx, actor, userId);
    await tx.query(
      'UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL, updated_by = $3 WHERE id = $1',
      [userId, hash, actor.userId],
    );
    await endSessions(tx, userId);
    await audit(tx, actor, context, {
      action: 'user.password_reset',
      entityType: 'user',
      entityId: userId,
      reason,
    });
  });
}

export async function changeRole(
  db: Database,
  userId: string,
  roleCode: string,
  grant: boolean,
  reason: string,
  actor: Actor,
  context: AuditContext,
) {
  if (!(ROLE_CODES as readonly string[]).includes(roleCode))
    throw new AppError(422, 'UNKNOWN_ROLE', 'Role not found.');
  return withTransaction(db, async (tx) => {
    await lockUser(tx, userId);
    if (userId === actor.userId)
      throw new AppError(409, 'SELF_CHANGE', "You can't change your own roles.");
    const held = await rolesOf(tx, userId);
    if (grant) {
      if (held.includes(roleCode)) return;
      await tx.query(
        'INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2',
        [userId, roleCode],
      );
    } else {
      if (!held.includes(roleCode)) return;
      const { rows: t } = await tx.query<{ status: string }>(
        'SELECT status FROM users WHERE id = $1',
        [userId],
      );
      if (roleCode === 'SA' && t[0]?.status === 'active' && (await activeSaCount(tx)) <= 1) {
        throw new AppError(409, 'LAST_ADMIN', 'The last active Super Admin keeps the role.');
      }
      await tx.query(
        'DELETE FROM user_roles WHERE user_id = $1 AND role_id = (SELECT id FROM roles WHERE code = $2)',
        [userId, roleCode],
      );
    }
    await audit(tx, actor, context, {
      action: grant ? 'user_role.granted' : 'user_role.revoked',
      entityType: 'user',
      entityId: userId,
      reason,
      changes: { role: roleCode },
    });
  });
}

export async function createDepartment(
  db: Database,
  input: { code: string; name: string; isClinical: boolean },
  actor: Actor,
  context: AuditContext,
) {
  try {
    return await withTransaction(db, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        'INSERT INTO departments (code, name, is_clinical, created_by, updated_by) VALUES ($1, $2, $3, $4, $4) RETURNING id',
        [input.code, input.name, input.isClinical, actor.userId],
      );
      await audit(tx, actor, context, {
        action: 'department.created',
        entityType: 'department',
        entityId: rows[0]!.id,
        reason: 'created',
      });
      return rows[0]!.id;
    });
  } catch (err) {
    if (pg(err).code === '23505')
      throw new AppError(409, 'DUPLICATE', 'A department with this code or name exists.');
    throw err;
  }
}

export async function createDoctorProfile(
  db: Database,
  input: {
    employeeId: string;
    specialty: string;
    registrationNo: string;
    defaultSlotMinutes: number;
    consultationFeePaise: number;
  },
  actor: Actor,
  context: AuditContext,
) {
  try {
    return await withTransaction(db, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO doctor_profiles (employee_id, department_id, specialty, registration_no, default_slot_minutes, consultation_fee_paise, created_by, updated_by)
         SELECT e.id, e.department_id, $2, $3, $4, $5, $6, $6 FROM employees e
         JOIN departments d ON d.id = e.department_id
         WHERE e.id = $1 AND e.employment_status = 'active' AND d.is_clinical
         RETURNING id`,
        [
          input.employeeId,
          input.specialty,
          input.registrationNo,
          input.defaultSlotMinutes,
          input.consultationFeePaise,
          actor.userId,
        ],
      );
      if (!rows[0])
        throw new AppError(
          422,
          'NOT_ELIGIBLE',
          'The employee must be active and in a clinical department.',
        );
      await audit(tx, actor, context, {
        action: 'doctor_profile.created',
        entityType: 'doctor_profile',
        entityId: rows[0].id,
        reason: 'created',
      });
      return rows[0].id;
    });
  } catch (err) {
    if (pg(err).code === '23505')
      throw new AppError(
        409,
        'DUPLICATE',
        'This employee or registration number already has a doctor profile.',
      );
    throw err;
  }
}

/** New fee applies to future check-ins; invoices keep the fee copied at check-in. */
export async function changeFee(
  db: Database,
  doctorId: string,
  feePaise: number,
  reason: string,
  actor: Actor,
  context: AuditContext,
) {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ old: number }>(
      'SELECT consultation_fee_paise::int AS old FROM doctor_profiles WHERE id = $1 FOR UPDATE',
      [doctorId],
    );
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Doctor not found');
    await tx.query(
      'UPDATE doctor_profiles SET consultation_fee_paise = $2, updated_by = $3 WHERE id = $1',
      [doctorId, feePaise, actor.userId],
    );
    await audit(tx, actor, context, {
      action: 'doctor_fee.changed',
      entityType: 'doctor_profile',
      entityId: doctorId,
      reason,
      changes: { from: rows[0].old, to: feePaise },
    });
  });
}

export async function addScheduleException(
  db: Database,
  doctorId: string,
  input: { kind: string; startsAt: string; endsAt: string; reason?: string | null | undefined },
  actor: Actor,
  context: AuditContext,
) {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO schedule_exceptions (doctor_id, kind, starts_at, ends_at, reason, created_by, updated_by)
       SELECT id, $2, $3, $4, $5, $6, $6 FROM doctor_profiles WHERE id = $1 RETURNING id`,
      [doctorId, input.kind, input.startsAt, input.endsAt, input.reason ?? null, actor.userId],
    );
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Doctor not found');
    const booked = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM appointments WHERE doctor_id = $1 AND status = 'booked'
         AND slot_start < $3::timestamptz AND slot_end > $2::timestamptz`,
      [doctorId, input.startsAt, input.endsAt],
    );
    await audit(tx, actor, context, {
      action: 'schedule_exception.created',
      entityType: 'doctor_profile',
      entityId: doctorId,
      reason: input.kind,
    });
    return { id: rows[0].id, affectedBookings: booked.rows[0]!.n };
  });
}

export async function removeScheduleException(
  db: Database,
  id: string,
  actor: Actor,
  context: AuditContext,
) {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ doctorId: string }>(
      'UPDATE schedule_exceptions SET active = false, updated_by = $2 WHERE id = $1 AND active RETURNING doctor_id AS "doctorId"',
      [id, actor.userId],
    );
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Exception not found');
    await audit(tx, actor, context, {
      action: 'schedule_exception.removed',
      entityType: 'doctor_profile',
      entityId: rows[0].doctorId,
      reason: 'removed',
    });
  });
}

/** One key, checked against its permission (C3); old and new value are audited. */
export async function changeSetting(
  db: Database,
  key: string,
  value: string | number | boolean,
  reason: string,
  actor: Actor,
  context: AuditContext,
) {
  const def = SETTINGS[key];
  if (!def) throw new AppError(422, 'UNKNOWN_SETTING', 'Unknown setting.');
  if (!actor.can(def.permission)) throw forbidden();
  const ok =
    (def.type === 'int' && typeof value === 'number') ||
    (def.type === 'bool' && typeof value === 'boolean') ||
    (def.type === 'text' && typeof value === 'string' && value.trim().length > 0) ||
    (def.type === 'time' && typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value));
  if (!ok) throw new AppError(422, 'INVALID_VALUE', `${def.label}: invalid value.`);
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ old: string }>(
      `SELECT ${key}::text AS old FROM hospital_settings WHERE id = 1 FOR UPDATE`,
    );
    try {
      await tx.query(`UPDATE hospital_settings SET ${key} = $1, updated_by = $2 WHERE id = 1`, [
        value,
        actor.userId,
      ]);
    } catch (err) {
      if (pg(err).code === '23514')
        throw new AppError(422, 'INVALID_VALUE', `${def.label}: value out of range.`);
      throw err;
    }
    await audit(tx, actor, context, {
      action: 'settings.changed',
      entityType: 'setting',
      entityId: key,
      reason,
      changes: { from: rows[0]?.old ?? null, to: String(value) },
    });
  });
}
