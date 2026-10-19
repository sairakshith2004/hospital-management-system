/**
 * Doctor profiles (ERD §3.2, reduced: one consultation fee per doctor instead of a fee
 * history; the fee is copied into the invoice line at billing time).
 */
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { auditColumns } from './columns.js';
import { departments, employees, users } from './identity.js';

export const doctorProfiles = pgTable(
  'doctor_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .unique('doctor_profiles_employee_id_key')
      .references(() => employees.id, { onDelete: 'restrict' }),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'restrict' }),
    specialty: text('specialty').notNull(),
    registrationNo: text('registration_no').notNull().unique('doctor_profiles_registration_no_key'),
    defaultSlotMinutes: integer('default_slot_minutes').notNull().default(15),
    /** Money as integer paise (ADR 0007). */
    consultationFeePaise: bigint('consultation_fee_paise', { mode: 'number' }).notNull(),
    active: boolean('active').notNull().default(true),
    ...auditColumns(() => users.id),
  },
  (t) => [
    index('doctor_profiles_department_id_idx').on(t.departmentId),
    check('doctor_profiles_specialty_not_blank', sql`length(trim(${t.specialty})) > 0`),
    check('doctor_profiles_slot_minutes', sql`${t.defaultSlotMinutes} BETWEEN 5 AND 120`),
    check('doctor_profiles_fee_non_negative', sql`${t.consultationFeePaise} >= 0`),
  ],
);
