/**
 * Administration: staff accounts, role assignment, departments, doctor profiles, schedule
 * exceptions, settings and the audit viewer (docs/permissions.md notes 1, 10, 11).
 */
import { z } from 'zod';
import type { PermissionCode } from '../permissions.js';
import { staffEmail } from './account.js';

const text = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);
const reason = text('Reason', 200);
const password = z.string().min(12, 'At least 12 characters').max(256, 'At most 256 characters');

export const USERNAME_RULE = /^[a-z][a-z0-9._-]{2,49}$/;

export const createStaffSchema = z.strictObject({
  fullName: text('Full name', 120),
  employeeNo: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{2,20}$/, 'Employee number: 2–20 capital letters, digits or dashes'),
  departmentId: z.uuid(),
  designation: text('Designation', 80),
  /** Optional work email: where password-reset links go. */
  email: staffEmail.optional(),
  /** Optional: an employee without a login (e.g. support staff tracked by HR). */
  username: z
    .string()
    .trim()
    .regex(
      USERNAME_RULE,
      'Username: 3–50 lowercase letters, digits, . _ or -, starting with a letter',
    )
    .optional(),
  password: password.optional(),
  reason,
});

export const staffEmailSchema = z.strictObject({ email: staffEmail.nullable() });

export const userStatusSchema = z.strictObject({ status: z.enum(['active', 'disabled']), reason });
export const resetPasswordSchema = z.strictObject({ password, reason });
export const roleChangeSchema = z.strictObject({
  roleCode: z.string().trim().min(2).max(10),
  reason,
});
export const departmentSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_-]{1,19}$/, 'Code: 2–20 capital letters, digits, _ or -'),
  name: text('Name', 80),
  isClinical: z.boolean().default(false),
});
export const doctorProfileSchema = z.strictObject({
  employeeId: z.uuid(),
  specialty: text('Specialty', 80),
  registrationNo: text('Registration number', 40),
  defaultSlotMinutes: z.int().min(5).max(120).default(15),
  consultationFeePaise: z.int().min(0).max(10_000_000),
});
export const doctorFeeSchema = z.strictObject({
  consultationFeePaise: z.int().min(0).max(10_000_000),
  reason,
});
export const scheduleExceptionSchema = z
  .strictObject({
    kind: z.enum(['leave', 'blocked']),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    reason: z
      .string()
      .trim()
      .max(200)
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
  })
  .refine((e) => new Date(e.startsAt) < new Date(e.endsAt), {
    path: ['endsAt'],
    message: 'Must be after the start',
  });

/** Each setting belongs to exactly one permission (C3). */
export const SETTINGS: Record<
  string,
  { permission: PermissionCode; type: 'text' | 'int' | 'bool' | 'time'; label: string }
> = {
  name: { permission: 'system_settings:manage', type: 'text', label: 'Hospital name' },
  discount_limit_bp: {
    permission: 'operational_settings:manage',
    type: 'int',
    label: 'Discount limit (basis points)',
  },
  near_expiry_days: {
    permission: 'operational_settings:manage',
    type: 'int',
    label: 'Near-expiry window (days)',
  },
  care_window_before_days: {
    permission: 'security_settings:manage',
    type: 'int',
    label: 'Chart access before a visit (days)',
  },
  care_window_after_days: {
    permission: 'security_settings:manage',
    type: 'int',
    label: 'Chart access after an encounter (days)',
  },
  break_glass_hours: {
    permission: 'security_settings:manage',
    type: 'int',
    label: 'Emergency access duration (hours)',
  },
  break_glass_alert_threshold: {
    permission: 'security_settings:manage',
    type: 'int',
    label: 'Emergency access alert threshold',
  },
  follow_up_grace_days: {
    permission: 'operational_settings:manage',
    type: 'int',
    label: 'Follow-up grace (days)',
  },
  prescription_validity_days: {
    permission: 'operational_settings:manage',
    type: 'int',
    label: 'Prescription validity (days)',
  },
  day_close_time: {
    permission: 'operational_settings:manage',
    type: 'time',
    label: 'End-of-day time',
  },
  day_close_enabled: {
    permission: 'operational_settings:manage',
    type: 'bool',
    label: 'End-of-day job enabled',
  },
  return_window_days: {
    permission: 'operational_settings:manage',
    type: 'int',
    label: 'Return window (days)',
  },
};

export const settingChangeSchema = z.strictObject({
  key: z.string(),
  value: z.union([z.string().max(120), z.number().int().min(0).max(100_000), z.boolean()]),
  reason,
});

export const auditSearchSchema = z.strictObject({
  action: z.string().trim().max(60).optional(),
  entityType: z.string().trim().max(40).optional(),
  actorUserId: z.uuid().optional(),
  patientId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  before: z.coerce.number().int().positive().optional(),
});

export interface StaffAccount {
  employeeId: string;
  employeeNo: string;
  fullName: string;
  designation: string;
  /** Work email (password-reset links); null if HR hasn't added one. */
  email: string | null;
  employmentStatus: string;
  department: { id: string; name: string };
  user: { id: string; username: string; status: string; locked: boolean; roles: string[] } | null;
  doctorProfileId: string | null;
}

export interface AuditRow {
  id: number;
  occurredAt: string;
  actorType: string;
  actor: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  patientMrn: string | null;
  reason: string | null;
  changes: Record<string, unknown> | null;
  requestId: string | null;
}
