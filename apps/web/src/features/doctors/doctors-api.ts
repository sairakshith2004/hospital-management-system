import type { DoctorListItem } from '@hospitalos/shared';
import { apiFetch } from '../../lib/api';

export async function listDoctors(signal?: AbortSignal): Promise<DoctorListItem[]> {
  return (await apiFetch<{ doctors: DoctorListItem[] }>('/api/doctors', { signal })).doctors;
}
