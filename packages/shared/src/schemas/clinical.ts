/**
 * Consultations: encounters, vital signs, notes, diagnoses, allergies, follow-ups and
 * prescriptions (ERD §3.4–3.5, reduced for the MVP). Clinical decisions are always the
 * clinician's: nothing here suggests diagnoses or doses.
 */
import { z } from 'zod';

export const ENCOUNTER_STATUSES = ['in_progress', 'completed'] as const;
export type EncounterStatus = (typeof ENCOUNTER_STATUSES)[number];

export const NOTE_KINDS = ['symptoms', 'observation', 'plan', 'addendum'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const ALLERGY_SEVERITIES = ['mild', 'moderate', 'severe', 'unknown'] as const;
export const ALLERGY_STATUSES = ['active', 'inactive'] as const;

export const FOLLOW_UP_STATUSES = ['pending', 'booked', 'completed', 'cancelled'] as const;

export const PRESCRIPTION_STATUSES = [
  'issued',
  'partially_dispensed',
  'dispensed',
  'cancelled',
  'closed',
] as const;
export type PrescriptionStatus = (typeof PRESCRIPTION_STATUSES)[number];

const text = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();
const isoDate = z.iso.date('Must be a date (YYYY-MM-DD)');

export const startEncounterSchema = z.strictObject({ chiefComplaint: optional(500) });

/**
 * Plausible ranges for each vital sign. They catch typing mistakes, not clinical judgement;
 * the form uses them to explain a refusal before sending.
 */
export const VITAL_LIMITS = {
  tempC: { label: 'Temperature', min: 30, max: 45, unit: '°C', whole: false },
  pulse: { label: 'Pulse', min: 20, max: 250, unit: '/min', whole: true },
  bpSys: { label: 'BP systolic', min: 50, max: 260, unit: 'mmHg', whole: true },
  bpDia: { label: 'BP diastolic', min: 20, max: 160, unit: 'mmHg', whole: true },
  respRate: { label: 'Respiratory rate', min: 4, max: 80, unit: '/min', whole: true },
  spo2: { label: 'SpO₂', min: 50, max: 100, unit: '%', whole: true },
  weightKg: { label: 'Weight', min: 0.3, max: 400, unit: 'kg', whole: false },
  heightCm: { label: 'Height', min: 20, max: 250, unit: 'cm', whole: false },
} as const;
export type VitalKey = keyof typeof VITAL_LIMITS;

const vital = (key: VitalKey) => {
  const l = VITAL_LIMITS[key];
  const range = `${l.label} must be between ${l.min} and ${l.max} ${l.unit}`;
  const base = l.whole ? z.int(`${l.label} must be a whole number`) : z.number();
  return base.min(l.min, range).max(l.max, range).nullable().optional();
};

export const vitalsSchema = z
  .strictObject({
    tempC: vital('tempC'),
    pulse: vital('pulse'),
    bpSys: vital('bpSys'),
    bpDia: vital('bpDia'),
    respRate: vital('respRate'),
    spo2: vital('spo2'),
    weightKg: vital('weightKg'),
    heightCm: vital('heightCm'),
  })
  .refine((v) => Object.values(v).some((x) => x !== null && x !== undefined), {
    message: 'Enter at least one measurement',
  })
  .refine((v) => (v.bpSys == null) === (v.bpDia == null), {
    path: ['bpDia'],
    message: 'Enter both blood pressure values',
  });
export type VitalsInput = z.infer<typeof vitalsSchema>;

export const noteSchema = z.strictObject({
  kind: z.enum(NOTE_KINDS),
  body: text('Note', 5000),
});

export const diagnosisSchema = z.strictObject({
  description: text('Diagnosis', 300),
  code: optional(20),
  isPrimary: z.boolean().default(false),
});

export const allergySchema = z.strictObject({
  substance: text('Substance', 120),
  ingredientId: z.uuid().nullable().optional(),
  reaction: optional(200),
  severity: z.enum(ALLERGY_SEVERITIES).default('unknown'),
});

export const followUpSchema = z
  .strictObject({
    reason: text('Reason', 300),
    instructions: optional(1000),
    dueFrom: isoDate,
    dueTo: isoDate,
    targetDoctorId: z.uuid().nullable().optional(),
  })
  .refine((f) => f.dueFrom <= f.dueTo, {
    path: ['dueTo'],
    message: 'Must not be before the start',
  });

export const prescriptionSchema = z.strictObject({
  notes: optional(500),
  /**
   * Set after the prescriber has seen an allergy warning (409 ALLERGY_CONFLICT) and decided
   * to go ahead. Recorded in the audit log; the software never decides this.
   */
  allergyAcknowledged: z.boolean().default(false),
  items: z
    .array(
      z.strictObject({
        medicineProductId: z.uuid(),
        dose: text('Dose', 60),
        frequency: text('Frequency', 60),
        route: text('Route', 30),
        durationDays: z.int().min(1).max(365).nullable().optional(),
        qtyPrescribed: z.int().min(1).max(10_000),
        instructions: optional(300),
      }),
    )
    .min(1, 'Add at least one medicine')
    .max(20),
});
export type PrescriptionInput = z.infer<typeof prescriptionSchema>;

export const followUpStatusSchema = z.strictObject({
  status: z.enum(['booked', 'completed', 'cancelled']),
});

export const dispenseSchema = z.strictObject({
  locationId: z.uuid(),
  /** A fresh UUID per attempt: a retried request returns the first dispensing. */
  idempotencyKey: z.uuid(),
  lines: z
    .array(z.strictObject({ prescriptionItemId: z.uuid(), qty: z.int().min(1).max(10_000) }))
    .min(1)
    .max(20),
  /** The pharmacist has seen the near-expiry warning (409 NEAR_EXPIRY) and accepts it. */
  nearExpiryAck: z.boolean().default(false),
  /** The pharmacist has seen the allergy warning (409 ALLERGY_CONFLICT) and accepts it. */
  allergyAck: z.boolean().default(false),
});
export type DispenseInput = z.infer<typeof dispenseSchema>;

export const closePrescriptionSchema = z.strictObject({ reason: text('Reason', 200) });

export const cancelPrescriptionSchema = z.strictObject({ reason: text('Reason', 200) });

export interface VitalSigns {
  id: string;
  appointmentId: string;
  recordedAt: string;
  recordedBy: string;
  tempC: string | null;
  pulse: number | null;
  bpSys: number | null;
  bpDia: number | null;
  respRate: number | null;
  spo2: number | null;
  weightKg: string | null;
  heightCm: string | null;
  enteredInError: boolean;
}

export interface ClinicalNote {
  id: string;
  kind: NoteKind;
  body: string;
  author: string;
  createdAt: string;
}

export interface Diagnosis {
  id: string;
  description: string;
  code: string | null;
  isPrimary: boolean;
  createdAt: string;
}

export interface Allergy {
  id: string;
  substance: string;
  ingredientId: string | null;
  reaction: string | null;
  severity: (typeof ALLERGY_SEVERITIES)[number];
  status: (typeof ALLERGY_STATUSES)[number];
  recordedAt: string;
}

export interface FollowUp {
  id: string;
  reason: string;
  instructions: string | null;
  dueFrom: string;
  dueTo: string;
  status: (typeof FOLLOW_UP_STATUSES)[number];
  targetDoctor: { id: string; fullName: string } | null;
  recommendedBy: string;
  createdAt: string;
}

export interface PrescriptionItemView {
  id: string;
  medicineProductId: string;
  product: string;
  dose: string;
  frequency: string;
  route: string;
  durationDays: number | null;
  qtyPrescribed: number;
  qtyDispensed: number;
  instructions: string | null;
}

export interface PrescriptionView {
  id: string;
  rxNo: string;
  status: PrescriptionStatus;
  issuedAt: string;
  notes: string | null;
  encounterId: string;
  patient: { id: string; mrn: string; firstName: string; lastName: string };
  doctor: { id: string; fullName: string };
  items: PrescriptionItemView[];
}

export interface EncounterView {
  id: string;
  encounterNo: string;
  status: EncounterStatus;
  chiefComplaint: string | null;
  startedAt: string;
  completedAt: string | null;
  appointmentId: string;
  patient: {
    id: string;
    mrn: string;
    firstName: string;
    lastName: string;
    dob: string;
    sex: string;
  };
  doctor: { id: string; fullName: string; departmentId: string };
  notes: ClinicalNote[];
  diagnoses: Diagnosis[];
  vitals: VitalSigns[];
  prescriptions: PrescriptionView[];
  followUps: FollowUp[];
}

/** Everything a treating clinician sees for one patient, newest first. */
/**
 * `mine`: only the signed-in doctor's own records (the default). `all`: every doctor's,
 * opened on purpose with "Previous reports from other doctors" and audited as such.
 */
export const CHART_SCOPES = ['mine', 'all'] as const;
export type ChartScope = (typeof CHART_SCOPES)[number];

export interface PatientChart {
  scope: ChartScope;
  /** Consultations, lab orders and prescriptions by other doctors (hidden when scope is mine). */
  otherDoctorRecords: number;
  patient: {
    id: string;
    mrn: string;
    firstName: string;
    lastName: string;
    dob: string;
    sex: string;
    bloodGroup: string | null;
  };
  allergies: Allergy[];
  encounters: {
    id: string;
    encounterNo: string;
    status: EncounterStatus;
    startedAt: string;
    completedAt: string | null;
    chiefComplaint: string | null;
    doctor: { id: string; fullName: string };
    diagnoses: Diagnosis[];
  }[];
  vitals: VitalSigns[];
  prescriptions: PrescriptionView[];
  followUps: FollowUp[];
  labOrders: LabOrderSummary[];
  appointments: {
    id: string;
    appointmentNo: string;
    visitDate: string;
    slotStart: string | null;
    status: string;
    doctor: { id: string; fullName: string };
  }[];
}

/** Defined fully in the lab module; repeated here to keep the chart self-contained. */
export interface LabOrderSummary {
  id: string;
  orderNo: string;
  status: string;
  test: { id: string; code: string; name: string };
  orderedAt: string;
  verifiedAt: string | null;
  doctor: { id: string; fullName: string };
}
