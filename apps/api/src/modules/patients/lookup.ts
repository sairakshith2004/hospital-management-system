/**
 * Department lookups by patient number (pharmacy, lab, billing). The caller's route has
 * already checked the department permission; this finds the patient and writes
 * `patient.lookup` before anything is returned (if the audit write fails, nothing is).
 * Only identifiers come back here: each department adds its own narrow records.
 */
import { normalizeMrn, type PatientIdentity } from '@hospitalos/shared';
import type { Request, Response } from 'express';
import type { Database } from '../../db/client.js';
import { auditContext, recordAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { requireUser } from '../../middleware/auth.js';

export type LookupDepartment = 'pharmacy' | 'lab' | 'billing';

const notFound = () => new AppError(404, 'NOT_FOUND', 'No patient has this patient number');

export async function lookupPatientByMrn(
  db: Database,
  req: Request,
  res: Response,
  department: LookupDepartment,
): Promise<PatientIdentity> {
  const mrn = normalizeMrn(String(req.params.mrn ?? ''));
  if (!mrn) throw notFound();
  const { rows } = await db.query<PatientIdentity>(
    `SELECT id, mrn, first_name AS "firstName", last_name AS "lastName", dob::text AS dob, sex
     FROM patients WHERE mrn = $1`,
    [mrn],
  );
  const patient = rows[0];
  if (!patient) throw notFound();
  await recordAudit(
    db,
    {
      actor: { type: 'user', userId: requireUser(res).id },
      action: 'patient.lookup',
      entityType: 'patient',
      entityId: patient.id,
      patientId: patient.id,
      changes: { department },
    },
    auditContext(req, res),
  );
  return patient;
}
