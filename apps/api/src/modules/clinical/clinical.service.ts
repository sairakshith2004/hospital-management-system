/**
 * Consultation writes. A doctor works only in their own encounters (anything else is
 * answered like a missing record), every change and its audit row commit together, and
 * the database triggers (migration 0012) refuse edits after completion as a second line.
 */
import {
  hospitalToday,
  type PermissionCode,
  type PrescriptionInput,
  type VitalsInput,
} from '@hospitalos/shared';
import { withTransaction, type Database, type Queryable } from '../../db/client.js';
import { recordAudit, type AuditContext } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { doctorIdOfUser } from '../scheduling/scheduling.repo.js';
import { forbidden, hasCareRelationship } from './access.js';
import { lockEncounter, type EncounterRow } from './clinical.repo.js';

export interface Actor {
  userId: string;
  can(permission: PermissionCode): boolean;
}

const notFound = (what = 'Encounter') => new AppError(404, 'NOT_FOUND', `${what} not found`);

async function audit(
  tx: Queryable,
  actor: Actor,
  context: AuditContext,
  e: {
    action: string;
    entityType: string;
    entityId: string;
    patientId: string;
    changes?: Record<string, string | number | boolean | null | string[]>;
    reason?: string;
  },
) {
  await recordAudit(tx, { actor: { type: 'user', userId: actor.userId }, ...e }, context);
}

async function myDoctorId(db: Queryable, actor: Actor): Promise<string> {
  const id = await doctorIdOfUser(db, actor.userId);
  if (!id) throw forbidden();
  return id;
}

/** The caller's own encounter, locked; open unless `allowCompleted`. */
async function ownEncounter(
  tx: Queryable,
  id: string,
  doctorId: string,
  allowCompleted = false,
): Promise<EncounterRow> {
  const e = await lockEncounter(tx, id);
  if (!e || e.doctorId !== doctorId) throw notFound();
  if (e.status !== 'in_progress' && !allowCompleted) {
    throw new AppError(
      409,
      'ENCOUNTER_COMPLETED',
      'This consultation is completed. Add an addendum instead.',
    );
  }
  return e;
}

/** checked_in → in_consultation and a new encounter; returns the existing one if already started. */
export async function startEncounter(
  db: Database,
  appointmentId: string,
  chiefComplaint: string | null,
  actor: Actor,
  context: AuditContext,
): Promise<string> {
  return withTransaction(db, async (tx) => {
    const doctorId = await myDoctorId(tx, actor);
    const { rows } = await tx.query<{
      id: string;
      patientId: string;
      doctorId: string;
      departmentId: string;
      status: string;
    }>(
      `SELECT id, patient_id AS "patientId", doctor_id AS "doctorId", department_id AS "departmentId", status
       FROM appointments WHERE id = $1 FOR UPDATE`,
      [appointmentId],
    );
    const a = rows[0];
    if (!a || a.doctorId !== doctorId) throw notFound('Appointment');
    const existing = await tx.query<{ id: string }>(
      'SELECT id FROM encounters WHERE appointment_id = $1',
      [a.id],
    );
    if (existing.rows[0]) return existing.rows[0].id;
    if (a.status !== 'checked_in') {
      throw new AppError(
        409,
        'NOT_CHECKED_IN',
        'The patient must be checked in before the consultation starts.',
      );
    }
    await tx.query(
      `UPDATE appointments SET status = 'in_consultation', consult_started_at = now(), updated_by = $2 WHERE id = $1`,
      [a.id, actor.userId],
    );
    const { rows: enc } = await tx.query<{ id: string }>(
      `INSERT INTO encounters (appointment_id, patient_id, doctor_id, department_id, chief_complaint, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
      [a.id, a.patientId, doctorId, a.departmentId, chiefComplaint, actor.userId],
    );
    await audit(tx, actor, context, {
      action: 'encounter.started',
      entityType: 'encounter',
      entityId: enc[0]!.id,
      patientId: a.patientId,
    });
    return enc[0]!.id;
  });
}

export async function addNote(
  db: Database,
  encounterId: string,
  input: { kind: 'symptoms' | 'observation' | 'plan' | 'addendum'; body: string },
  actor: Actor,
  context: AuditContext,
) {
  return withTransaction(db, async (tx) => {
    const e = await ownEncounter(
      tx,
      encounterId,
      await myDoctorId(tx, actor),
      input.kind === 'addendum',
    );
    const { rows } = await tx.query<{ id: string }>(
      'INSERT INTO clinical_notes (encounter_id, kind, body, author_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [e.id, input.kind, input.body, actor.userId],
    );
    await audit(tx, actor, context, {
      action: 'clinical_note.created',
      entityType: 'encounter',
      entityId: e.id,
      patientId: e.patientId,
      changes: { kind: input.kind },
    });
    return rows[0]!.id;
  });
}

export async function addDiagnosis(
  db: Database,
  encounterId: string,
  input: { description: string; code?: string | null | undefined; isPrimary: boolean },
  actor: Actor,
  context: AuditContext,
) {
  return withTransaction(db, async (tx) => {
    const e = await ownEncounter(tx, encounterId, await myDoctorId(tx, actor));
    if (input.isPrimary) {
      await tx.query(
        'UPDATE diagnoses SET is_primary = false WHERE encounter_id = $1 AND is_primary',
        [e.id],
      );
    }
    await tx.query(
      'INSERT INTO diagnoses (encounter_id, description, code, is_primary, created_by) VALUES ($1, $2, $3, $4, $5)',
      [e.id, input.description, input.code ?? null, input.isPrimary, actor.userId],
    );
    await audit(tx, actor, context, {
      action: 'diagnosis.created',
      entityType: 'encounter',
      entityId: e.id,
      patientId: e.patientId,
      changes: { fields: ['description', 'code', 'is_primary'] },
    });
  });
}

/**
 * The visit's doctor, or (triage) anyone with vitals:record for a patient checked in today.
 * Nurse session assignments are not part of the MVP, so triage is limited to today's
 * checked-in visits and gives no read access to the chart.
 */
export async function recordVitals(
  db: Database,
  appointmentId: string,
  input: VitalsInput,
  actor: Actor,
  context: AuditContext,
) {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{
      patientId: string;
      doctorId: string;
      status: string;
      visitDate: string;
    }>(
      `SELECT patient_id AS "patientId", doctor_id AS "doctorId", status, visit_date::text AS "visitDate"
       FROM appointments WHERE id = $1 FOR SHARE`,
      [appointmentId],
    );
    const a = rows[0];
    if (!a) throw notFound('Appointment');
    const doctorId = await doctorIdOfUser(tx, actor.userId);
    const ownVisit =
      doctorId === a.doctorId && ['checked_in', 'in_consultation'].includes(a.status);
    const triage =
      a.visitDate === hospitalToday() && ['checked_in', 'in_consultation'].includes(a.status);
    if (!ownVisit && !triage) {
      if (doctorId && doctorId !== a.doctorId) throw notFound('Appointment');
      throw new AppError(
        409,
        'NOT_CHECKED_IN',
        'Vital signs are recorded for checked-in patients.',
      );
    }
    const { rows: v } = await tx.query<{ id: string }>(
      `INSERT INTO vital_signs (appointment_id, patient_id, recorded_by, temp_c, pulse, bp_sys, bp_dia, resp_rate, spo2, weight_kg, height_cm)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [
        appointmentId,
        a.patientId,
        actor.userId,
        input.tempC ?? null,
        input.pulse ?? null,
        input.bpSys ?? null,
        input.bpDia ?? null,
        input.respRate ?? null,
        input.spo2 ?? null,
        input.weightKg ?? null,
        input.heightCm ?? null,
      ],
    );
    await audit(tx, actor, context, {
      action: 'vitals.recorded',
      entityType: 'appointment',
      entityId: appointmentId,
      patientId: a.patientId,
    });
    return v[0]!.id;
  });
}

/** Only the person who recorded it, or the visit's doctor, can flag a reading. */
export async function flagVitals(
  db: Database,
  vitalsId: string,
  actor: Actor,
  context: AuditContext,
) {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{
      patientId: string;
      recordedBy: string;
      doctorId: string;
      appointmentId: string;
    }>(
      `SELECT v.patient_id AS "patientId", v.recorded_by AS "recordedBy", a.doctor_id AS "doctorId", v.appointment_id AS "appointmentId"
       FROM vital_signs v JOIN appointments a ON a.id = v.appointment_id WHERE v.id = $1 FOR UPDATE OF v`,
      [vitalsId],
    );
    const v = rows[0];
    if (!v) throw notFound('Reading');
    const doctorId = await doctorIdOfUser(tx, actor.userId);
    if (v.recordedBy !== actor.userId && doctorId !== v.doctorId) throw notFound('Reading');
    await tx.query('UPDATE vital_signs SET entered_in_error = true WHERE id = $1', [vitalsId]);
    await audit(tx, actor, context, {
      action: 'vitals.entered_in_error',
      entityType: 'appointment',
      entityId: v.appointmentId,
      patientId: v.patientId,
    });
  });
}

async function requireCare(tx: Queryable, actor: Actor, patientId: string) {
  const doctorId = await myDoctorId(tx, actor);
  if (!(await hasCareRelationship(tx, doctorId, patientId, actor.userId))) throw forbidden();
  return doctorId;
}

export async function addAllergy(
  db: Database,
  patientId: string,
  input: {
    substance: string;
    ingredientId?: string | null | undefined;
    reaction?: string | null | undefined;
    severity: string;
  },
  actor: Actor,
  context: AuditContext,
) {
  return withTransaction(db, async (tx) => {
    await requireCare(tx, actor, patientId);
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO allergies (patient_id, substance, ingredient_id, reaction, severity, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
      [
        patientId,
        input.substance,
        input.ingredientId ?? null,
        input.reaction ?? null,
        input.severity,
        actor.userId,
      ],
    );
    await audit(tx, actor, context, {
      action: 'allergy.recorded',
      entityType: 'allergy',
      entityId: rows[0]!.id,
      patientId,
    });
    return rows[0]!.id;
  });
}

export async function deactivateAllergy(
  db: Database,
  allergyId: string,
  actor: Actor,
  context: AuditContext,
) {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ patientId: string }>(
      'SELECT patient_id AS "patientId" FROM allergies WHERE id = $1 FOR UPDATE',
      [allergyId],
    );
    if (!rows[0]) throw notFound('Allergy');
    await requireCare(tx, actor, rows[0].patientId);
    await tx.query(`UPDATE allergies SET status = 'inactive', updated_by = $2 WHERE id = $1`, [
      allergyId,
      actor.userId,
    ]);
    await audit(tx, actor, context, {
      action: 'allergy.deactivated',
      entityType: 'allergy',
      entityId: allergyId,
      patientId: rows[0].patientId,
    });
  });
}

export async function recommendFollowUp(
  db: Database,
  encounterId: string,
  input: {
    reason: string;
    instructions?: string | null | undefined;
    dueFrom: string;
    dueTo: string;
    targetDoctorId?: string | null | undefined;
  },
  actor: Actor,
  context: AuditContext,
) {
  return withTransaction(db, async (tx) => {
    const doctorId = await myDoctorId(tx, actor);
    const e = await ownEncounter(tx, encounterId, doctorId);
    if (input.dueTo < hospitalToday())
      throw new AppError(422, 'IN_PAST', 'The follow-up window has already passed.');
    const target = input.targetDoctorId ?? doctorId;
    const doc = await tx.query('SELECT 1 FROM doctor_profiles WHERE id = $1 AND active', [target]);
    if (!doc.rowCount) throw new AppError(422, 'UNKNOWN_DOCTOR', 'Doctor not found.');
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO follow_ups (patient_id, source_encounter_id, recommended_by, target_doctor_id, reason, instructions, due_from, due_to, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $3, $3) RETURNING id`,
      [
        e.patientId,
        e.id,
        actor.userId,
        target,
        input.reason,
        input.instructions ?? null,
        input.dueFrom,
        input.dueTo,
      ],
    );
    await audit(tx, actor, context, {
      action: 'follow_up.recommended',
      entityType: 'follow_up',
      entityId: rows[0]!.id,
      patientId: e.patientId,
    });
    return rows[0]!.id;
  });
}

export async function setFollowUpStatus(
  db: Database,
  id: string,
  status: 'booked' | 'completed' | 'cancelled',
  actor: Actor,
  context: AuditContext,
) {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ patientId: string; status: string }>(
      'SELECT patient_id AS "patientId", status FROM follow_ups WHERE id = $1 FOR UPDATE',
      [id],
    );
    const f = rows[0];
    if (!f) throw notFound('Follow-up');
    const allowed: Record<string, string[]> = {
      pending: ['booked', 'cancelled'],
      booked: ['completed', 'cancelled', 'pending'],
    };
    if (!allowed[f.status]?.includes(status)) {
      throw new AppError(
        409,
        'INVALID_TRANSITION',
        `A ${f.status} follow-up can't become ${status}.`,
      );
    }
    await tx.query('UPDATE follow_ups SET status = $2, updated_by = $3 WHERE id = $1', [
      id,
      status,
      actor.userId,
    ]);
    await audit(tx, actor, context, {
      action: 'follow_up.status_changed',
      entityType: 'follow_up',
      entityId: id,
      patientId: f.patientId,
      changes: { from: f.status, to: status },
    });
  });
}

/**
 * Issues a prescription in the doctor's open encounter. Each medicine must be an active
 * catalogue product. If the patient has an active allergy to one of its ingredients, the
 * request is refused (409 ALLERGY_CONFLICT) until the prescriber acknowledges it.
 */
export async function createPrescription(
  db: Database,
  encounterId: string,
  input: PrescriptionInput,
  actor: Actor,
  context: AuditContext,
): Promise<string> {
  const ids = input.items.map((i) => i.medicineProductId);
  if (new Set(ids).size !== ids.length) {
    throw new AppError(
      422,
      'DUPLICATE_MEDICINE',
      'Each medicine can appear only once; adjust the quantity instead.',
    );
  }
  return withTransaction(db, async (tx) => {
    const doctorId = await myDoctorId(tx, actor);
    const e = await ownEncounter(tx, encounterId, doctorId);
    const found = await tx.query(
      `SELECT m.stock_item_id FROM medicine_products m JOIN stock_items s ON s.id = m.stock_item_id
       WHERE m.stock_item_id = ANY($1::uuid[]) AND s.active`,
      [ids],
    );
    if (found.rowCount !== ids.length)
      throw new AppError(422, 'UNKNOWN_MEDICINE', 'A medicine was not found in the catalogue.');
    const { rows: conflicts } = await tx.query<{ substance: string; product: string }>(
      `SELECT DISTINCT a.substance, s.name AS product
       FROM allergies a
       JOIN product_ingredients pi ON pi.product_id = ANY($2::uuid[])
       JOIN ingredients i ON i.id = pi.ingredient_id
       JOIN stock_items s ON s.id = pi.product_id
       WHERE a.patient_id = $1 AND a.status = 'active'
         AND (a.ingredient_id = pi.ingredient_id OR lower(trim(a.substance)) = lower(i.name::text))`,
      [e.patientId, ids],
    );
    if (conflicts.length > 0 && !input.allergyAcknowledged) {
      throw new AppError(
        409,
        'ALLERGY_CONFLICT',
        `The patient has a recorded allergy that matches: ${conflicts.map((c) => `${c.product} (${c.substance})`).join(', ')}. Review before prescribing.`,
        { conflicts },
      );
    }
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO prescriptions (encounter_id, patient_id, doctor_id, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
      [e.id, e.patientId, doctorId, input.notes ?? null, actor.userId],
    );
    const rxId = rows[0]!.id;
    for (const item of input.items) {
      await tx.query(
        `INSERT INTO prescription_items (prescription_id, medicine_product_id, dose, frequency, route, duration_days, qty_prescribed, instructions)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          rxId,
          item.medicineProductId,
          item.dose,
          item.frequency,
          item.route,
          item.durationDays ?? null,
          item.qtyPrescribed,
          item.instructions ?? null,
        ],
      );
    }
    await audit(tx, actor, context, {
      action: 'prescription.created',
      entityType: 'prescription',
      entityId: rxId,
      patientId: e.patientId,
      changes: { items: input.items.length, allergyAcknowledged: conflicts.length > 0 },
    });
    return rxId;
  });
}

export async function cancelPrescription(
  db: Database,
  id: string,
  reason: string,
  actor: Actor,
  context: AuditContext,
) {
  return withTransaction(db, async (tx) => {
    const doctorId = await myDoctorId(tx, actor);
    const { rows } = await tx.query<{ doctorId: string; patientId: string; status: string }>(
      'SELECT doctor_id AS "doctorId", patient_id AS "patientId", status FROM prescriptions WHERE id = $1 FOR UPDATE',
      [id],
    );
    const rx = rows[0];
    if (!rx || rx.doctorId !== doctorId) throw notFound('Prescription');
    if (rx.status !== 'issued') {
      throw new AppError(
        409,
        'INVALID_TRANSITION',
        'Only a prescription nothing has been dispensed from can be cancelled.',
      );
    }
    await tx.query(
      `UPDATE prescriptions SET status = 'cancelled', cancel_reason = $2, updated_by = $3 WHERE id = $1`,
      [id, reason, actor.userId],
    );
    await audit(tx, actor, context, {
      action: 'prescription.cancelled',
      entityType: 'prescription',
      entityId: id,
      patientId: rx.patientId,
      changes: { fields: 'cancel_reason' },
    });
  });
}

/** in_progress → completed; the visit becomes completed in the same transaction. */
export async function completeEncounter(
  db: Database,
  encounterId: string,
  actor: Actor,
  context: AuditContext,
) {
  return withTransaction(db, async (tx) => {
    const e = await ownEncounter(tx, encounterId, await myDoctorId(tx, actor));
    await tx.query(
      `UPDATE encounters SET status = 'completed', completed_at = now(), updated_by = $2 WHERE id = $1`,
      [e.id, actor.userId],
    );
    await tx.query(
      `UPDATE appointments SET status = 'completed', completed_at = now(), updated_by = $2 WHERE id = $1 AND status = 'in_consultation'`,
      [e.appointmentId, actor.userId],
    );
    await audit(tx, actor, context, {
      action: 'encounter.completed',
      entityType: 'encounter',
      entityId: e.id,
      patientId: e.patientId,
    });
  });
}
