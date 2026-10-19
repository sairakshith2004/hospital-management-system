/**
 * Who may see a patient's clinical record (docs/permissions.md §3). Fail closed:
 *   - a doctor with a care relationship (§3.1): an active appointment with them from today
 *     up to care_window_before_days ahead, an open encounter, an encounter completed
 *     within care_window_after_days, a pending or booked follow-up targeting them, or a
 *     lab order of theirs verified within care_window_after_days;
 *   - the Super Admin (the hospital's chief executive, docs/permissions.md note 13), for any
 *     patient, audited with `access: executive`;
 *   - nobody else here. Nurse session assignments (§3.2) and emergency access (§4) are not
 *     part of the MVP, so other roles see clinical data only through the narrow views of
 *     their own modules (pharmacy prescriptions, lab orders).
 * Every clinical read writes `patient.clinical.read` first; if that write fails, nothing
 * is returned. A refusal is a generic 403 with an `access.denied` audit row.
 */
import type { Request, Response } from 'express';
import type { Database, Queryable } from '../../db/client.js';
import { auditContext, recordAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { requireUser } from '../../middleware/auth.js';
import { doctorIdOfUser } from '../scheduling/scheduling.repo.js';

export const forbidden = () =>
  new AppError(403, 'FORBIDDEN', 'You do not have permission to do this');

export async function hasCareRelationship(
  db: Queryable,
  doctorId: string,
  patientId: string,
  userId: string,
) {
  const { rows } = await db.query<{ ok: boolean }>(
    `WITH s AS (SELECT care_window_before_days AS before, care_window_after_days AS after,
                       (now() AT TIME ZONE 'Asia/Kolkata')::date AS today
                FROM hospital_settings WHERE id = 1)
     SELECT EXISTS (
       SELECT 1 FROM appointments a, s WHERE a.patient_id = $2 AND a.doctor_id = $1
         AND a.status IN ('booked', 'checked_in', 'in_consultation')
         AND a.visit_date BETWEEN s.today AND s.today + s.before
     ) OR EXISTS (
       SELECT 1 FROM encounters e, s WHERE e.patient_id = $2 AND e.doctor_id = $1
         AND (e.status = 'in_progress' OR e.completed_at >= now() - make_interval(days => s.after))
     ) OR EXISTS (
       SELECT 1 FROM follow_ups f WHERE f.patient_id = $2 AND f.target_doctor_id = $1
         AND f.status IN ('pending', 'booked')
     ) OR EXISTS (
       SELECT 1 FROM lab_orders o, s WHERE o.patient_id = $2 AND o.ordered_by = $3
         AND o.verified_at >= now() - make_interval(days => s.after)
     ) AS ok`,
    [doctorId, patientId, userId],
  );
  return rows[0]?.ok === true;
}

async function deny(db: Database, req: Request, res: Response, patientId: string): Promise<never> {
  await recordAudit(
    db,
    {
      actor: { type: 'user', userId: requireUser(res).id },
      action: 'access.denied',
      entityType: 'patient',
      entityId: patientId,
      patientId,
      reason: 'no_care_relationship',
    },
    auditContext(req, res),
  );
  throw forbidden();
}

/**
 * Allows a clinical read of `patientId` (or refuses with 403), then records it.
 * Returns the caller's doctor profile id, or null for the Super Admin's executive access.
 */
export async function authorizeClinicalRead(
  db: Database,
  req: Request,
  res: Response,
  patientId: string,
  what: string,
): Promise<string | null> {
  const user = requireUser(res);
  if (!user.can('patient:read_clinical')) return deny(db, req, res, patientId);
  if (user.roles.includes('SA')) {
    await recordAudit(
      db,
      {
        actor: { type: 'user', userId: user.id },
        action: 'patient.clinical.read',
        entityType: 'patient',
        entityId: patientId,
        patientId,
        changes: { view: what, access: 'executive' },
      },
      auditContext(req, res),
    );
    return null;
  }
  const doctorId = await doctorIdOfUser(db, user.id);
  if (!doctorId || !(await hasCareRelationship(db, doctorId, patientId, user.id))) {
    return deny(db, req, res, patientId);
  }
  await recordAudit(
    db,
    {
      actor: { type: 'user', userId: user.id },
      action: 'patient.clinical.read',
      entityType: 'patient',
      entityId: patientId,
      patientId,
      changes: { view: what },
    },
    auditContext(req, res),
  );
  return doctorId;
}
