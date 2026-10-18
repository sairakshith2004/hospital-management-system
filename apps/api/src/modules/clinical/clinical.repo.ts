/** Clinical reads: encounters, vitals, notes, diagnoses, allergies, follow-ups, prescriptions. */
import type { EncounterView, PatientChart, PrescriptionView } from '@hospitalos/shared';
import type { Queryable } from '../../db/client.js';

const VITALS = (where: string) => `
  (SELECT coalesce(json_agg(json_build_object(
     'id', v.id, 'appointmentId', v.appointment_id, 'recordedAt', v.recorded_at, 'recordedBy', ve.full_name,
     'tempC', v.temp_c::text, 'pulse', v.pulse, 'bpSys', v.bp_sys, 'bpDia', v.bp_dia, 'respRate', v.resp_rate,
     'spo2', v.spo2, 'weightKg', v.weight_kg::text, 'heightCm', v.height_cm::text, 'enteredInError', v.entered_in_error)
     ORDER BY v.recorded_at DESC), '[]')
   FROM vital_signs v JOIN users vu ON vu.id = v.recorded_by JOIN employees ve ON ve.id = vu.employee_id
   WHERE ${where})`;

const DIAGNOSES = (encounterRef: string) => `
  (SELECT coalesce(json_agg(json_build_object('id', dx.id, 'description', dx.description, 'code', dx.code,
     'isPrimary', dx.is_primary, 'createdAt', dx.created_at) ORDER BY dx.is_primary DESC, dx.created_at), '[]')
   FROM diagnoses dx WHERE dx.encounter_id = ${encounterRef})`;

const FOLLOW_UPS = (where: string) => `
  (SELECT coalesce(json_agg(json_build_object('id', f.id, 'reason', f.reason, 'instructions', f.instructions,
     'dueFrom', f.due_from, 'dueTo', f.due_to, 'status', f.status, 'createdAt', f.created_at,
     'recommendedBy', fe.full_name,
     'targetDoctor', CASE WHEN f.target_doctor_id IS NULL THEN NULL
        ELSE json_build_object('id', td.id, 'fullName', tde.full_name) END) ORDER BY f.due_from), '[]')
   FROM follow_ups f JOIN users fu ON fu.id = f.recommended_by JOIN employees fe ON fe.id = fu.employee_id
   LEFT JOIN doctor_profiles td ON td.id = f.target_doctor_id LEFT JOIN employees tde ON tde.id = td.employee_id
   WHERE ${where})`;

export const PRESCRIPTION_JSON = `json_build_object(
  'id', p.id, 'rxNo', p.rx_no, 'status', p.status, 'issuedAt', p.issued_at, 'notes', p.notes,
  'encounterId', p.encounter_id,
  'patient', json_build_object('id', pt.id, 'mrn', pt.mrn, 'firstName', pt.first_name, 'lastName', pt.last_name),
  'doctor', json_build_object('id', pd.id, 'fullName', pde.full_name),
  'items', (SELECT coalesce(json_agg(json_build_object('id', i.id, 'medicineProductId', i.medicine_product_id,
       'product', si.name, 'dose', i.dose, 'frequency', i.frequency, 'route', i.route,
       'durationDays', i.duration_days, 'qtyPrescribed', i.qty_prescribed, 'qtyDispensed', i.qty_dispensed,
       'instructions', i.instructions) ORDER BY si.name), '[]')
     FROM prescription_items i JOIN stock_items si ON si.id = i.medicine_product_id
     WHERE i.prescription_id = p.id))`;
export const PRESCRIPTION_FROM = `FROM prescriptions p
  JOIN patients pt ON pt.id = p.patient_id
  JOIN doctor_profiles pd ON pd.id = p.doctor_id JOIN employees pde ON pde.id = pd.employee_id`;

export async function findPrescription(
  db: Queryable,
  id: string,
): Promise<PrescriptionView | undefined> {
  const { rows } = await db.query<{ p: PrescriptionView }>(
    `SELECT ${PRESCRIPTION_JSON} AS p ${PRESCRIPTION_FROM} WHERE p.id = $1`,
    [id],
  );
  return rows[0]?.p;
}

export async function findEncounter(db: Queryable, id: string): Promise<EncounterView | undefined> {
  const { rows } = await db.query<{ e: EncounterView }>(
    `SELECT json_build_object(
       'id', e.id, 'encounterNo', e.encounter_no, 'status', e.status, 'chiefComplaint', e.chief_complaint,
       'startedAt', e.started_at, 'completedAt', e.completed_at, 'appointmentId', e.appointment_id,
       'patient', json_build_object('id', pt.id, 'mrn', pt.mrn, 'firstName', pt.first_name,
          'lastName', pt.last_name, 'dob', pt.dob, 'sex', pt.sex),
       'doctor', json_build_object('id', d.id, 'fullName', de.full_name),
       'notes', (SELECT coalesce(json_agg(json_build_object('id', n.id, 'kind', n.kind, 'body', n.body,
           'author', ne.full_name, 'createdAt', n.created_at) ORDER BY n.created_at), '[]')
         FROM clinical_notes n JOIN users nu ON nu.id = n.author_id JOIN employees ne ON ne.id = nu.employee_id
         WHERE n.encounter_id = e.id),
       'diagnoses', ${DIAGNOSES('e.id')},
       'vitals', ${VITALS('v.appointment_id = e.appointment_id')},
       'prescriptions', (SELECT coalesce(json_agg(${PRESCRIPTION_JSON} ORDER BY p.issued_at), '[]')
         ${PRESCRIPTION_FROM} WHERE p.encounter_id = e.id),
       'followUps', ${FOLLOW_UPS('f.source_encounter_id = e.id')}
     ) AS e
     FROM encounters e
     JOIN patients pt ON pt.id = e.patient_id
     JOIN doctor_profiles d ON d.id = e.doctor_id JOIN employees de ON de.id = d.employee_id
     WHERE e.id = $1`,
    [id],
  );
  return rows[0]?.e;
}

export async function findPatientChart(
  db: Queryable,
  patientId: string,
): Promise<PatientChart | undefined> {
  const { rows } = await db.query<{ c: PatientChart }>(
    `SELECT json_build_object(
       'patient', json_build_object('id', pt.id, 'mrn', pt.mrn, 'firstName', pt.first_name, 'lastName', pt.last_name,
          'dob', pt.dob, 'sex', pt.sex, 'bloodGroup', pt.blood_group),
       'allergies', (SELECT coalesce(json_agg(json_build_object('id', a.id, 'substance', a.substance,
           'ingredientId', a.ingredient_id, 'reaction', a.reaction, 'severity', a.severity, 'status', a.status,
           'recordedAt', a.created_at) ORDER BY a.status, a.created_at DESC), '[]')
         FROM allergies a WHERE a.patient_id = pt.id),
       'encounters', (SELECT coalesce(json_agg(json_build_object('id', e.id, 'encounterNo', e.encounter_no,
           'status', e.status, 'startedAt', e.started_at, 'completedAt', e.completed_at,
           'chiefComplaint', e.chief_complaint,
           'doctor', json_build_object('id', d.id, 'fullName', de.full_name),
           'diagnoses', ${DIAGNOSES('e.id')})
           ORDER BY e.started_at DESC), '[]')
         FROM encounters e JOIN doctor_profiles d ON d.id = e.doctor_id JOIN employees de ON de.id = d.employee_id
         WHERE e.patient_id = pt.id),
       'vitals', ${VITALS('v.patient_id = pt.id')},
       'prescriptions', (SELECT coalesce(json_agg(${PRESCRIPTION_JSON} ORDER BY p.issued_at DESC), '[]')
         ${PRESCRIPTION_FROM} WHERE p.patient_id = $1),
       'followUps', ${FOLLOW_UPS('f.patient_id = pt.id')},
       'labOrders', (SELECT coalesce(json_agg(json_build_object('id', o.id, 'orderNo', o.order_no, 'status', o.status,
           'test', json_build_object('id', t.id, 'code', t.code, 'name', t.name),
           'orderedAt', o.created_at, 'verifiedAt', o.verified_at) ORDER BY o.created_at DESC), '[]')
         FROM lab_orders o JOIN lab_tests t ON t.id = o.test_id WHERE o.patient_id = pt.id),
       'appointments', (SELECT coalesce(json_agg(json_build_object('id', ap.id, 'appointmentNo', ap.appointment_no,
           'visitDate', ap.visit_date, 'slotStart', ap.slot_start, 'status', ap.status,
           'doctor', json_build_object('id', ad.id, 'fullName', ade.full_name)) ORDER BY ap.visit_date DESC, ap.slot_start DESC NULLS LAST), '[]')
         FROM appointments ap JOIN doctor_profiles ad ON ad.id = ap.doctor_id JOIN employees ade ON ade.id = ad.employee_id
         WHERE ap.patient_id = pt.id)
     ) AS c
     FROM patients pt WHERE pt.id = $1`,
    [patientId],
  );
  return rows[0]?.c;
}

export interface EncounterRow {
  id: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  status: 'in_progress' | 'completed';
}

export async function lockEncounter(db: Queryable, id: string): Promise<EncounterRow | undefined> {
  const { rows } = await db.query<EncounterRow>(
    `SELECT id, appointment_id AS "appointmentId", patient_id AS "patientId", doctor_id AS "doctorId", status
     FROM encounters WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0];
}
