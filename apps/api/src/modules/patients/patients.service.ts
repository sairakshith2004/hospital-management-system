/**
 * Registration and demographic edits (PR-1 to PR-4). Each write and its audit row commit
 * together (fail closed). Audit rows carry field names only, never the values.
 */
import type { Patient } from '@hospitalos/shared';
import { withTransaction, type Database } from '../../db/client.js';
import { recordAudit, type AuditContext } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import {
  PATIENT_FIELDS,
  findDuplicateCandidates,
  findPatient,
  insertPatient,
  lockIdentity,
  updatePatient,
  type PatientField,
  type PatientValues,
} from './patients.repo.js';

export interface Actor {
  userId: string;
}

function toValues(input: Partial<Record<PatientField, string | null | undefined>>): PatientValues {
  const values = {} as PatientValues;
  for (const field of Object.keys(PATIENT_FIELDS) as PatientField[]) {
    values[field] = input[field] ?? null;
  }
  return values;
}

export async function registerPatient(
  db: Database,
  input: Partial<Record<PatientField, string | null | undefined>> & { confirmDuplicate?: boolean },
  actor: Actor,
  context: AuditContext,
): Promise<Patient> {
  const values = toValues(input);
  return withTransaction(db, async (tx) => {
    await lockIdentity(tx, values.phone!, values.dob!);
    const candidates = await findDuplicateCandidates(tx, values.phone!, values.dob!);
    if (candidates.length > 0 && !input.confirmDuplicate) {
      throw new AppError(
        409,
        'DUPLICATE_SUSPECTED',
        'A patient with the same phone number and date of birth is already registered.',
        { candidates },
      );
    }
    const patient = await insertPatient(tx, values, actor.userId);
    await recordAudit(
      tx,
      {
        actor: { type: 'user', userId: actor.userId },
        action: 'patient.created',
        entityType: 'patient',
        entityId: patient.id,
        patientId: patient.id,
        ...(candidates.length > 0 ? { reason: 'duplicate_confirmed' } : {}),
      },
      context,
    );
    return patient;
  });
}

export async function editPatient(
  db: Database,
  id: string,
  input: Partial<Record<PatientField, string | null | undefined>> & { version: number },
  actor: Actor,
  context: AuditContext,
): Promise<Patient> {
  const values = toValues(input);
  return withTransaction(db, async (tx) => {
    const current = await findPatient(tx, id, { forUpdate: true });
    if (!current) throw new AppError(404, 'NOT_FOUND', 'Patient not found');
    if (current.version !== input.version) {
      throw new AppError(
        409,
        'STALE_VERSION',
        'This patient was changed by someone else. Reload to see the latest details.',
        { currentVersion: current.version },
      );
    }
    const changed = (Object.keys(PATIENT_FIELDS) as PatientField[]).filter(
      (field) => (current[field] ?? null) !== values[field],
    );
    if (changed.length === 0) return current;
    const updated = await updatePatient(tx, id, values, actor.userId);
    await recordAudit(
      tx,
      {
        actor: { type: 'user', userId: actor.userId },
        action: 'patient.updated',
        entityType: 'patient',
        entityId: id,
        patientId: id,
        changes: { fields: changed },
      },
      context,
    );
    return updated;
  });
}
