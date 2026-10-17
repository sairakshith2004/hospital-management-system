import type { DuplicateCandidate, Patient, PatientSummary } from '@hospitalos/shared';
import type { Queryable } from '../../db/client.js';

const COLUMNS = `id, mrn, first_name AS "firstName", last_name AS "lastName", dob::text AS dob,
  sex, phone, email::text AS email, address, blood_group AS "bloodGroup", version,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

/** The editable demographic fields, in API (camelCase) and column (snake_case) form. */
export const PATIENT_FIELDS = {
  firstName: 'first_name',
  lastName: 'last_name',
  dob: 'dob',
  sex: 'sex',
  phone: 'phone',
  email: 'email',
  address: 'address',
  bloodGroup: 'blood_group',
} as const;
export type PatientField = keyof typeof PATIENT_FIELDS;
export type PatientValues = Record<PatientField, string | null>;

export async function findPatient(
  db: Queryable,
  id: string,
  { forUpdate = false } = {},
): Promise<Patient | undefined> {
  const { rows } = await db.query<Patient>(
    `SELECT ${COLUMNS} FROM patients WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  );
  return rows[0];
}

/** Escapes LIKE wildcards so user input only ever matches literally. */
const likeLiteral = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * One search box, three kinds of match: an MRN (exact), a phone number (digits, partial)
 * or a name (partial or fuzzy, using the trigram index on first_name || ' ' || last_name).
 */
export async function searchPatients(
  db: Queryable,
  q: string,
  limit = 20,
): Promise<PatientSummary[]> {
  const select = `SELECT id, mrn, first_name AS "firstName", last_name AS "lastName",
    dob::text AS dob, sex, phone FROM patients`;
  if (/^mrn\d+$/i.test(q)) {
    const { rows } = await db.query<PatientSummary>(`${select} WHERE mrn = $1`, [q.toUpperCase()]);
    return rows;
  }
  const digits = q.replace(/[\s\-()+]/g, '');
  if (/^\d{3,15}$/.test(digits)) {
    const { rows } = await db.query<PatientSummary>(
      `${select} WHERE phone LIKE $1 ORDER BY last_name, first_name LIMIT $2`,
      [`%${digits}%`, limit],
    );
    return rows;
  }
  const { rows } = await db.query<PatientSummary>(
    `${select}
     WHERE (first_name || ' ' || last_name) ILIKE $1
        OR (first_name || ' ' || last_name) % $2
     ORDER BY similarity(first_name || ' ' || last_name, $2) DESC, last_name, first_name
     LIMIT $3`,
    [`%${likeLiteral(q)}%`, q, limit],
  );
  return rows;
}

export async function findDuplicateCandidates(
  db: Queryable,
  phone: string,
  dob: string,
): Promise<DuplicateCandidate[]> {
  const { rows } = await db.query<DuplicateCandidate>(
    `SELECT id, mrn, first_name AS "firstName", last_name AS "lastName"
     FROM patients WHERE phone = $1 AND dob = $2 ORDER BY mrn LIMIT 5`,
    [phone, dob],
  );
  return rows;
}

/**
 * Serialises registrations for the same phone and date of birth until the transaction
 * ends, so two simultaneous registrations of one person can't both pass the duplicate
 * check.
 */
export async function lockIdentity(db: Queryable, phone: string, dob: string): Promise<void> {
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('patient:' || $1 || '|' || $2, 0))",
    [phone, dob],
  );
}

export async function insertPatient(
  db: Queryable,
  values: PatientValues,
  actorId: string,
): Promise<Patient> {
  const { rows } = await db.query<Patient>(
    `INSERT INTO patients
       (first_name, last_name, dob, sex, phone, email, address, blood_group, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
     RETURNING ${COLUMNS}`,
    [
      values.firstName,
      values.lastName,
      values.dob,
      values.sex,
      values.phone,
      values.email,
      values.address,
      values.bloodGroup,
      actorId,
    ],
  );
  return rows[0]!;
}

export async function updatePatient(
  db: Queryable,
  id: string,
  values: PatientValues,
  actorId: string,
): Promise<Patient> {
  const { rows } = await db.query<Patient>(
    `UPDATE patients SET first_name = $2, last_name = $3, dob = $4, sex = $5, phone = $6,
       email = $7, address = $8, blood_group = $9, updated_by = $10, version = version + 1
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [
      id,
      values.firstName,
      values.lastName,
      values.dob,
      values.sex,
      values.phone,
      values.email,
      values.address,
      values.bloodGroup,
      actorId,
    ],
  );
  return rows[0]!;
}
