/**
 * Patients (ERD §3.3, reduced for the 10-day MVP: demographics only; allergies arrive
 * with consultations). Synthetic data only. The trigram index on the full name and the
 * hms_app grants are in the hand-written migration 0005.
 */
import { BLOOD_GROUPS, SEXES } from '@hospitalos/shared';
import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgSequence, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { auditColumns, citext, oneOf } from './columns.js';
import { users } from './identity.js';

/**
 * MRNs come from a sequence, so concurrent registrations can never share one. Capped at
 * 999999 because the MRN pads to six digits: past the cap, registration fails loudly
 * instead of ever producing a duplicate (the UNIQUE constraint is a second guard).
 */
export const patientMrnSeq = pgSequence('patient_mrn_seq', {
  startWith: 1,
  increment: 1,
  minValue: 1,
  maxValue: 999_999,
  cycle: false,
});

export const patients = pgTable(
  'patients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mrn: text('mrn')
      .notNull()
      .unique('patients_mrn_key')
      .default(sql`('MRN' || lpad(nextval('patient_mrn_seq')::text, 6, '0'))`),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    dob: date('dob', { mode: 'string' }).notNull(),
    sex: text('sex').notNull(),
    phone: text('phone').notNull(),
    email: citext('email'),
    address: text('address'),
    bloodGroup: text('blood_group'),
    /** Optimistic locking: every update must name the version it read (stale → 409). */
    version: integer('version').notNull().default(1),
    ...auditColumns(() => users.id),
  },
  (t) => [
    index('patients_phone_dob_idx').on(t.phone, t.dob),
    index('patients_dob_idx').on(t.dob),
    check('patients_first_name_not_blank', sql`length(trim(${t.firstName})) > 0`),
    check('patients_last_name_not_blank', sql`length(trim(${t.lastName})) > 0`),
    check('patients_sex_check', oneOf(t.sex, SEXES)),
    check('patients_phone_digits', sql`${t.phone} ~ '^[0-9]{7,15}$'`),
    check(
      'patients_blood_group_check',
      sql`${t.bloodGroup} IS NULL OR ${oneOf(t.bloodGroup, BLOOD_GROUPS)}`,
    ),
    check('patients_dob_after_1900', sql`${t.dob} >= DATE '1900-01-01'`),
    check('patients_version_positive', sql`${t.version} >= 1`),
  ],
);
