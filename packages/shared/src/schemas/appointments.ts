/**
 * Appointment kinds, statuses and the allowed status changes (docs/state-machines.md §1).
 * The same table is enforced three times: here (UI), in the API services, and by a
 * database trigger (migration 0007). A test checks the trigger against this table.
 */
import { z } from 'zod';

export const APPOINTMENT_KINDS = ['scheduled', 'walk_in', 'follow_up'] as const;
export type AppointmentKind = (typeof APPOINTMENT_KINDS)[number];

export const APPOINTMENT_STATUSES = [
  'booked',
  'checked_in',
  'in_consultation',
  'completed',
  'cancelled',
  'no_show',
  'rescheduled',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Statuses that occupy the doctor's slot (and the patient's time). */
export const ACTIVE_APPOINTMENT_STATUSES = ['booked', 'checked_in', 'in_consultation'] as const;

/** A new appointment starts as booked (by slot) or checked_in (walk-in). */
export const INITIAL_APPOINTMENT_STATUSES = ['booked', 'checked_in'] as const;

export const APPOINTMENT_TRANSITIONS: Readonly<
  Record<AppointmentStatus, readonly AppointmentStatus[]>
> = {
  booked: ['checked_in', 'cancelled', 'rescheduled', 'no_show'],
  checked_in: ['in_consultation', 'cancelled'],
  // Back to checked_in only when the encounter is entered in error (Day 4).
  in_consultation: ['completed', 'checked_in'],
  completed: [],
  cancelled: [],
  no_show: [],
  rescheduled: [],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return APPOINTMENT_TRANSITIONS[from].includes(to);
}

export const SCHEDULE_EXCEPTION_KINDS = ['leave', 'blocked'] as const;
export type ScheduleExceptionKind = (typeof SCHEDULE_EXCEPTION_KINDS)[number];

/** ISO weekday: 1 = Monday … 7 = Sunday (PostgreSQL extract(isodow …)). */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

// ---- API requests and responses (Day 3 Phase 3B) ----

const isoDate = z.iso.date('Must be a date (YYYY-MM-DD)');
/** A slot start with an explicit offset, e.g. 2030-01-07T09:00:00+05:30. */
const slotStart = z.iso.datetime({ offset: true, message: 'Must be a date-time with an offset' });

export const availabilityQuerySchema = z.strictObject({ date: isoDate });

export const createAppointmentSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('scheduled'),
    patientId: z.uuid(),
    doctorId: z.uuid(),
    slotStart,
  }),
  z.strictObject({ kind: z.literal('walk_in'), patientId: z.uuid(), doctorId: z.uuid() }),
]);
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

export const CANCEL_REASON_MAX = 200;
export const cancelAppointmentSchema = z.strictObject({
  reason: z
    .string()
    .trim()
    .min(1, 'A reason is required')
    .max(CANCEL_REASON_MAX, `Reason must be at most ${CANCEL_REASON_MAX} characters`),
});

/** The new slot; doctorId defaults to the original appointment's doctor. */
export const rescheduleAppointmentSchema = z.strictObject({
  slotStart,
  doctorId: z.uuid().optional(),
});

export const appointmentListQuerySchema = z.strictObject({
  date: isoDate,
  doctorId: z.uuid().optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
});

export const queueQuerySchema = z.strictObject({
  date: isoDate.optional(),
  doctorId: z.uuid().optional(),
});

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be a time (HH:MM)');

export const createScheduleSchema = z
  .strictObject({
    weekday: z.int().min(1).max(7),
    startTime: time,
    endTime: time,
    slotMinutes: z.int().min(5).max(120),
    validFrom: isoDate,
    validTo: isoDate.nullable().optional(),
  })
  .refine((s) => s.startTime < s.endTime, { path: ['endTime'], message: 'Must be after start' })
  .refine((s) => !s.validTo || s.validTo >= s.validFrom, {
    path: ['validTo'],
    message: 'Must not be before validFrom',
  });

export const updateScheduleSchema = z.strictObject({ active: z.literal(false) });

export interface AvailabilitySlot {
  scheduleId: string;
  slotStart: string;
  slotEnd: string;
  /** Free to book: inside a session, not blocked by leave, not taken, not in the past. */
  available: boolean;
}

export interface DoctorSchedule {
  id: string;
  doctorId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  slotMinutes: number;
  validFrom: string;
  validTo: string | null;
  active: boolean;
}

/**
 * What appointment lists, the queue and booking responses show: scheduling fields and
 * patient identifiers only (docs/permissions.md note 12). No contact or clinical data.
 */
export interface AppointmentSummary {
  id: string;
  appointmentNo: string;
  kind: AppointmentKind;
  status: AppointmentStatus;
  visitDate: string;
  slotStart: string | null;
  slotEnd: string | null;
  tokenNo: number | null;
  checkedInAt: string | null;
  patient: { id: string; mrn: string; firstName: string; lastName: string };
  doctor: { id: string; fullName: string };
  departmentId: string;
  rescheduledFromId: string | null;
}

/** One appointment by ID: the summary plus its status history fields. */
export interface AppointmentDetail extends AppointmentSummary {
  cancelledAt: string | null;
  cancelReason: string | null;
  noShowAt: string | null;
  createdAt: string;
  updatedAt: string;
}
