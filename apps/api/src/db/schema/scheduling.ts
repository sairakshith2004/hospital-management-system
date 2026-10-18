/**
 * Doctor schedules, time off and appointments (ERD §3.2, reduced for the 10-day MVP).
 * The overlap rules (EXCLUDE constraints), the status-transition trigger and the hms_app
 * grants are in the hand-written migration 0007, because Drizzle can't express them.
 */
import {
  ACTIVE_APPOINTMENT_STATUSES,
  APPOINTMENT_KINDS,
  APPOINTMENT_STATUSES,
  HOSPITAL_TIME_ZONE,
  SCHEDULE_EXCEPTION_KINDS,
} from '@hospitalos/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgSequence,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { auditColumns, oneOf } from './columns.js';
import { doctorProfiles } from './doctors.js';
import { departments, users } from './identity.js';
import { patients } from './patients.js';

const userId = (): AnyPgColumn => users.id;
const activeStatuses = sql.raw(ACTIVE_APPOINTMENT_STATUSES.map((s) => `'${s}'`).join(', '));

/**
 * Weekly working sessions. A day with a break has two sessions (09:00–13:00 and
 * 14:00–17:00); the gap is the break. Times are wall-clock times in the hospital time zone.
 */
export const doctorSchedules = pgTable(
  'doctor_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctorProfiles.id, { onDelete: 'restrict' }),
    weekday: smallint('weekday').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    slotMinutes: integer('slot_minutes').notNull(),
    validFrom: date('valid_from', { mode: 'string' })
      .notNull()
      .default(sql`CURRENT_DATE`),
    validTo: date('valid_to', { mode: 'string' }),
    active: boolean('active').notNull().default(true),
    ...auditColumns(userId),
  },
  (t) => [
    unique('doctor_schedules_id_doctor_id_key').on(t.id, t.doctorId),
    index('doctor_schedules_doctor_id_idx').on(t.doctorId),
    check('doctor_schedules_weekday_check', sql`${t.weekday} BETWEEN 1 AND 7`),
    check('doctor_schedules_time_order', sql`${t.startTime} < ${t.endTime}`),
    check('doctor_schedules_slot_minutes', sql`${t.slotMinutes} BETWEEN 5 AND 120`),
    check(
      'doctor_schedules_fits_one_slot',
      sql`${t.endTime} - ${t.startTime} >= make_interval(mins => ${t.slotMinutes})`,
    ),
    check(
      'doctor_schedules_valid_range',
      sql`${t.validTo} IS NULL OR ${t.validTo} >= ${t.validFrom}`,
    ),
  ],
);

/** Leave (whole days or more) and blocked time ranges. Deactivated, never deleted. */
export const scheduleExceptions = pgTable(
  'schedule_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctorProfiles.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    reason: text('reason'),
    active: boolean('active').notNull().default(true),
    ...auditColumns(userId),
  },
  (t) => [
    index('schedule_exceptions_doctor_starts_idx').on(t.doctorId, t.startsAt),
    check('schedule_exceptions_kind_check', oneOf(t.kind, SCHEDULE_EXCEPTION_KINDS)),
    check('schedule_exceptions_time_order', sql`${t.startsAt} < ${t.endsAt}`),
    check(
      'schedule_exceptions_reason_length',
      sql`${t.reason} IS NULL OR length(${t.reason}) <= 200`,
    ),
  ],
);

/** Appointment numbers come from a sequence; capped so the 7-digit number never repeats. */
export const appointmentNoSeq = pgSequence('appointment_no_seq', {
  startWith: 1,
  increment: 1,
  minValue: 1,
  maxValue: 9_999_999,
  cycle: false,
});

export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appointmentNo: text('appointment_no')
      .notNull()
      .unique('appointments_appointment_no_key')
      .default(sql`('APT' || lpad(nextval('appointment_no_seq')::text, 7, '0'))`),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctorProfiles.id, { onDelete: 'restrict' }),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'restrict' }),
    /** The session the slot came from; null for walk-ins. */
    doctorScheduleId: uuid('doctor_schedule_id'),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('booked'),
    /** The visit's date in the hospital time zone. */
    visitDate: date('visit_date', { mode: 'string' }).notNull(),
    slotStart: timestamp('slot_start', { withTimezone: true }),
    slotEnd: timestamp('slot_end', { withTimezone: true }),
    tokenNo: integer('token_no'),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    consultStartedAt: timestamp('consult_started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    noShowAt: timestamp('no_show_at', { withTimezone: true }),
    /** The appointment this one replaced (the old row keeps status `rescheduled`). */
    rescheduledFromId: uuid('rescheduled_from_id').unique('appointments_rescheduled_from_id_key'),
    /** For a follow-up: the patient's earlier appointment it follows. */
    followUpOfId: uuid('follow_up_of_id'),
    ...auditColumns(userId),
  },
  (t) => [
    // Target of the same-patient composite keys below.
    unique('appointments_id_patient_id_key').on(t.id, t.patientId),
    foreignKey({
      name: 'appointments_schedule_doctor_fk',
      columns: [t.doctorScheduleId, t.doctorId],
      foreignColumns: [doctorSchedules.id, doctorSchedules.doctorId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'appointments_rescheduled_from_same_patient_fk',
      columns: [t.rescheduledFromId, t.patientId],
      foreignColumns: [t.id, t.patientId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'appointments_follow_up_of_same_patient_fk',
      columns: [t.followUpOfId, t.patientId],
      foreignColumns: [t.id, t.patientId],
    }).onDelete('restrict'),
    uniqueIndex('appointments_doctor_day_token_key')
      .on(t.doctorId, t.visitDate, t.tokenNo)
      .where(sql`${t.tokenNo} IS NOT NULL`),
    uniqueIndex('appointments_patient_doctor_day_active_key')
      .on(t.patientId, t.doctorId, t.visitDate)
      .where(sql`${t.status} IN (${activeStatuses})`),
    index('appointments_day_doctor_status_idx').on(t.visitDate, t.doctorId, t.status),
    index('appointments_patient_id_idx').on(t.patientId),
    check('appointments_kind_check', oneOf(t.kind, APPOINTMENT_KINDS)),
    check('appointments_status_check', oneOf(t.status, APPOINTMENT_STATUSES)),
    check(
      'appointments_walk_in_has_no_slot',
      sql`(${t.kind} = 'walk_in') = (${t.slotStart} IS NULL)`,
    ),
    check(
      'appointments_slot_both_or_neither',
      sql`(${t.slotStart} IS NULL) = (${t.slotEnd} IS NULL)`,
    ),
    check('appointments_slot_order', sql`${t.slotStart} IS NULL OR ${t.slotStart} < ${t.slotEnd}`),
    check(
      'appointments_slot_on_visit_date',
      sql`${t.slotStart} IS NULL OR ${t.visitDate} = (${t.slotStart} AT TIME ZONE '${sql.raw(HOSPITAL_TIME_ZONE)}')::date`,
    ),
    check(
      'appointments_follow_up_link',
      sql`(${t.kind} = 'follow_up') = (${t.followUpOfId} IS NOT NULL)`,
    ),
    check(
      'appointments_not_own_follow_up',
      sql`${t.followUpOfId} IS NULL OR ${t.followUpOfId} <> ${t.id}`,
    ),
    check(
      'appointments_not_own_reschedule',
      sql`${t.rescheduledFromId} IS NULL OR ${t.rescheduledFromId} <> ${t.id}`,
    ),
    check('appointments_token_positive', sql`${t.tokenNo} IS NULL OR ${t.tokenNo} > 0`),
    check(
      'appointments_checked_in_fields',
      sql`${t.status} NOT IN ('checked_in', 'in_consultation', 'completed') OR (${t.checkedInAt} IS NOT NULL AND ${t.tokenNo} IS NOT NULL)`,
    ),
    check(
      'appointments_cancelled_fields',
      sql`${t.status} <> 'cancelled' OR (${t.cancelledAt} IS NOT NULL AND length(trim(${t.cancelReason})) > 0)`,
    ),
    // Migration 0008. The check above (0006) lets a NULL reason through: length(trim(NULL))
    // is NULL, and PostgreSQL treats a NULL CHECK result as passing. Every term here is
    // true or false, never NULL, so a cancellation needs a time and a non-blank reason.
    check(
      'appointments_cancel_reason_required',
      sql`${t.status} <> 'cancelled' OR (${t.cancelledAt} IS NOT NULL AND ${t.cancelReason} IS NOT NULL AND btrim(${t.cancelReason}) <> '')`,
    ),
    check(
      'appointments_no_show_fields',
      sql`${t.status} <> 'no_show' OR ${t.noShowAt} IS NOT NULL`,
    ),
    check(
      'appointments_cancel_reason_length',
      sql`${t.cancelReason} IS NULL OR length(${t.cancelReason}) <= 200`,
    ),
  ],
);
