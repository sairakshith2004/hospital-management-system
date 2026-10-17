/**
 * Patient demographics: one set of rules for the API (authoritative) and the web forms
 * (convenience). Synthetic data only.
 */
import { z } from 'zod';

export const SEXES = ['female', 'male', 'other', 'unknown'] as const;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

export type Sex = (typeof SEXES)[number];
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

const name = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(100, `${label} must be at most 100 characters`);

/** Digits only after removing spaces, dashes, brackets and a leading +. 7–15 digits. */
export const phoneSchema = z
  .string()
  .transform((v) => v.replace(/[\s\-()]/g, '').replace(/^\+/, ''))
  .pipe(z.string().regex(/^[0-9]{7,15}$/, 'Phone must be 7–15 digits'));

/** The hospital's time zone (hospital_settings.timezone default); "today" is computed in it. */
export const HOSPITAL_TIME_ZONE = 'Asia/Kolkata';

/** Today's date in the hospital time zone, as YYYY-MM-DD. */
export function hospitalToday(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: HOSPITAL_TIME_ZONE });
}

/** An ISO date (YYYY-MM-DD) that is real, not in the future and not before 1900. */
export const dobSchema = z.iso
  .date('Date of birth must be a valid date (YYYY-MM-DD)')
  .refine((v) => v >= '1900-01-01', 'Date of birth must be after 1900')
  .refine((v) => v <= hospitalToday(), 'Date of birth cannot be in the future');

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const patientFields = {
  firstName: name('First name'),
  lastName: name('Last name'),
  dob: dobSchema,
  sex: z.enum(SEXES, 'Choose a sex'),
  phone: phoneSchema,
  email: z
    .union([z.literal(''), z.email('Email must be a valid address').max(254)])
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  address: optionalText(500, 'Address'),
  bloodGroup: z
    .union([z.literal(''), z.enum(BLOOD_GROUPS, 'Choose a valid blood group')])
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
};

export const createPatientSchema = z.strictObject({
  ...patientFields,
  /** Set after the user has seen the possible-duplicate warning and chosen to continue. */
  confirmDuplicate: z.boolean().optional(),
});

export const updatePatientSchema = z.strictObject({
  ...patientFields,
  version: z.number().int().min(1),
});

export const patientSearchSchema = z.strictObject({
  q: z.string().trim().min(2, 'Enter at least 2 characters').max(100),
});

export type CreatePatientInput = z.input<typeof createPatientSchema>;
export type UpdatePatientInput = z.input<typeof updatePatientSchema>;

export interface Patient {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  dob: string;
  sex: Sex;
  phone: string;
  email: string | null;
  address: string | null;
  bloodGroup: BloodGroup | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type PatientSummary = Pick<
  Patient,
  'id' | 'mrn' | 'firstName' | 'lastName' | 'dob' | 'sex' | 'phone'
>;

/** Returned with 409 DUPLICATE_SUSPECTED: just enough to recognise the existing record. */
export type DuplicateCandidate = Pick<Patient, 'id' | 'mrn' | 'firstName' | 'lastName'>;
