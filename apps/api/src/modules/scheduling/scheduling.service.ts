/**
 * Booking, walk-ins, cancellation, rescheduling, check-in and no-shows (docs/state-machines.md
 * §1). Each change, its locks and its audit row commit together or not at all. Audit rows
 * record IDs, statuses and field names only; never the free-text cancellation reason.
 */
import {
  canTransition,
  type AppointmentDetail,
  type AppointmentStatus,
  type CreateAppointmentInput,
  type DoctorSchedule,
} from '@hospitalos/shared';
import { withTransaction, type Database, type Queryable } from '../../db/client.js';
import { recordAudit, type AuditContext } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import {
  deactivateSchedule,
  findActiveDoctor,
  findAppointment,
  findBookingConflict,
  findSlot,
  hospitalDate,
  insertAppointment,
  insertSchedule,
  lockAppointment,
  lockBooking,
  nextToken,
  patientExists,
  peekAppointment,
  setStatus,
  type AppointmentRow,
  type BookingConflict,
} from './scheduling.repo.js';

export interface Actor {
  userId: string;
}

const CONFLICT_MESSAGES: Record<BookingConflict, string> = {
  SLOT_TAKEN: 'This slot has just been booked. Choose another slot.',
  PATIENT_BUSY: 'The patient already has an appointment at this time.',
  ALREADY_BOOKED: 'The patient already has an active appointment with this doctor that day.',
};

const conflict = (code: BookingConflict) => new AppError(409, code, CONFLICT_MESSAGES[code]);
export const appointmentNotFound = () => new AppError(404, 'NOT_FOUND', 'Appointment not found');

/**
 * The second line of defence: if a constraint still fires (for example a row written
 * outside this service), answer with the same conflict codes instead of a 500. A
 * deadlock (40P01) is deliberately not translated: the advisory locks should make it
 * impossible, so it surfaces as an error to investigate.
 */
async function translateConstraints<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    const { code, constraint } = (err ?? {}) as { code?: string; constraint?: string };
    if (code === '23P01' && constraint === 'appointments_no_doctor_overlap') {
      throw conflict('SLOT_TAKEN');
    }
    if (code === '23P01' && constraint === 'appointments_no_patient_overlap') {
      throw conflict('PATIENT_BUSY');
    }
    if (code === '23505' && constraint === 'appointments_patient_doctor_day_active_key') {
      throw conflict('ALREADY_BOOKED');
    }
    throw err;
  }
}

const iso = (v: string | Date) => new Date(v).toISOString();

async function requireDoctor(tx: Queryable, doctorId: string) {
  const doctor = await findActiveDoctor(tx, doctorId);
  if (!doctor) throw new AppError(422, 'UNKNOWN_DOCTOR', 'This doctor is not available.');
  return doctor;
}

/** A real, future, unblocked slot of the doctor; throws otherwise. */
async function requireSlot(tx: Queryable, doctorId: string, slotStart: string) {
  const slot = await findSlot(tx, doctorId, slotStart);
  if (!slot) {
    throw new AppError(422, 'NOT_A_SLOT', "This time is not one of the doctor's slots.");
  }
  if (slot.inPast) throw new AppError(422, 'SLOT_IN_PAST', 'This slot has already started.');
  if (slot.blocked) {
    throw new AppError(409, 'DOCTOR_UNAVAILABLE', 'The doctor is not available at this time.');
  }
  return { ...slot, slotStart: iso(slot.slotStart), slotEnd: iso(slot.slotEnd) };
}

async function loaded(tx: Queryable, id: string): Promise<AppointmentDetail> {
  return (await findAppointment(tx, id))!;
}

export async function createAppointment(
  db: Database,
  input: CreateAppointmentInput,
  actor: Actor,
  context: AuditContext,
): Promise<AppointmentDetail> {
  return translateConstraints(() =>
    withTransaction(db, async (tx) => {
      const doctor = await requireDoctor(tx, input.doctorId);
      if (!(await patientExists(tx, input.patientId))) {
        throw new AppError(422, 'UNKNOWN_PATIENT', 'Patient not found.');
      }
      let id: string;
      if (input.kind === 'walk_in') {
        const today = await hospitalDate(tx);
        await lockBooking(tx, [
          { doctorId: doctor.id, patientId: input.patientId, visitDate: today },
        ]);
        const busy = await tx.query(
          `SELECT 1 FROM appointments WHERE patient_id = $1 AND doctor_id = $2
             AND visit_date = $3::date AND status IN ('booked', 'checked_in', 'in_consultation')`,
          [input.patientId, doctor.id, today],
        );
        if (busy.rowCount) throw conflict('ALREADY_BOOKED');
        id = await insertAppointment(tx, {
          patientId: input.patientId,
          doctorId: doctor.id,
          departmentId: doctor.departmentId,
          scheduleId: null,
          kind: 'walk_in',
          status: 'checked_in',
          visitDate: today,
          slotStart: null,
          slotEnd: null,
          tokenNo: await nextToken(tx, doctor.id, today),
          rescheduledFromId: null,
          userId: actor.userId,
        });
      } else {
        const slot = await requireSlot(tx, doctor.id, input.slotStart);
        const booking = {
          doctorId: doctor.id,
          patientId: input.patientId,
          visitDate: slot.visitDate,
        };
        await lockBooking(tx, [booking]);
        // Rechecked now that every competing booking for this doctor and patient waits.
        const found = await findBookingConflict(tx, { ...booking, ...slot });
        if (found) throw conflict(found);
        id = await insertAppointment(tx, {
          ...booking,
          departmentId: doctor.departmentId,
          scheduleId: slot.scheduleId,
          kind: 'scheduled',
          status: 'booked',
          slotStart: slot.slotStart,
          slotEnd: slot.slotEnd,
          tokenNo: null,
          rescheduledFromId: null,
          userId: actor.userId,
        });
      }
      await recordAudit(
        tx,
        {
          actor: { type: 'user', userId: actor.userId },
          action: 'appointment.created',
          entityType: 'appointment',
          entityId: id,
          patientId: input.patientId,
          changes: { kind: input.kind, doctorId: doctor.id },
        },
        context,
      );
      return loaded(tx, id);
    }),
  );
}

/** Locks the row and checks the state machine; 404 / 409 otherwise. */
async function lockForTransition(
  tx: Queryable,
  id: string,
  to: AppointmentStatus,
): Promise<AppointmentRow> {
  const row = await lockAppointment(tx, id);
  if (!row) throw appointmentNotFound();
  if (!canTransition(row.status, to)) {
    throw new AppError(
      409,
      'INVALID_TRANSITION',
      `A ${row.status.replace('_', ' ')} appointment can't be changed to ${to.replace('_', ' ')}.`,
      { status: row.status },
    );
  }
  return row;
}

async function audited(
  tx: Queryable,
  row: AppointmentRow,
  action: string,
  actor: Actor,
  context: AuditContext,
  changes: Record<string, string | number> = {},
) {
  await recordAudit(
    tx,
    {
      actor: { type: 'user', userId: actor.userId },
      action,
      entityType: 'appointment',
      entityId: row.id,
      patientId: row.patientId,
      changes: { fromStatus: row.status, ...changes },
    },
    context,
  );
}

export async function cancelAppointment(
  db: Database,
  id: string,
  reason: string,
  actor: Actor,
  context: AuditContext,
): Promise<AppointmentDetail> {
  return withTransaction(db, async (tx) => {
    const row = await lockForTransition(tx, id, 'cancelled');
    await setStatus(tx, id, 'cancelled', actor.userId, { cancelReason: reason });
    await audited(tx, row, 'appointment.cancelled', actor, context, { fields: 'cancel_reason' });
    return loaded(tx, id);
  });
}

export async function markNoShow(
  db: Database,
  id: string,
  actor: Actor,
  context: AuditContext,
): Promise<AppointmentDetail> {
  return withTransaction(db, async (tx) => {
    const row = await lockForTransition(tx, id, 'no_show');
    if (row.visitDate > (await hospitalDate(tx))) {
      throw new AppError(409, 'NOT_YET', "A future appointment can't be marked as a no-show.");
    }
    await setStatus(tx, id, 'no_show', actor.userId);
    await audited(tx, row, 'appointment.no_show', actor, context);
    return loaded(tx, id);
  });
}

/** booked → checked_in, with the next token for that doctor and day (gap-free, rolls back). */
export async function checkIn(
  db: Database,
  id: string,
  actor: Actor,
  context: AuditContext,
): Promise<AppointmentDetail> {
  return withTransaction(db, async (tx) => {
    const row = await lockForTransition(tx, id, 'checked_in');
    if (row.visitDate !== (await hospitalDate(tx))) {
      throw new AppError(409, 'NOT_TODAY', 'Only appointments for today can be checked in.');
    }
    const tokenNo = await nextToken(tx, row.doctorId, row.visitDate);
    await setStatus(tx, id, 'checked_in', actor.userId, { tokenNo });
    await audited(tx, row, 'appointment.checked_in', actor, context, {
      // "queueNo": the audit library refuses keys that look like secrets (/token/i).
      queueNo: tokenNo,
    });
    return loaded(tx, id);
  });
}

/**
 * Moves a booked appointment to a new slot in one transaction: the original becomes
 * `rescheduled` and a successor is booked with rescheduled_from_id. If the new slot is
 * unavailable, or anything else fails, the transaction rolls back and the original
 * appointment and its slot are unchanged.
 */
export async function rescheduleAppointment(
  db: Database,
  id: string,
  input: { slotStart: string; doctorId?: string | undefined },
  actor: Actor,
  context: AuditContext,
): Promise<AppointmentDetail> {
  return translateConstraints(() =>
    withTransaction(db, async (tx) => {
      const before = await peekAppointment(tx, id);
      if (!before) throw appointmentNotFound();
      const doctor = await requireDoctor(tx, input.doctorId ?? before.doctorId);
      const slot = await requireSlot(tx, doctor.id, input.slotStart);
      // Advisory locks first (original and target day), then the row: the same order as
      // booking, so a booking and a reschedule never wait on each other in a cycle.
      await lockBooking(tx, [
        { doctorId: before.doctorId, patientId: before.patientId, visitDate: before.visitDate },
        { doctorId: doctor.id, patientId: before.patientId, visitDate: slot.visitDate },
      ]);
      const row = await lockForTransition(tx, id, 'rescheduled');
      if (doctor.id === row.doctorId && row.slotStart && iso(row.slotStart) === slot.slotStart) {
        throw new AppError(409, 'SAME_SLOT', 'The appointment is already in this slot.');
      }
      const found = await findBookingConflict(
        tx,
        { ...slot, doctorId: doctor.id, patientId: row.patientId },
        row.id,
      );
      if (found) throw conflict(found);
      await setStatus(tx, id, 'rescheduled', actor.userId);
      const successorId = await insertAppointment(tx, {
        patientId: row.patientId,
        doctorId: doctor.id,
        departmentId: doctor.departmentId,
        scheduleId: slot.scheduleId,
        kind: 'scheduled',
        status: 'booked',
        visitDate: slot.visitDate,
        slotStart: slot.slotStart,
        slotEnd: slot.slotEnd,
        tokenNo: null,
        rescheduledFromId: row.id,
        userId: actor.userId,
      });
      await audited(tx, row, 'appointment.rescheduled', actor, context, {
        successorId,
        doctorId: doctor.id,
      });
      return loaded(tx, successorId);
    }),
  );
}

export async function createSchedule(
  db: Database,
  doctorId: string,
  input: Omit<DoctorSchedule, 'id' | 'active' | 'doctorId'>,
  actor: Actor,
  context: AuditContext,
): Promise<DoctorSchedule> {
  try {
    return await withTransaction(db, async (tx) => {
      await requireDoctor(tx, doctorId);
      const schedule = await insertSchedule(tx, { ...input, doctorId }, actor.userId);
      await recordAudit(
        tx,
        {
          actor: { type: 'user', userId: actor.userId },
          action: 'schedule.created',
          entityType: 'doctor_schedule',
          entityId: schedule.id,
          changes: { doctorId, weekday: input.weekday },
        },
        context,
      );
      return schedule;
    });
  } catch (err) {
    const { code, constraint } = (err ?? {}) as { code?: string; constraint?: string };
    if (code === '23P01' && constraint === 'doctor_schedules_no_overlap') {
      throw new AppError(
        409,
        'SCHEDULE_OVERLAP',
        "This session overlaps another of the doctor's active sessions.",
      );
    }
    // Only the check this message describes; any other violation stays an unexpected error.
    if (code === '23514' && constraint === 'doctor_schedules_fits_one_slot') {
      throw new AppError(422, 'INVALID_SCHEDULE', 'The session must fit at least one slot.');
    }
    throw err;
  }
}

export async function removeSchedule(
  db: Database,
  doctorId: string,
  scheduleId: string,
  actor: Actor,
  context: AuditContext,
): Promise<DoctorSchedule> {
  return withTransaction(db, async (tx) => {
    const schedule = await deactivateSchedule(tx, doctorId, scheduleId, actor.userId);
    if (!schedule) throw new AppError(404, 'NOT_FOUND', 'Schedule not found');
    await recordAudit(
      tx,
      {
        actor: { type: 'user', userId: actor.userId },
        action: 'schedule.deactivated',
        entityType: 'doctor_schedule',
        entityId: scheduleId,
        changes: { doctorId },
      },
      context,
    );
    return schedule;
  });
}
