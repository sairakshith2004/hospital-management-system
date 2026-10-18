/**
 * Consultations and prescriptions (ERD §3.4–3.5, reduced for the MVP: no addenda chains,
 * substitutions or dispense returns). Rules that need triggers (notes and diagnoses frozen
 * once an encounter is completed, vitals editable only to flag an error) and the grants
 * are in the hand-written migration.
 */
import {
  ALLERGY_SEVERITIES,
  ALLERGY_STATUSES,
  ENCOUNTER_STATUSES,
  FOLLOW_UP_STATUSES,
  NOTE_KINDS,
  PRESCRIPTION_STATUSES,
} from '@hospitalos/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgSequence,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, oneOf } from './columns.js';
import { doctorProfiles } from './doctors.js';
import { departments, users } from './identity.js';
import {
  ingredients,
  locations,
  medicineProducts,
  stockBatches,
  stockMovements,
} from './inventory.js';
import { patients } from './patients.js';
import { appointments } from './scheduling.js';

const userId = () => users.id;
const seq = (name: string) =>
  pgSequence(name, { startWith: 1, increment: 1, minValue: 1, maxValue: 9_999_999, cycle: false });

export const encounterNoSeq = seq('encounter_no_seq');

export const encounters = pgTable(
  'encounters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    encounterNo: text('encounter_no')
      .notNull()
      .unique('encounters_encounter_no_key')
      .default(sql`('ENC' || lpad(nextval('encounter_no_seq')::text, 7, '0'))`),
    appointmentId: uuid('appointment_id').notNull().unique('encounters_appointment_id_key'),
    patientId: uuid('patient_id').notNull(),
    doctorId: uuid('doctor_id').notNull(),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('in_progress'),
    chiefComplaint: text('chief_complaint'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...auditColumns(userId),
  },
  (t) => [
    unique('encounters_id_patient_key').on(t.id, t.patientId),
    foreignKey({
      name: 'encounters_appointment_fk',
      columns: [t.appointmentId, t.patientId, t.doctorId],
      foreignColumns: [appointments.id, appointments.patientId, appointments.doctorId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'encounters_patient_fk',
      columns: [t.patientId],
      foreignColumns: [patients.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'encounters_doctor_fk',
      columns: [t.doctorId],
      foreignColumns: [doctorProfiles.id],
    }).onDelete('restrict'),
    index('encounters_patient_idx').on(t.patientId, t.startedAt),
    index('encounters_doctor_status_idx').on(t.doctorId, t.status),
    check('encounters_status_check', oneOf(t.status, ENCOUNTER_STATUSES)),
    check(
      'encounters_completed_fields',
      sql`(${t.status} = 'completed') = (${t.completedAt} IS NOT NULL)`,
    ),
  ],
);

/** Readings belong to the visit (appointment), so they can be taken before the encounter. */
export const vitalSigns = pgTable(
  'vital_signs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appointmentId: uuid('appointment_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    tempC: numeric('temp_c', { precision: 4, scale: 1 }),
    pulse: integer('pulse'),
    bpSys: integer('bp_sys'),
    bpDia: integer('bp_dia'),
    respRate: integer('resp_rate'),
    spo2: integer('spo2'),
    weightKg: numeric('weight_kg', { precision: 5, scale: 1 }),
    heightCm: numeric('height_cm', { precision: 4, scale: 1 }),
    /** The only column that may change: a wrong reading is flagged, never edited. */
    enteredInError: boolean('entered_in_error').notNull().default(false),
  },
  (t) => [
    foreignKey({
      name: 'vital_signs_appointment_fk',
      columns: [t.appointmentId, t.patientId],
      foreignColumns: [appointments.id, appointments.patientId],
    }).onDelete('restrict'),
    index('vital_signs_appointment_idx').on(t.appointmentId),
    index('vital_signs_patient_idx').on(t.patientId, t.recordedAt),
    check(
      'vital_signs_some_value',
      sql`num_nonnulls(${t.tempC}, ${t.pulse}, ${t.bpSys}, ${t.respRate}, ${t.spo2}, ${t.weightKg}, ${t.heightCm}) > 0`,
    ),
    check('vital_signs_bp_pair', sql`(${t.bpSys} IS NULL) = (${t.bpDia} IS NULL)`),
    check(
      'vital_signs_plausible',
      sql`(${t.tempC} IS NULL OR ${t.tempC} BETWEEN 30 AND 45)
        AND (${t.pulse} IS NULL OR ${t.pulse} BETWEEN 20 AND 250)
        AND (${t.bpSys} IS NULL OR ${t.bpSys} BETWEEN 50 AND 260)
        AND (${t.bpDia} IS NULL OR ${t.bpDia} BETWEEN 20 AND 160)
        AND (${t.respRate} IS NULL OR ${t.respRate} BETWEEN 4 AND 80)
        AND (${t.spo2} IS NULL OR ${t.spo2} BETWEEN 50 AND 100)
        AND (${t.weightKg} IS NULL OR ${t.weightKg} BETWEEN 0.3 AND 400)
        AND (${t.heightCm} IS NULL OR ${t.heightCm} BETWEEN 20 AND 250)`,
    ),
  ],
);

export const diagnoses = pgTable(
  'diagnoses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    encounterId: uuid('encounter_id')
      .notNull()
      .references(() => encounters.id, { onDelete: 'restrict' }),
    description: text('description').notNull(),
    code: text('code'),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    index('diagnoses_encounter_idx').on(t.encounterId),
    uniqueIndex('diagnoses_one_primary_key')
      .on(t.encounterId)
      .where(sql`${t.isPrimary}`),
    check('diagnoses_description_not_blank', sql`length(trim(${t.description})) > 0`),
  ],
);

/** Append-only. After completion only addenda may be added (trigger). */
export const clinicalNotes = pgTable(
  'clinical_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    encounterId: uuid('encounter_id')
      .notNull()
      .references(() => encounters.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    body: text('body').notNull(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('clinical_notes_encounter_idx').on(t.encounterId, t.createdAt),
    check('clinical_notes_kind_check', oneOf(t.kind, NOTE_KINDS)),
    check('clinical_notes_body_not_blank', sql`length(trim(${t.body})) > 0`),
  ],
);

export const allergies = pgTable(
  'allergies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    substance: text('substance').notNull(),
    ingredientId: uuid('ingredient_id').references(() => ingredients.id, { onDelete: 'restrict' }),
    reaction: text('reaction'),
    severity: text('severity').notNull().default('unknown'),
    status: text('status').notNull().default('active'),
    ...auditColumns(userId),
  },
  (t) => [
    index('allergies_patient_idx').on(t.patientId),
    index('allergies_ingredient_idx').on(t.ingredientId),
    check('allergies_severity_check', oneOf(t.severity, ALLERGY_SEVERITIES)),
    check('allergies_status_check', oneOf(t.status, ALLERGY_STATUSES)),
    check('allergies_substance_not_blank', sql`length(trim(${t.substance})) > 0`),
  ],
);

export const followUps = pgTable(
  'follow_ups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id').notNull(),
    sourceEncounterId: uuid('source_encounter_id').notNull(),
    recommendedBy: uuid('recommended_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    targetDoctorId: uuid('target_doctor_id').references(() => doctorProfiles.id, {
      onDelete: 'restrict',
    }),
    reason: text('reason').notNull(),
    instructions: text('instructions'),
    dueFrom: date('due_from', { mode: 'string' }).notNull(),
    dueTo: date('due_to', { mode: 'string' }).notNull(),
    status: text('status').notNull().default('pending'),
    ...auditColumns(userId),
  },
  (t) => [
    foreignKey({
      name: 'follow_ups_encounter_fk',
      columns: [t.sourceEncounterId, t.patientId],
      foreignColumns: [encounters.id, encounters.patientId],
    }).onDelete('restrict'),
    index('follow_ups_status_due_idx').on(t.status, t.dueTo),
    index('follow_ups_target_idx').on(t.targetDoctorId, t.status),
    index('follow_ups_patient_idx').on(t.patientId),
    check('follow_ups_status_check', oneOf(t.status, FOLLOW_UP_STATUSES)),
    check('follow_ups_due_order', sql`${t.dueFrom} <= ${t.dueTo}`),
    check('follow_ups_reason_not_blank', sql`length(trim(${t.reason})) > 0`),
  ],
);

export const rxNoSeq = seq('rx_no_seq');

export const prescriptions = pgTable(
  'prescriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rxNo: text('rx_no')
      .notNull()
      .unique('prescriptions_rx_no_key')
      .default(sql`('RX' || lpad(nextval('rx_no_seq')::text, 7, '0'))`),
    encounterId: uuid('encounter_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctorProfiles.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('issued'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
    cancelReason: text('cancel_reason'),
    ...auditColumns(userId),
  },
  (t) => [
    unique('prescriptions_id_patient_key').on(t.id, t.patientId),
    foreignKey({
      name: 'prescriptions_encounter_fk',
      columns: [t.encounterId, t.patientId],
      foreignColumns: [encounters.id, encounters.patientId],
    }).onDelete('restrict'),
    index('prescriptions_status_idx').on(t.status, t.issuedAt),
    index('prescriptions_patient_idx').on(t.patientId),
    check('prescriptions_status_check', oneOf(t.status, PRESCRIPTION_STATUSES)),
    check(
      'prescriptions_cancel_reason',
      sql`${t.status} <> 'cancelled' OR length(trim(coalesce(${t.cancelReason}, ''))) > 0`,
    ),
  ],
);

export const prescriptionItems = pgTable(
  'prescription_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    prescriptionId: uuid('prescription_id')
      .notNull()
      .references(() => prescriptions.id, { onDelete: 'restrict' }),
    medicineProductId: uuid('medicine_product_id')
      .notNull()
      .references(() => medicineProducts.stockItemId, { onDelete: 'restrict' }),
    dose: text('dose').notNull(),
    frequency: text('frequency').notNull(),
    route: text('route').notNull(),
    durationDays: integer('duration_days'),
    qtyPrescribed: integer('qty_prescribed').notNull(),
    qtyDispensed: integer('qty_dispensed').notNull().default(0),
    instructions: text('instructions'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('prescription_items_id_prescription_key').on(t.id, t.prescriptionId),
    index('prescription_items_prescription_idx').on(t.prescriptionId),
    check('prescription_items_qty_positive', sql`${t.qtyPrescribed} > 0`),
    check(
      'prescription_items_dispensed_range',
      sql`${t.qtyDispensed} BETWEEN 0 AND ${t.qtyPrescribed}`,
    ),
    check(
      'prescription_items_duration',
      sql`${t.durationDays} IS NULL OR ${t.durationDays} BETWEEN 1 AND 365`,
    ),
  ],
);

export const dispenseNoSeq = seq('dispense_no_seq');

/** Never edited (trigger). */
export const dispensings = pgTable(
  'dispensings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dispenseNo: text('dispense_no')
      .notNull()
      .unique('dispensings_dispense_no_key')
      .default(sql`('DSP' || lpad(nextval('dispense_no_seq')::text, 7, '0'))`),
    prescriptionId: uuid('prescription_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    idempotencyKey: text('idempotency_key').notNull().unique('dispensings_idempotency_key_key'),
    dispensedBy: uuid('dispensed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    dispensedAt: timestamp('dispensed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('dispensings_id_prescription_key').on(t.id, t.prescriptionId),
    foreignKey({
      name: 'dispensings_prescription_fk',
      columns: [t.prescriptionId, t.patientId],
      foreignColumns: [prescriptions.id, prescriptions.patientId],
    }).onDelete('restrict'),
    index('dispensings_prescription_idx').on(t.prescriptionId),
  ],
);

/** Never edited (trigger). */
export const dispensingLines = pgTable(
  'dispensing_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dispensingId: uuid('dispensing_id').notNull(),
    prescriptionId: uuid('prescription_id').notNull(),
    prescriptionItemId: uuid('prescription_item_id').notNull(),
    batchId: uuid('batch_id').notNull(),
    dispensedProductId: uuid('dispensed_product_id')
      .notNull()
      .references(() => medicineProducts.stockItemId, { onDelete: 'restrict' }),
    qty: integer('qty').notNull(),
    unitPricePaise: bigint('unit_price_paise', { mode: 'number' }).notNull(),
    stockMovementId: bigint('stock_movement_id', { mode: 'number' })
      .notNull()
      .unique('dispensing_lines_stock_movement_key')
      .references(() => stockMovements.id, { onDelete: 'restrict' }),
  },
  (t) => [
    foreignKey({
      name: 'dispensing_lines_dispensing_fk',
      columns: [t.dispensingId, t.prescriptionId],
      foreignColumns: [dispensings.id, dispensings.prescriptionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'dispensing_lines_item_fk',
      columns: [t.prescriptionItemId, t.prescriptionId],
      foreignColumns: [prescriptionItems.id, prescriptionItems.prescriptionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'dispensing_lines_batch_product_fk',
      columns: [t.batchId, t.dispensedProductId],
      foreignColumns: [stockBatches.id, stockBatches.stockItemId],
    }).onDelete('restrict'),
    index('dispensing_lines_dispensing_idx').on(t.dispensingId),
    check('dispensing_lines_qty_positive', sql`${t.qty} > 0`),
    check('dispensing_lines_price_non_negative', sql`${t.unitPricePaise} >= 0`),
  ],
);
