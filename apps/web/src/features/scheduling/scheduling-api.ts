import type {
  AppointmentDetail,
  AppointmentStatus,
  AppointmentSummary,
  AvailabilitySlot,
  CreateAppointmentInput,
  DoctorSchedule,
} from '@hospitalos/shared';
import { apiFetch } from '../../lib/api';

export const schedulingKeys = {
  all: ['scheduling'] as const,
  appointments: (date: string, doctorId?: string, status?: string) =>
    ['scheduling', 'appointments', date, doctorId ?? '', status ?? ''] as const,
  appointment: (id: string) => ['scheduling', 'appointment', id] as const,
  queue: (date: string, doctorId?: string) =>
    ['scheduling', 'queue', date, doctorId ?? ''] as const,
  availability: (doctorId: string, date: string) =>
    ['scheduling', 'availability', doctorId, date] as const,
  schedules: (doctorId: string) => ['scheduling', 'schedules', doctorId] as const,
};

const qs = (params: Record<string, string | undefined>) => {
  const entries = Object.entries(params).filter((e): e is [string, string] => !!e[1]);
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : '';
};
const enc = encodeURIComponent;

export async function listAppointments(
  f: { date: string; doctorId?: string; status?: AppointmentStatus },
  signal?: AbortSignal,
): Promise<AppointmentSummary[]> {
  return (
    await apiFetch<{ appointments: AppointmentSummary[] }>(`/api/appointments${qs(f)}`, { signal })
  ).appointments;
}

export async function getAppointment(id: string, signal?: AbortSignal) {
  return (
    await apiFetch<{ appointment: AppointmentDetail }>(`/api/appointments/${enc(id)}`, { signal })
  ).appointment;
}

export async function getQueue(f: { date?: string; doctorId?: string }, signal?: AbortSignal) {
  return apiFetch<{ date: string; queue: AppointmentSummary[] }>(`/api/queue${qs(f)}`, { signal });
}

export async function getAvailability(doctorId: string, date: string, signal?: AbortSignal) {
  return (
    await apiFetch<{ slots: AvailabilitySlot[] }>(
      `/api/doctors/${enc(doctorId)}/availability${qs({ date })}`,
      { signal },
    )
  ).slots;
}

export async function listSchedules(doctorId: string, signal?: AbortSignal) {
  return (
    await apiFetch<{ schedules: DoctorSchedule[] }>(`/api/doctors/${enc(doctorId)}/schedules`, {
      signal,
    })
  ).schedules;
}

export async function createAppointment(input: CreateAppointmentInput) {
  return (
    await apiFetch<{ appointment: AppointmentDetail }>('/api/appointments', {
      method: 'POST',
      body: input,
    })
  ).appointment;
}

const action = (id: string, verb: string, body: object = {}) =>
  apiFetch<{ appointment: AppointmentDetail }>(`/api/appointments/${enc(id)}/${verb}`, {
    method: 'POST',
    body,
  }).then((r) => r.appointment);

export const checkIn = (id: string) => action(id, 'check-in');
export const markNoShow = (id: string) => action(id, 'no-show');
export const cancelAppointment = (id: string, reason: string) => action(id, 'cancel', { reason });
export const rescheduleAppointment = (id: string, slotStart: string, doctorId?: string) =>
  action(id, 'reschedule', doctorId ? { slotStart, doctorId } : { slotStart });
