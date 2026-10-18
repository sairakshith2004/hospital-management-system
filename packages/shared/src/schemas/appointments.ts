/**
 * Appointment kinds, statuses and the allowed status changes (docs/state-machines.md §1).
 * The same table is enforced three times: here (UI), in the API services, and by a
 * database trigger (migration 0007). A test checks the trigger against this table.
 */
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
