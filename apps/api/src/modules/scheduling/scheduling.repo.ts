/**
 * Scheduling SQL. Slots are generated in PostgreSQL from the weekly sessions, in the
 * hospital time zone, so the API and the database constraints share one definition of
 * "a slot" (date + session time, interpreted in Asia/Kolkata).
 */
import {
  ACTIVE_APPOINTMENT_STATUSES,
  HOSPITAL_TIME_ZONE,
  type AppointmentDetail,
  type AppointmentStatus,
  type AppointmentSummary,
  type AvailabilitySlot,
  type DoctorSchedule,
} from '@hospitalos/shared';
import type { Queryable } from '../../db/client.js';

const ACTIVE = `ARRAY[${ACTIVE_APPOINTMENT_STATUSES.map((s) => `'${s}'`).join(', ')}]::text[]`;
const TODAY = `(now() AT TIME ZONE '${HOSPITAL_TIME_ZONE}')::date`;

/**
 * Transaction-scoped advisory locks (released at COMMIT or ROLLBACK). Every booking path
 * takes the doctor-day and patient-day locks, always in sorted name order, so concurrent
 * bookings queue up instead of racing on the exclusion constraints (which can deadlock
 * when several uncommitted conflicting rows wait on each other). The constraints stay as
 * the second line of defence.
 */
export async function lockBooking(
  db: Queryable,
  keys: { doctorId: string; patientId: string; visitDate: string }[],
): Promise<void> {
  const names = new Set<string>();
  for (const k of keys) {
    names.add(`booking:doctor:${k.doctorId}:${k.visitDate}`);
    names.add(`booking:patient:${k.patientId}:${k.visitDate}`);
  }
  // One statement per lock, in a fixed (sorted) order: the order is then guaranteed,
  // whatever the planner does.
  for (const name of [...names].sort()) {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [name]);
  }
}

/** The per-doctor, per-day token counter lock (check-in and walk-ins). */
export async function nextToken(db: Queryable, doctorId: string, visitDate: string) {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `token:${doctorId}:${visitDate}`,
  ]);
  const { rows } = await db.query<{ next: number }>(
    `SELECT coalesce(max(token_no), 0) + 1 AS next FROM appointments
     WHERE doctor_id = $1 AND visit_date = $2::date`,
    [doctorId, visitDate],
  );
  return rows[0]!.next;
}

export async function hospitalDate(db: Queryable): Promise<string> {
  const { rows } = await db.query<{ today: string }>(`SELECT ${TODAY}::text AS today`);
  return rows[0]!.today;
}

export interface DoctorRef {
  id: string;
  departmentId: string;
}

/** An active doctor whose employment is active. */
export async function findActiveDoctor(db: Queryable, id: string): Promise<DoctorRef | undefined> {
  const { rows } = await db.query<DoctorRef>(
    `SELECT d.id, d.department_id AS "departmentId"
     FROM doctor_profiles d JOIN employees e ON e.id = d.employee_id
     WHERE d.id = $1 AND d.active AND e.employment_status = 'active'`,
    [id],
  );
  return rows[0];
}

export async function doctorExists(db: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await db.query('SELECT 1 FROM doctor_profiles WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

export async function patientExists(db: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await db.query('SELECT 1 FROM patients WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

/** The doctor profile of a signed-in user (user → employee → doctor_profiles), if any. */
export async function doctorIdOfUser(db: Queryable, userId: string): Promise<string | undefined> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT d.id FROM users u JOIN doctor_profiles d ON d.employee_id = u.employee_id
     WHERE u.id = $1 AND d.active`,
    [userId],
  );
  return rows[0]?.id;
}

/**
 * Every slot of the doctor's active sessions on `date`, with whether it can be booked.
 * `ignoreAppointmentId` treats one appointment as free (the one being rescheduled).
 */
export async function listSlots(
  db: Queryable,
  doctorId: string,
  date: string,
  { ignoreAppointmentId = null as string | null } = {},
): Promise<AvailabilitySlot[]> {
  const { rows } = await db.query<AvailabilitySlot>(
    `WITH slots AS (
       SELECT s.id AS schedule_id, g AS slot_start,
              g + make_interval(mins => s.slot_minutes) AS slot_end
       FROM doctor_schedules s,
            LATERAL generate_series(
              ($2::date + s.start_time) AT TIME ZONE '${HOSPITAL_TIME_ZONE}',
              ($2::date + s.end_time) AT TIME ZONE '${HOSPITAL_TIME_ZONE}'
                - make_interval(mins => s.slot_minutes),
              make_interval(mins => s.slot_minutes)) AS g
       WHERE s.doctor_id = $1 AND s.active
         AND s.weekday = extract(isodow FROM $2::date)
         AND $2::date >= s.valid_from AND (s.valid_to IS NULL OR $2::date <= s.valid_to)
     )
     SELECT schedule_id AS "scheduleId", slot_start AS "slotStart", slot_end AS "slotEnd",
       (slot_start > now()
        AND NOT EXISTS (
          SELECT 1 FROM schedule_exceptions x
          WHERE x.doctor_id = $1 AND x.active
            AND x.starts_at < slots.slot_end AND x.ends_at > slots.slot_start)
        AND NOT EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.doctor_id = $1 AND a.status = ANY(${ACTIVE})
            AND a.id IS DISTINCT FROM $3::uuid
            AND a.slot_start < slots.slot_end AND a.slot_end > slots.slot_start)
       ) AS available
     FROM slots ORDER BY slot_start`,
    [doctorId, date, ignoreAppointmentId],
  );
  return rows.map((r) => ({
    ...r,
    slotStart: new Date(r.slotStart).toISOString(),
    slotEnd: new Date(r.slotEnd).toISOString(),
  }));
}

export interface SlotCheck {
  scheduleId: string;
  slotStart: string;
  slotEnd: string;
  visitDate: string;
  inPast: boolean;
  blocked: boolean;
}

/** Whether `slotStart` is the start of one of the doctor's generated slots. */
export async function findSlot(
  db: Queryable,
  doctorId: string,
  slotStart: string,
): Promise<SlotCheck | undefined> {
  const { rows } = await db.query<SlotCheck>(
    `WITH d AS (SELECT ($2::timestamptz AT TIME ZONE '${HOSPITAL_TIME_ZONE}')::date AS day)
     SELECT s.id AS "scheduleId", $2::timestamptz AS "slotStart",
            $2::timestamptz + make_interval(mins => s.slot_minutes) AS "slotEnd",
            d.day::text AS "visitDate",
            $2::timestamptz <= now() AS "inPast",
            EXISTS (
              SELECT 1 FROM schedule_exceptions x
              WHERE x.doctor_id = $1 AND x.active AND x.starts_at < $2::timestamptz
                + make_interval(mins => s.slot_minutes) AND x.ends_at > $2::timestamptz
            ) AS blocked
     FROM doctor_schedules s, d
     WHERE s.doctor_id = $1 AND s.active
       AND s.weekday = extract(isodow FROM d.day)
       AND d.day >= s.valid_from AND (s.valid_to IS NULL OR d.day <= s.valid_to)
       AND $2::timestamptz >= (d.day + s.start_time) AT TIME ZONE '${HOSPITAL_TIME_ZONE}'
       AND $2::timestamptz + make_interval(mins => s.slot_minutes)
             <= (d.day + s.end_time) AT TIME ZONE '${HOSPITAL_TIME_ZONE}'
       AND mod(extract(epoch FROM $2::timestamptz
             - (d.day + s.start_time) AT TIME ZONE '${HOSPITAL_TIME_ZONE}')::bigint,
             s.slot_minutes * 60) = 0`,
    [doctorId, slotStart],
  );
  return rows[0];
}

export type BookingConflict = 'SLOT_TAKEN' | 'PATIENT_BUSY' | 'ALREADY_BOOKED';

/** Rechecked under the booking locks, just before the insert. */
export async function findBookingConflict(
  db: Queryable,
  b: { doctorId: string; patientId: string; visitDate: string; slotStart: string; slotEnd: string },
  ignoreAppointmentId: string | null = null,
): Promise<BookingConflict | undefined> {
  const { rows } = await db.query<{ conflict: BookingConflict | null }>(
    `SELECT CASE
       WHEN EXISTS (SELECT 1 FROM appointments a WHERE a.doctor_id = $1
              AND a.status = ANY(${ACTIVE}) AND a.id IS DISTINCT FROM $6::uuid
              AND a.slot_start < $5::timestamptz AND a.slot_end > $4::timestamptz)
         THEN 'SLOT_TAKEN'
       WHEN EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = $2
              AND a.status = ANY(${ACTIVE}) AND a.id IS DISTINCT FROM $6::uuid
              AND a.slot_start < $5::timestamptz AND a.slot_end > $4::timestamptz)
         THEN 'PATIENT_BUSY'
       WHEN EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = $2 AND a.doctor_id = $1
              AND a.visit_date = $3::date AND a.status = ANY(${ACTIVE})
              AND a.id IS DISTINCT FROM $6::uuid)
         THEN 'ALREADY_BOOKED'
     END AS conflict`,
    [b.doctorId, b.patientId, b.visitDate, b.slotStart, b.slotEnd, ignoreAppointmentId],
  );
  return rows[0]?.conflict ?? undefined;
}

export interface NewAppointment {
  patientId: string;
  doctorId: string;
  departmentId: string;
  scheduleId: string | null;
  kind: 'scheduled' | 'walk_in';
  status: 'booked' | 'checked_in';
  visitDate: string;
  slotStart: string | null;
  slotEnd: string | null;
  tokenNo: number | null;
  rescheduledFromId: string | null;
  userId: string;
}

export async function insertAppointment(db: Queryable, a: NewAppointment): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO appointments (patient_id, doctor_id, department_id, doctor_schedule_id, kind,
       status, visit_date, slot_start, slot_end, token_no, checked_in_at, rescheduled_from_id,
       created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10,
             CASE WHEN $6 = 'checked_in' THEN now() END, $11, $12, $12)
     RETURNING id`,
    [
      a.patientId,
      a.doctorId,
      a.departmentId,
      a.scheduleId,
      a.kind,
      a.status,
      a.visitDate,
      a.slotStart,
      a.slotEnd,
      a.tokenNo,
      a.rescheduledFromId,
      a.userId,
    ],
  );
  return rows[0]!.id;
}

export interface AppointmentRow {
  id: string;
  patientId: string;
  doctorId: string;
  kind: string;
  status: AppointmentStatus;
  visitDate: string;
  slotStart: string | null;
  slotEnd: string | null;
}

export async function lockAppointment(
  db: Queryable,
  id: string,
): Promise<AppointmentRow | undefined> {
  const { rows } = await db.query<AppointmentRow>(
    `SELECT id, patient_id AS "patientId", doctor_id AS "doctorId", kind, status,
            visit_date::text AS "visitDate", slot_start AS "slotStart", slot_end AS "slotEnd"
     FROM appointments WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0];
}

/** The same row without a lock: used to choose advisory locks before locking the row. */
export async function peekAppointment(
  db: Queryable,
  id: string,
): Promise<AppointmentRow | undefined> {
  const { rows } = await db.query<AppointmentRow>(
    `SELECT id, patient_id AS "patientId", doctor_id AS "doctorId", kind, status,
            visit_date::text AS "visitDate", slot_start AS "slotStart", slot_end AS "slotEnd"
     FROM appointments WHERE id = $1`,
    [id],
  );
  return rows[0];
}

export async function setStatus(
  db: Queryable,
  id: string,
  status: AppointmentStatus,
  userId: string,
  extra: { cancelReason?: string; tokenNo?: number } = {},
): Promise<void> {
  await db.query(
    `UPDATE appointments SET status = $2, updated_by = $3,
       cancelled_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE cancelled_at END,
       cancel_reason = CASE WHEN $2 = 'cancelled' THEN $4 ELSE cancel_reason END,
       no_show_at = CASE WHEN $2 = 'no_show' THEN now() ELSE no_show_at END,
       checked_in_at = CASE WHEN $2 = 'checked_in' THEN now() ELSE checked_in_at END,
       token_no = coalesce($5, token_no)
     WHERE id = $1`,
    [id, status, userId, extra.cancelReason ?? null, extra.tokenNo ?? null],
  );
}

const SUMMARY = `a.id, a.appointment_no AS "appointmentNo", a.kind, a.status,
  a.visit_date::text AS "visitDate", a.slot_start AS "slotStart", a.slot_end AS "slotEnd",
  a.token_no AS "tokenNo", a.checked_in_at AS "checkedInAt",
  json_build_object('id', p.id, 'mrn', p.mrn, 'firstName', p.first_name,
                    'lastName', p.last_name) AS patient,
  json_build_object('id', d.id, 'fullName', e.full_name) AS doctor,
  a.department_id AS "departmentId", a.rescheduled_from_id AS "rescheduledFromId"`;
const FROM = `FROM appointments a
  JOIN patients p ON p.id = a.patient_id
  JOIN doctor_profiles d ON d.id = a.doctor_id
  JOIN employees e ON e.id = d.employee_id`;

/** `doctorId` null = every doctor (only for callers allowed to see all). */
export async function listAppointments(
  db: Queryable,
  f: { date: string; doctorId: string | null; status?: AppointmentStatus },
): Promise<AppointmentSummary[]> {
  const { rows } = await db.query<AppointmentSummary>(
    `SELECT ${SUMMARY} ${FROM}
     WHERE a.visit_date = $1::date AND ($2::uuid IS NULL OR a.doctor_id = $2)
       AND ($3::text IS NULL OR a.status = $3)
     ORDER BY a.slot_start NULLS LAST, a.token_no NULLS LAST, a.appointment_no`,
    [f.date, f.doctorId, f.status ?? null],
  );
  return rows;
}

/** Checked-in and in-consultation appointments, in token order. */
export async function listQueue(
  db: Queryable,
  f: { date: string; doctorId: string | null },
): Promise<AppointmentSummary[]> {
  const { rows } = await db.query<AppointmentSummary>(
    `SELECT ${SUMMARY} ${FROM}
     WHERE a.visit_date = $1::date AND ($2::uuid IS NULL OR a.doctor_id = $2)
       AND a.status IN ('checked_in', 'in_consultation')
     ORDER BY e.full_name, a.doctor_id, a.token_no`,
    [f.date, f.doctorId],
  );
  return rows;
}

export async function findAppointment(
  db: Queryable,
  id: string,
): Promise<AppointmentDetail | undefined> {
  const { rows } = await db.query<AppointmentDetail>(
    `SELECT ${SUMMARY}, a.cancelled_at AS "cancelledAt", a.cancel_reason AS "cancelReason",
            a.no_show_at AS "noShowAt", a.created_at AS "createdAt", a.updated_at AS "updatedAt"
     ${FROM} WHERE a.id = $1`,
    [id],
  );
  return rows[0];
}

const SCHEDULE = `id, doctor_id AS "doctorId", weekday, to_char(start_time, 'HH24:MI') AS "startTime",
  to_char(end_time, 'HH24:MI') AS "endTime", slot_minutes AS "slotMinutes",
  valid_from::text AS "validFrom", valid_to::text AS "validTo", active`;

export async function listSchedules(db: Queryable, doctorId: string): Promise<DoctorSchedule[]> {
  const { rows } = await db.query<DoctorSchedule>(
    `SELECT ${SCHEDULE} FROM doctor_schedules WHERE doctor_id = $1
     ORDER BY active DESC, weekday, start_time`,
    [doctorId],
  );
  return rows;
}

export async function insertSchedule(
  db: Queryable,
  s: Omit<DoctorSchedule, 'id' | 'active'>,
  userId: string,
): Promise<DoctorSchedule> {
  const { rows } = await db.query<DoctorSchedule>(
    `INSERT INTO doctor_schedules (doctor_id, weekday, start_time, end_time, slot_minutes,
       valid_from, valid_to, created_by, updated_by)
     VALUES ($1, $2, $3::time, $4::time, $5, $6::date, $7::date, $8, $8)
     RETURNING ${SCHEDULE}`,
    [s.doctorId, s.weekday, s.startTime, s.endTime, s.slotMinutes, s.validFrom, s.validTo, userId],
  );
  return rows[0]!;
}

/** Deactivates one of the doctor's schedules; undefined if there is no such schedule. */
export async function deactivateSchedule(
  db: Queryable,
  doctorId: string,
  scheduleId: string,
  userId: string,
): Promise<DoctorSchedule | undefined> {
  const { rows } = await db.query<DoctorSchedule>(
    `UPDATE doctor_schedules SET active = false, updated_by = $3
     WHERE id = $1 AND doctor_id = $2 RETURNING ${SCHEDULE}`,
    [scheduleId, doctorId, userId],
  );
  return rows[0];
}
