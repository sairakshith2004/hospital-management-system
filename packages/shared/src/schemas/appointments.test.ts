import { describe, expect, it } from 'vitest';
import {
  APPOINTMENT_STATUSES,
  appointmentListQuerySchema,
  cancelAppointmentSchema,
  canTransition,
  createAppointmentSchema,
  createScheduleSchema,
  rescheduleAppointmentSchema,
} from './appointments.js';

const ID = '7d3c2a59-2b0c-4a43-9e3b-1d2f0c9a1b23';

describe('appointment request schemas', () => {
  it('accepts a slot booking with an offset and a walk-in without a slot', () => {
    expect(
      createAppointmentSchema.parse({
        kind: 'scheduled',
        patientId: ID,
        doctorId: ID,
        slotStart: '2030-01-07T09:00:00+05:30',
      }),
    ).toMatchObject({ kind: 'scheduled' });
    expect(createAppointmentSchema.parse({ kind: 'walk_in', patientId: ID, doctorId: ID })).toEqual(
      { kind: 'walk_in', patientId: ID, doctorId: ID },
    );
  });

  it('refuses a slot without an offset, a walk-in with a slot, unknown kinds and extra fields', () => {
    const base = { patientId: ID, doctorId: ID };
    for (const body of [
      { ...base, kind: 'scheduled', slotStart: '2030-01-07T09:00:00' },
      { ...base, kind: 'scheduled' },
      { ...base, kind: 'walk_in', slotStart: '2030-01-07T09:00:00+05:30' },
      { ...base, kind: 'follow_up', slotStart: '2030-01-07T09:00:00+05:30' },
      { ...base, kind: 'walk_in', status: 'completed' },
      { kind: 'walk_in', patientId: 'not-a-uuid', doctorId: ID },
    ]) {
      expect(createAppointmentSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it('requires a non-blank cancellation reason of at most 200 characters, trimmed', () => {
    expect(cancelAppointmentSchema.parse({ reason: '  Patient called  ' })).toEqual({
      reason: 'Patient called',
    });
    for (const reason of ['', '   ', 'x'.repeat(201)]) {
      expect(cancelAppointmentSchema.safeParse({ reason }).success).toBe(false);
    }
    expect(cancelAppointmentSchema.safeParse({}).success).toBe(false);
  });

  it('takes a new slot for a reschedule, optionally with another doctor', () => {
    expect(
      rescheduleAppointmentSchema.safeParse({ slotStart: '2030-01-07T10:00:00+05:30' }).success,
    ).toBe(true);
    expect(rescheduleAppointmentSchema.safeParse({ doctorId: ID }).success).toBe(false);
  });

  it('validates list filters', () => {
    expect(appointmentListQuerySchema.safeParse({ date: '2030-01-07' }).success).toBe(true);
    expect(appointmentListQuerySchema.safeParse({ date: '07/01/2030' }).success).toBe(false);
    expect(
      appointmentListQuerySchema.safeParse({ date: '2030-01-07', status: 'deleted' }).success,
    ).toBe(false);
  });

  it('checks weekly sessions: weekday 1–7, start before end, slot 5–120 minutes', () => {
    const ok = {
      weekday: 1,
      startTime: '09:00',
      endTime: '12:00',
      slotMinutes: 15,
      validFrom: '2030-01-01',
    };
    expect(createScheduleSchema.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok, weekday: 0 },
      { ...ok, weekday: 8 },
      { ...ok, endTime: '09:00' },
      { ...ok, startTime: '24:00' },
      { ...ok, slotMinutes: 4 },
      { ...ok, slotMinutes: 121 },
      { ...ok, validTo: '2029-12-31' },
    ]) {
      expect(createScheduleSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('appointment state machine', () => {
  it('ends in completed, cancelled, no_show and rescheduled', () => {
    for (const to of APPOINTMENT_STATUSES) {
      for (const from of ['completed', 'cancelled', 'no_show', 'rescheduled'] as const) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });
});
