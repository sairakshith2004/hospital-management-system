/**
 * HR, finance, equipment and marketing MVPs (ERD §3.8, "Tier 3"). Small, persisted
 * workflows: attendance and leave, expenses with approval, an asset register with
 * maintenance, and patient enquiries with follow-ups.
 */
import { z } from 'zod';

export const ATTENDANCE_STATUSES = ['present', 'absent', 'leave', 'half_day'] as const;
export const LEAVE_KINDS = ['casual', 'sick', 'earned', 'other'] as const;
export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
/** What staff and HR see for each leave kind. "earned" is the paid leave. */
export const LEAVE_KIND_LABELS: Record<(typeof LEAVE_KINDS)[number], string> = {
  casual: 'Casual leave',
  sick: 'Sick leave',
  earned: 'Paid leave (earned)',
  other: 'Other leave',
};
export const EXPENSE_STATUSES = ['submitted', 'approved', 'rejected'] as const;
export const EQUIPMENT_STATUSES = [
  'in_service',
  'under_maintenance',
  'out_of_service',
  'retired',
] as const;
export const MAINTENANCE_KINDS = ['preventive', 'corrective', 'inspection'] as const;
export const ENQUIRY_CHANNELS = ['phone', 'walk_in', 'web', 'referral', 'other'] as const;
export const ENQUIRY_STATUSES = ['open', 'follow_up', 'converted', 'closed'] as const;
export const CAMPAIGN_STATUSES = ['planned', 'active', 'completed'] as const;

const text = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();
const isoDate = z.iso.date('Must be a date (YYYY-MM-DD)');
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be a time (HH:MM)')
  .nullable()
  .optional();

export const attendanceSchema = z.strictObject({
  employeeId: z.uuid(),
  workDate: isoDate,
  status: z.enum(ATTENDANCE_STATUSES),
  checkIn: time,
  checkOut: time,
  notes: optional(200),
});

export const leaveRequestSchema = z
  .strictObject({
    kind: z.enum(LEAVE_KINDS),
    startDate: isoDate,
    endDate: isoDate,
    reason: text('Reason', 300),
  })
  .refine((l) => l.startDate <= l.endDate, {
    path: ['endDate'],
    message: 'Must not be before the start',
  });

export const leaveDecisionSchema = z
  .strictObject({
    decision: z.enum(['approved', 'rejected']),
    note: optional(300),
  })
  .refine((d) => d.decision === 'approved' || (d.note ?? '') !== '', {
    path: ['note'],
    message: 'Give the reason for rejecting',
  });

export const leaveListQuerySchema = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
  status: z.enum(LEAVE_STATUSES).optional(),
  employeeId: z.uuid().optional(),
});

/** One leave request as the API returns it. Days are calendar days, both ends included. */
export interface LeaveRequestView {
  id: string;
  kind: (typeof LEAVE_KINDS)[number];
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: (typeof LEAVE_STATUSES)[number];
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  employee: { id: string; fullName: string; employeeNo: string; department: string };
  /** Booked appointments in these dates, when the employee is a doctor (HR view only). */
  bookedAppointments: number;
  mine: boolean;
}

/** Leave days per person for one calendar year (approved days only count as leave taken). */
export interface LeaveSummaryRow {
  employeeId: string;
  employeeNo: string;
  fullName: string;
  department: string;
  approvedDays: Record<(typeof LEAVE_KINDS)[number], number>;
  totalApprovedDays: number;
  pendingRequests: number;
  rejectedRequests: number;
}

export const expenseCategorySchema = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{2,20}$/, 'Code: 2–20 capital letters, digits or dashes'),
  name: text('Name', 80),
});

export const expenseSchema = z.strictObject({
  categoryId: z.uuid(),
  expenseDate: isoDate,
  amountPaise: z.int().positive().max(1_000_000_000),
  payee: text('Payee', 120),
  description: text('Description', 300),
});

export const expenseDecisionSchema = z.strictObject({
  decision: z.enum(['approved', 'rejected']),
  note: optional(300),
});

export const equipmentSchema = z.strictObject({
  assetTag: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{2,30}$/, 'Asset tag: 2–30 capital letters, digits or dashes'),
  name: text('Name', 120),
  category: optional(60),
  serialNo: optional(60),
  departmentId: z.uuid().nullable().optional(),
  locationNote: optional(120),
  purchaseDate: isoDate.nullable().optional(),
  maintenanceIntervalDays: z.int().min(1).max(3650).nullable().optional(),
});

export const equipmentStatusSchema = z.strictObject({
  status: z.enum(EQUIPMENT_STATUSES),
  note: text('Note', 200),
});

export const maintenanceLogSchema = z.strictObject({
  kind: z.enum(MAINTENANCE_KINDS),
  performedOn: isoDate,
  notes: text('Notes', 1000),
  outcome: z.enum(['in_service', 'under_maintenance', 'out_of_service']),
  nextDue: isoDate.nullable().optional(),
});

export const enquirySchema = z.strictObject({
  name: text('Name', 120),
  phone: z
    .string()
    .transform((v) => v.replace(/[\s\-()]/g, '').replace(/^\+/, ''))
    .pipe(z.string().regex(/^[0-9]{7,15}$/, 'Phone must be 7–15 digits')),
  channel: z.enum(ENQUIRY_CHANNELS),
  referralSourceId: z.uuid().nullable().optional(),
  campaignId: z.uuid().nullable().optional(),
  subject: text('Subject', 200),
  notes: optional(1000),
});

export const enquiryUpdateSchema = z.strictObject({
  status: z.enum(ENQUIRY_STATUSES),
  convertedPatientId: z.uuid().nullable().optional(),
});

export const enquiryFollowUpSchema = z.strictObject({
  note: text('Note', 500),
  dueOn: isoDate.nullable().optional(),
});

export const referralSourceSchema = z.strictObject({ name: text('Name', 80) });

export const campaignSchema = z
  .strictObject({
    name: text('Name', 120),
    channel: text('Channel', 60),
    startDate: isoDate,
    endDate: isoDate.nullable().optional(),
    budgetPaise: z.int().min(0).max(1_000_000_000).default(0),
    notes: optional(500),
  })
  .refine((c) => !c.endDate || c.startDate <= c.endDate, {
    path: ['endDate'],
    message: 'Must not be before the start',
  });

export const campaignStatusSchema = z.strictObject({ status: z.enum(CAMPAIGN_STATUSES) });
