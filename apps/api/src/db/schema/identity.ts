/**
 * Organisation and access tables (ERD §3.1). Kept in one file because their
 * foreign keys form a cycle: created_by → users → employees → departments.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { auditColumns, citext, oneOf } from './columns.js';

export const EMPLOYMENT_STATUSES = ['active', 'on_leave', 'exited'] as const;
export const USER_STATUSES = ['active', 'disabled'] as const;

const userId = (): AnyPgColumn => users.id;

export const departments = pgTable(
  'departments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique('departments_code_key'),
    name: text('name').notNull().unique('departments_name_key'),
    isClinical: boolean('is_clinical').notNull().default(false),
    active: boolean('active').notNull().default(true),
    ...auditColumns(userId),
  },
  (t) => [check('departments_code_format', sql`${t.code} ~ '^[A-Z][A-Z0-9_-]{1,19}$'`)],
);

export const employees = pgTable(
  'employees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeNo: text('employee_no').notNull().unique('employees_employee_no_key'),
    fullName: text('full_name').notNull(),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'restrict' }),
    designation: text('designation').notNull(),
    employmentStatus: text('employment_status').notNull().default('active'),
    ...auditColumns(userId),
  },
  (t) => [
    index('employees_department_id_idx').on(t.departmentId),
    check('employees_full_name_not_blank', sql`length(trim(${t.fullName})) > 0`),
    check('employees_employment_status_check', oneOf(t.employmentStatus, EMPLOYMENT_STATUSES)),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .unique('users_employee_id_key')
      .references(() => employees.id, { onDelete: 'restrict' }),
    username: citext('username').notNull().unique('users_username_key'),
    passwordHash: text('password_hash').notNull(),
    status: text('status').notNull().default('active'),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    ...auditColumns(userId),
  },
  (t) => [
    check('users_status_check', oneOf(t.status, USER_STATUSES)),
    check('users_failed_logins_non_negative', sql`${t.failedLogins} >= 0`),
  ],
);

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique('roles_code_key'),
    name: text('name').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    active: boolean('active').notNull().default(true),
    ...auditColumns(userId),
  },
  (t) => [check('roles_code_format', sql`${t.code} ~ '^[A-Z][A-Z0-9_]{1,19}$'`)],
);

/** Seed-only reference data (from packages/shared), so no updated_* columns. */
export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique('permissions_code_key'),
    description: text('description').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('permissions_code_format', sql`${t.code} ~ '^[a-z_]+:[a-z_]+$'`)],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    grantedBy: uuid('granted_by').references(userId, { onDelete: 'restrict' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'user_roles_pkey', columns: [t.userId, t.roleId] }),
    index('user_roles_role_id_idx').on(t.roleId),
    // Nobody grants themselves a role. NULL (the seeded bootstrap SA) passes.
    check('user_roles_no_self_grant', sql`${t.grantedBy} <> ${t.userId}`),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    grantedBy: uuid('granted_by').references(userId, { onDelete: 'restrict' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'role_permissions_pkey', columns: [t.roleId, t.permissionId] }),
    index('role_permissions_permission_id_idx').on(t.permissionId),
  ],
);
