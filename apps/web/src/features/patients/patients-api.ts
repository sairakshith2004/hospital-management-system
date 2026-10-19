import type {
  CreatePatientInput,
  Patient,
  PatientSummary,
  UpdatePatientInput,
} from '@hospitalos/shared';
import { apiFetch } from '../../lib/api';

export const patientKeys = {
  all: ['patients'] as const,
  search: (q: string) => ['patients', 'search', q] as const,
  detail: (id: string) => ['patients', 'detail', id] as const,
};

export async function searchPatients(q: string, signal?: AbortSignal): Promise<PatientSummary[]> {
  const res = await apiFetch<{ patients: PatientSummary[] }>(
    `/api/patients?q=${encodeURIComponent(q)}`,
    { signal },
  );
  return res.patients;
}

export async function getPatient(id: string, signal?: AbortSignal): Promise<Patient> {
  const res = await apiFetch<{ patient: Patient }>(`/api/patients/${encodeURIComponent(id)}`, {
    signal,
  });
  return res.patient;
}

export async function createPatient(input: CreatePatientInput): Promise<Patient> {
  const res = await apiFetch<{ patient: Patient }>('/api/patients', {
    method: 'POST',
    body: input,
  });
  return res.patient;
}

export async function updatePatient(id: string, input: UpdatePatientInput): Promise<Patient> {
  const res = await apiFetch<{ patient: Patient }>(`/api/patients/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input,
  });
  return res.patient;
}
