/**
 * HR, finance, equipment and marketing MVP tables (ERD §3.8 "Tier 3"). Payroll, shifts
 * and campaign analytics are not part of the MVP.
 */
import {
  ATTENDANCE_STATUSES,
  CAMPAIGN_STATUSES,
  ENQUIRY_CHANNELS,
  ENQUIRY_STATUSES,
  EQUIPMENT_STATUSES,
  EXPENSE_STATUSES,
  LEAVE_KINDS,
  LEAVE_STATUSES,
  MAINTENANCE_KINDS,
} from '@hospitalos/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgSequence,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, citext, oneOf } from './columns.js';
import { departments, employees, users } from './identity.js';
import { patients } from './patients.js';

const userId = () => users.id;
const seq = (name: string) =>
  pgSequence(name, { startWith: 1, increment: 1, minValue: 1, maxValue: 9_999_999, cycle: false });

export const attendance = pgTable(
  'attendance',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    workDate: date('work_date', { mode: 'string' }).notNull(),
    status: text('status').notNull(),
    checkIn: time('check_in'),
    checkOut: time('check_out'),
    notes: text('notes'),
    ...auditColumns(userId),
  },
  (t) => [
    unique('attendance_employee_date_key').on(t.employeeId, t.workDate),
    index('attendance_date_idx').on(t.workDate),
    check('attendance_status_check', oneOf(t.status, ATTENDANCE_STATUSES)),
    check(
      'attendance_time_order',
      sql`${t.checkIn} IS NULL OR ${t.checkOut} IS NULL OR ${t.checkIn} <= ${t.checkOut}`,
    ),
  ],
);

export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('pending'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'restrict' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    ...auditColumns(userId),
  },
  (t) => [
    index('leave_requests_employee_idx').on(t.employeeId, t.startDate),
    index('leave_requests_status_idx').on(t.status),
    check('leave_requests_kind_check', oneOf(t.kind, LEAVE_KINDS)),
    check('leave_requests_status_check', oneOf(t.status, LEAVE_STATUSES)),
    check('leave_requests_date_order', sql`${t.startDate} <= ${t.endDate}`),
    check(
      'leave_requests_decision_fields',
      sql`(${t.status} IN ('approved', 'rejected')) = (${t.decidedBy} IS NOT NULL AND ${t.decidedAt} IS NOT NULL)`,
    ),
    check(
      'leave_requests_not_self_decided',
      sql`${t.decidedBy} IS NULL OR ${t.decidedBy} <> ${t.createdBy}`,
    ),
  ],
);

export const expenseCategories = pgTable('expense_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique('expense_categories_code_key'),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  ...auditColumns(userId),
});

export const expenseNoSeq = seq('expense_no_seq');

export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    expenseNo: text('expense_no')
      .notNull()
      .unique('expenses_expense_no_key')
      .default(sql`('EXP' || lpad(nextval('expense_no_seq')::text, 7, '0'))`),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => expenseCategories.id, { onDelete: 'restrict' }),
    expenseDate: date('expense_date', { mode: 'string' }).notNull(),
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    payee: text('payee').notNull(),
    description: text('description').notNull(),
    status: text('status').notNull().default('submitted'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'restrict' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    ...auditColumns(userId),
  },
  (t) => [
    index('expenses_date_idx').on(t.expenseDate),
    index('expenses_status_idx').on(t.status),
    check('expenses_amount_positive', sql`${t.amountPaise} > 0`),
    check('expenses_status_check', oneOf(t.status, EXPENSE_STATUSES)),
    check(
      'expenses_decision_fields',
      sql`(${t.status} <> 'submitted') = (${t.decidedBy} IS NOT NULL AND ${t.decidedAt} IS NOT NULL)`,
    ),
    check(
      'expenses_not_self_approved',
      sql`${t.decidedBy} IS NULL OR ${t.decidedBy} <> ${t.createdBy}`,
    ),
  ],
);

export const equipment = pgTable(
  'equipment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetTag: text('asset_tag').notNull().unique('equipment_asset_tag_key'),
    name: text('name').notNull(),
    category: text('category'),
    serialNo: text('serial_no').unique('equipment_serial_no_key'),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'restrict' }),
    locationNote: text('location_note'),
    status: text('status').notNull().default('in_service'),
    purchaseDate: date('purchase_date', { mode: 'string' }),
    maintenanceIntervalDays: integer('maintenance_interval_days'),
    nextMaintenanceDue: date('next_maintenance_due', { mode: 'string' }),
    ...auditColumns(userId),
  },
  (t) => [
    index('equipment_next_due_idx').on(t.nextMaintenanceDue),
    check('equipment_status_check', oneOf(t.status, EQUIPMENT_STATUSES)),
    check(
      'equipment_interval',
      sql`${t.maintenanceIntervalDays} IS NULL OR ${t.maintenanceIntervalDays} BETWEEN 1 AND 3650`,
    ),
  ],
);

/** Append-only. */
export const maintenanceLogs = pgTable(
  'maintenance_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    equipmentId: uuid('equipment_id')
      .notNull()
      .references(() => equipment.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    performedOn: date('performed_on', { mode: 'string' }).notNull(),
    notes: text('notes').notNull(),
    outcome: text('outcome').notNull(),
    nextDue: date('next_due', { mode: 'string' }),
    loggedBy: uuid('logged_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    loggedAt: timestamp('logged_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('maintenance_logs_equipment_idx').on(t.equipmentId, t.performedOn),
    check('maintenance_logs_kind_check', oneOf(t.kind, MAINTENANCE_KINDS)),
    check(
      'maintenance_logs_outcome_check',
      sql`${t.outcome} IN ('in_service', 'under_maintenance', 'out_of_service')`,
    ),
  ],
);

export const referralSources = pgTable('referral_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: citext('name').notNull().unique('referral_sources_name_key'),
  active: boolean('active').notNull().default(true),
  ...auditColumns(userId),
});

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    channel: text('channel').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    status: text('status').notNull().default('planned'),
    budgetPaise: bigint('budget_paise', { mode: 'number' }).notNull().default(0),
    notes: text('notes'),
    ...auditColumns(userId),
  },
  (t) => [
    check('campaigns_status_check', oneOf(t.status, CAMPAIGN_STATUSES)),
    check('campaigns_date_order', sql`${t.endDate} IS NULL OR ${t.startDate} <= ${t.endDate}`),
    check('campaigns_budget_non_negative', sql`${t.budgetPaise} >= 0`),
  ],
);

export const enquiryNoSeq = seq('enquiry_no_seq');

/** Contact details for an enquiry only; never clinical data. */
export const enquiries = pgTable(
  'enquiries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    enquiryNo: text('enquiry_no')
      .notNull()
      .unique('enquiries_enquiry_no_key')
      .default(sql`('ENQ' || lpad(nextval('enquiry_no_seq')::text, 7, '0'))`),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    channel: text('channel').notNull(),
    referralSourceId: uuid('referral_source_id').references(() => referralSources.id, {
      onDelete: 'restrict',
    }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'restrict' }),
    subject: text('subject').notNull(),
    notes: text('notes'),
    status: text('status').notNull().default('open'),
    convertedPatientId: uuid('converted_patient_id').references(() => patients.id, {
      onDelete: 'restrict',
    }),
    ...auditColumns(userId),
  },
  (t) => [
    index('enquiries_status_idx').on(t.status, t.createdAt),
    check('enquiries_channel_check', oneOf(t.channel, ENQUIRY_CHANNELS)),
    check('enquiries_status_check', oneOf(t.status, ENQUIRY_STATUSES)),
    check('enquiries_phone_digits', sql`${t.phone} ~ '^[0-9]{7,15}$'`),
    check(
      'enquiries_converted_link',
      sql`(${t.status} = 'converted') = (${t.convertedPatientId} IS NOT NULL)`,
    ),
  ],
);

/** Append-only notes on an enquiry; `done` is the only thing that changes. */
export const enquiryFollowUps = pgTable(
  'enquiry_follow_ups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    enquiryId: uuid('enquiry_id')
      .notNull()
      .references(() => enquiries.id, { onDelete: 'restrict' }),
    note: text('note').notNull(),
    dueOn: date('due_on', { mode: 'string' }),
    done: boolean('done').notNull().default(false),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('enquiry_follow_ups_enquiry_idx').on(t.enquiryId, t.createdAt)],
);
