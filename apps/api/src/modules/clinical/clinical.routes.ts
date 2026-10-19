/**
 * Consultations (all doctor-scoped; see access.ts and clinical.service.ts):
 *   POST /api/appointments/:id/encounter        encounter:write      start (checked_in → in_consultation)
 *   GET  /api/appointments/:id/encounter        patient:read_clinical (care relationship; audited read)
 *   POST /api/appointments/:id/vitals           vitals:record        visit's doctor, or triage today
 *   GET  /api/encounters/mine                   encounter:write      my open consultations
 *   GET  /api/encounters/:id                    patient:read_clinical (care relationship; audited read)
 *   POST /api/encounters/:id/notes              encounter:write      (addenda after completion)
 *   POST /api/encounters/:id/diagnoses          encounter:write
 *   POST /api/encounters/:id/follow-ups         followup:recommend
 *   POST /api/encounters/:id/prescriptions      prescription:create
 *   POST /api/encounters/:id/complete           encounter:write
 *   POST /api/vitals/:id/entered-in-error       vitals:record
 *   GET  /api/patients/:id/chart?scope=mine|all patient:read_clinical (care relationship; audited read).
 *                                               mine (default): only this doctor's records; all: every
 *                                               doctor's ("previous reports", audited as chart:all_doctors)
 *   POST /api/patients/:id/allergies            allergy:record (care relationship)
 *   POST /api/allergies/:id/deactivate          allergy:record (care relationship)
 *   POST /api/prescriptions/:id/cancel          prescription:cancel (prescriber, nothing dispensed)
 *   GET  /api/follow-ups?status=                followup:schedule | appointment:read_all
 *   POST /api/follow-ups/:id/status             followup:schedule
 */
import {
  CHART_SCOPES,
  allergySchema,
  cancelPrescriptionSchema,
  diagnosisSchema,
  followUpSchema,
  followUpStatusSchema,
  noteSchema,
  prescriptionSchema,
  startEncounterSchema,
  vitalsSchema,
} from '@hospitalos/shared';
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { Database } from '../../db/client.js';
import { auditContext } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { requireAnyPermission, requirePermission, requireUser } from '../../middleware/auth.js';
import { doctorIdOfUser } from '../scheduling/scheduling.repo.js';
import { authorizeClinicalRead } from './access.js';
import { findEncounter, findPatientChart } from './clinical.repo.js';
import {
  addAllergy,
  addDiagnosis,
  addNote,
  cancelPrescription,
  completeEncounter,
  createPrescription,
  deactivateAllergy,
  flagVitals,
  recommendFollowUp,
  recordVitals,
  setFollowUpStatus,
  startEncounter,
  type Actor,
} from './clinical.service.js';

const uuid = (value: unknown, what = 'Record') => {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new AppError(404, 'NOT_FOUND', `${what} not found`);
  return parsed.data;
};
const actorOf = (res: Response): Actor => {
  const user = requireUser(res);
  return { userId: user.id, can: (p) => user.can(p) };
};

export function clinicalRoutes(db: Database): Router {
  const router = Router();
  const canWrite = requirePermission(db, 'encounter:write');
  const canRead = requirePermission(db, 'patient:read_clinical');

  async function encounterOr404(id: string) {
    const e = await findEncounter(db, id);
    if (!e) throw new AppError(404, 'NOT_FOUND', 'Encounter not found');
    return e;
  }

  router.post('/appointments/:id/encounter', canWrite, async (req, res) => {
    const { chiefComplaint } = startEncounterSchema.parse(req.body ?? {});
    const id = await startEncounter(
      db,
      uuid(req.params.id, 'Appointment'),
      chiefComplaint ?? null,
      actorOf(res),
      auditContext(req, res),
    );
    res.status(201).json({ encounterId: id });
  });

  router.get('/appointments/:id/encounter', canRead, async (req, res) => {
    const appointmentId = uuid(req.params.id, 'Appointment');
    const { rows } = await db.query<{ id: string; patientId: string }>(
      'SELECT id, patient_id AS "patientId" FROM encounters WHERE appointment_id = $1',
      [appointmentId],
    );
    if (!rows[0]) {
      // No consultation yet: the appointment itself is visible through /api/appointments.
      res.json({ encounter: null });
      return;
    }
    await authorizeClinicalRead(db, req, res, rows[0].patientId, 'encounter');
    res.json({ encounter: await encounterOr404(rows[0].id) });
  });

  router.post(
    '/appointments/:id/vitals',
    requirePermission(db, 'vitals:record'),
    async (req, res) => {
      const input = vitalsSchema.parse(req.body);
      const id = await recordVitals(
        db,
        uuid(req.params.id, 'Appointment'),
        input,
        actorOf(res),
        auditContext(req, res),
      );
      res.status(201).json({ vitalsId: id });
    },
  );

  router.get('/encounters/mine', canWrite, async (_req, res) => {
    const doctorId = await doctorIdOfUser(db, requireUser(res).id);
    if (!doctorId) {
      res.json({ encounters: [] });
      return;
    }
    const { rows } = await db.query(
      `SELECT e.id, e.encounter_no AS "encounterNo", e.status, e.started_at AS "startedAt", e.appointment_id AS "appointmentId",
              json_build_object('id', p.id, 'mrn', p.mrn, 'firstName', p.first_name, 'lastName', p.last_name) AS patient
       FROM encounters e JOIN patients p ON p.id = e.patient_id
       WHERE e.doctor_id = $1 AND e.status = 'in_progress' ORDER BY e.started_at`,
      [doctorId],
    );
    res.json({ encounters: rows });
  });

  router.get('/encounters/:id', canRead, async (req, res) => {
    const e = await encounterOr404(uuid(req.params.id, 'Encounter'));
    const mine = (await doctorIdOfUser(db, requireUser(res).id)) === e.doctor.id;
    await authorizeClinicalRead(
      db,
      req,
      res,
      e.patient.id,
      mine ? 'encounter' : 'encounter:other_doctor',
    );
    res.json({ encounter: e });
  });

  router.post('/encounters/:id/notes', canWrite, async (req, res) => {
    const input = noteSchema.parse(req.body);
    await addNote(
      db,
      uuid(req.params.id, 'Encounter'),
      input,
      actorOf(res),
      auditContext(req, res),
    );
    res.status(201).json({ ok: true });
  });

  router.post('/encounters/:id/diagnoses', canWrite, async (req, res) => {
    const input = diagnosisSchema.parse(req.body);
    await addDiagnosis(
      db,
      uuid(req.params.id, 'Encounter'),
      input,
      actorOf(res),
      auditContext(req, res),
    );
    res.status(201).json({ ok: true });
  });

  router.post(
    '/encounters/:id/follow-ups',
    requirePermission(db, 'followup:recommend'),
    async (req, res) => {
      const input = followUpSchema.parse(req.body);
      const id = await recommendFollowUp(
        db,
        uuid(req.params.id, 'Encounter'),
        input,
        actorOf(res),
        auditContext(req, res),
      );
      res.status(201).json({ followUpId: id });
    },
  );

  router.post(
    '/encounters/:id/prescriptions',
    requirePermission(db, 'prescription:create'),
    async (req, res) => {
      const input = prescriptionSchema.parse(req.body);
      const id = await createPrescription(
        db,
        uuid(req.params.id, 'Encounter'),
        input,
        actorOf(res),
        auditContext(req, res),
      );
      res.status(201).json({ prescriptionId: id });
    },
  );

  router.post('/encounters/:id/complete', canWrite, async (req, res) => {
    await completeEncounter(
      db,
      uuid(req.params.id, 'Encounter'),
      actorOf(res),
      auditContext(req, res),
    );
    res.json({ ok: true });
  });

  router.post(
    '/vitals/:id/entered-in-error',
    requirePermission(db, 'vitals:record'),
    async (req, res) => {
      await flagVitals(db, uuid(req.params.id, 'Reading'), actorOf(res), auditContext(req, res));
      res.json({ ok: true });
    },
  );

  router.get('/patients/:id/chart', canRead, async (req, res) => {
    const patientId = uuid(req.params.id, 'Patient');
    const exists = await db.query('SELECT 1 FROM patients WHERE id = $1', [patientId]);
    if (!exists.rowCount) throw new AppError(404, 'NOT_FOUND', 'Patient not found');
    const { scope } = z.object({ scope: z.enum(CHART_SCOPES).default('mine') }).parse(req.query);
    // Other doctors' records are shown only when asked for, and that read is audited as such.
    const doctorId = await authorizeClinicalRead(
      db,
      req,
      res,
      patientId,
      scope === 'all' ? 'chart:all_doctors' : 'chart',
    );
    // The Super Admin (doctorId null) always sees every doctor's records.
    res.json({ chart: await findPatientChart(db, patientId, scope === 'all' ? null : doctorId) });
  });

  router.post(
    '/patients/:id/allergies',
    requirePermission(db, 'allergy:record'),
    async (req, res) => {
      const input = allergySchema.parse(req.body);
      const id = await addAllergy(
        db,
        uuid(req.params.id, 'Patient'),
        input,
        actorOf(res),
        auditContext(req, res),
      );
      res.status(201).json({ allergyId: id });
    },
  );

  router.post(
    '/allergies/:id/deactivate',
    requirePermission(db, 'allergy:record'),
    async (req, res) => {
      await deactivateAllergy(
        db,
        uuid(req.params.id, 'Allergy'),
        actorOf(res),
        auditContext(req, res),
      );
      res.json({ ok: true });
    },
  );

  router.post(
    '/prescriptions/:id/cancel',
    requirePermission(db, 'prescription:cancel'),
    async (req, res) => {
      const { reason } = cancelPrescriptionSchema.parse(req.body);
      await cancelPrescription(
        db,
        uuid(req.params.id, 'Prescription'),
        reason,
        actorOf(res),
        auditContext(req, res),
      );
      res.json({ ok: true });
    },
  );

  router.get(
    '/follow-ups',
    requireAnyPermission(db, ['followup:schedule', 'appointment:read_all']),
    async (req, res) => {
      const { status } = z
        .object({
          status: z.enum(['pending', 'booked', 'completed', 'cancelled']).default('pending'),
        })
        .parse(req.query);
      const { rows } = await db.query(
        `SELECT f.id, f.reason, f.due_from::text AS "dueFrom", f.due_to::text AS "dueTo", f.status, f.created_at AS "createdAt",
              json_build_object('id', p.id, 'mrn', p.mrn, 'firstName', p.first_name, 'lastName', p.last_name, 'phone', p.phone) AS patient,
              CASE WHEN d.id IS NULL THEN NULL ELSE json_build_object('id', d.id, 'fullName', de.full_name) END AS "targetDoctor"
       FROM follow_ups f JOIN patients p ON p.id = f.patient_id
       LEFT JOIN doctor_profiles d ON d.id = f.target_doctor_id LEFT JOIN employees de ON de.id = d.employee_id
       WHERE f.status = $1 ORDER BY f.due_from, f.created_at LIMIT 200`,
        [status],
      );
      res.json({ followUps: rows });
    },
  );

  router.post(
    '/follow-ups/:id/status',
    requirePermission(db, 'followup:schedule'),
    async (req, res) => {
      const { status } = followUpStatusSchema.parse(req.body);
      await setFollowUpStatus(
        db,
        uuid(req.params.id, 'Follow-up'),
        status,
        actorOf(res),
        auditContext(req, res),
      );
      res.json({ ok: true });
    },
  );

  return router;
}
