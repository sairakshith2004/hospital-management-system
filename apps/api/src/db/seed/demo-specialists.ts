/**
 * More clinical departments and doctors for hms_dev, so the hospital looks like a real
 * multispecialty hospital: 15 more departments (cardiology, neurology, obstetrics and
 * gynaecology, …) and 20 more doctors, each with a login (username = first name), a doctor
 * profile and weekly consultation hours. Every name, registration number and fee is invented.
 *
 * The new accounts reuse the existing demo doctors' password: the caller passes the password
 * hash already stored for a demo doctor, so no new password is created, printed or stored in
 * code. Runs inside the caller's transaction as hms_app. Safe to re-run: rows are added only
 * when missing (departments by code, staff by employee number, schedules per doctor and
 * weekday); nothing is updated or deleted. One audit row with counts when something was added.
 */
import { HOSPITAL_TIME_ZONE } from '@hospitalos/shared';
import { SYSTEM, recordAudit } from '../../lib/audit.js';
import type { Queryable } from '../client.js';

const LOCK = 4_200_409;

export const SPECIALIST_DEPARTMENTS: [code: string, name: string][] = [
  ['CARDIO', 'Cardiology'],
  ['NEURO', 'Neurology'],
  ['GASTRO', 'Gastroenterology'],
  ['PULMO', 'Pulmonology'],
  ['NEPHRO', 'Nephrology'],
  ['ENDO', 'Endocrinology'],
  ['OBGYN', 'Obstetrics and Gynaecology'],
  ['OPHTHAL', 'Ophthalmology'],
  ['PSYCH', 'Psychiatry'],
  ['URO', 'Urology'],
  ['ONCO', 'Oncology'],
  ['GEN_SURG', 'General Surgery'],
  ['DENTAL', 'Dental'],
  ['PHYSIO', 'Physiotherapy'],
  ['EMERG', 'Emergency Medicine'],
];

/** Weekly hours: morning or afternoon session on the given ISO weekdays (1 = Monday). */
type Hours = { days: number[]; start: string; end: string };
const MORNING_6: Hours = { days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '13:00' };
const AFTERNOON_6: Hours = { days: [1, 2, 3, 4, 5, 6], start: '14:00', end: '18:00' };
const MWF: Hours = { days: [1, 3, 5], start: '10:00', end: '14:00' };
const TTS: Hours = { days: [2, 4, 6], start: '10:00', end: '14:00' };
const EVENING_5: Hours = { days: [1, 2, 3, 4, 5], start: '17:00', end: '20:00' };

export interface SpecialistDoctor {
  username: string;
  employeeNo: string;
  fullName: string;
  department: string;
  specialty: string;
  registrationNo: string;
  feePaise: number;
  slotMinutes: number;
  hours: Hours;
}

type Row = [
  username: string,
  fullName: string,
  department: string,
  specialty: string,
  feeRupees: number,
  slotMinutes: number,
  hours: Hours,
];

const ROWS: Row[] = [
  ['sanjay', 'Dr. Sanjay Kulkarni', 'CARDIO', 'Cardiologist', 900, 20, MORNING_6],
  ['nisha', 'Dr. Nisha Varma', 'CARDIO', 'Interventional Cardiologist', 1000, 20, AFTERNOON_6],
  ['rahul', 'Dr. Rahul Bhatt', 'NEURO', 'Neurologist', 900, 20, MWF],
  ['divya', 'Dr. Divya Krishnan', 'GASTRO', 'Gastroenterologist', 800, 20, TTS],
  ['farhan', 'Dr. Farhan Qureshi', 'PULMO', 'Pulmonologist', 700, 15, MORNING_6],
  ['lakshman', 'Dr. Lakshman Reddy', 'NEPHRO', 'Nephrologist', 800, 20, MWF],
  ['shalini', 'Dr. Shalini Gupta', 'ENDO', 'Endocrinologist', 750, 20, TTS],
  ['pooja', 'Dr. Pooja Hegde', 'OBGYN', 'Obstetrician and Gynaecologist', 700, 15, MORNING_6],
  ['radhika', 'Dr. Radhika Sen', 'OBGYN', 'Gynaecologist', 700, 15, AFTERNOON_6],
  ['amit', 'Dr. Amit Joshi', 'OPHTHAL', 'Ophthalmologist', 500, 15, MORNING_6],
  ['neha', 'Dr. Neha Kapoor', 'PSYCH', 'Psychiatrist', 900, 30, EVENING_5],
  ['harish', 'Dr. Harish Patil', 'URO', 'Urologist', 800, 20, TTS],
  ['sunita', 'Dr. Sunita Mishra', 'ONCO', 'Medical Oncologist', 1200, 30, MWF],
  ['manoj', 'Dr. Manoj Pillai', 'GEN_SURG', 'General Surgeon', 700, 20, MORNING_6],
  ['tanvi', 'Dr. Tanvi Shetty', 'DENTAL', 'Dental Surgeon', 400, 30, AFTERNOON_6],
  ['karan', 'Dr. Karan Malhotra', 'PHYSIO', 'Physiotherapist', 400, 30, MORNING_6],
  ['zoya', 'Dr. Zoya Khan', 'EMERG', 'Emergency Physician', 600, 15, EVENING_5],
  ['deepak', 'Dr. Deepak Chauhan', 'GEN_MED', 'General Physician', 450, 15, AFTERNOON_6],
  ['ritu', 'Dr. Ritu Agarwal', 'PAED', 'Paediatrician', 550, 15, AFTERNOON_6],
  ['vinod', 'Dr. Vinod Rao', 'ORTHO', 'Orthopaedic Surgeon', 700, 20, AFTERNOON_6],
];

export const SPECIALIST_DOCTORS: SpecialistDoctor[] = ROWS.map(
  ([username, fullName, department, specialty, feeRupees, slotMinutes, hours], i) => ({
    username,
    employeeNo: `DEMO-${String(107 + i)}`,
    fullName,
    department,
    specialty,
    registrationNo: `DEMO-REG-${String(7 + i).padStart(4, '0')}`,
    feePaise: feeRupees * 100,
    slotMinutes,
    hours,
  }),
);

export interface DemoSpecialistsResult {
  departments: number;
  employees: number;
  users: number;
  doctors: number;
  /** Weekly consultation sessions (doctor + weekday) added. */
  scheduleRows: number;
}

export async function seedDemoSpecialists(
  db: Queryable,
  { passwordHash }: { passwordHash: string },
): Promise<DemoSpecialistsResult> {
  await db.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
  const n = async (sql: string, params: unknown[]) => (await db.query(sql, params)).rowCount ?? 0;
  const D = SPECIALIST_DOCTORS;

  const departments = await n(
    `INSERT INTO departments (code, name, is_clinical)
     SELECT code, name, true FROM unnest($1::text[], $2::text[]) AS t(code, name)
     ON CONFLICT DO NOTHING RETURNING id`,
    [SPECIALIST_DEPARTMENTS.map(([c]) => c), SPECIALIST_DEPARTMENTS.map(([, name]) => name)],
  );
  const employees = await n(
    `INSERT INTO employees (employee_no, full_name, department_id, designation)
     SELECT t.no, t.name, d.id, 'Consultant'
     FROM unnest($1::text[], $2::text[], $3::text[]) AS t(no, name, dept)
     JOIN departments d ON d.code = t.dept
     ON CONFLICT (employee_no) DO NOTHING RETURNING id`,
    [D.map((d) => d.employeeNo), D.map((d) => d.fullName), D.map((d) => d.department)],
  );
  const users = await n(
    `INSERT INTO users (employee_id, username, password_hash)
     SELECT e.id, t.username, $3
     FROM unnest($1::text[], $2::text[]) AS t(username, no)
     JOIN employees e ON e.employee_no = t.no
     ON CONFLICT DO NOTHING RETURNING id`,
    [D.map((d) => d.username), D.map((d) => d.employeeNo), passwordHash],
  );
  // The DOC role only for these doctors' own accounts.
  await db.query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT u.id, r.id
     FROM unnest($1::text[], $2::text[]) AS t(username, no)
     JOIN users u ON u.username = t.username
     JOIN employees e ON e.id = u.employee_id AND e.employee_no = t.no
     JOIN roles r ON r.code = 'DOC'
     ON CONFLICT DO NOTHING`,
    [D.map((d) => d.username), D.map((d) => d.employeeNo)],
  );
  const doctors = await n(
    `INSERT INTO doctor_profiles
       (employee_id, department_id, specialty, registration_no, default_slot_minutes, consultation_fee_paise)
     SELECT e.id, e.department_id, t.specialty, t.reg, t.slot, t.fee
     FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::bigint[]) AS t(no, specialty, reg, slot, fee)
     JOIN employees e ON e.employee_no = t.no
     ON CONFLICT DO NOTHING RETURNING id`,
    [
      D.map((d) => d.employeeNo),
      D.map((d) => d.specialty),
      D.map((d) => d.registrationNo),
      D.map((d) => d.slotMinutes),
      D.map((d) => d.feePaise),
    ],
  );
  let scheduleRows = 0;
  for (const d of D) {
    scheduleRows += await n(
      `INSERT INTO doctor_schedules (doctor_id, weekday, start_time, end_time, slot_minutes, valid_from)
       SELECT p.id, w.weekday, $2::time, $3::time, p.default_slot_minutes,
              (now() AT TIME ZONE '${HOSPITAL_TIME_ZONE}')::date
       FROM doctor_profiles p
       JOIN employees e ON e.id = p.employee_id AND e.employee_no = $1
       CROSS JOIN unnest($4::smallint[]) AS w(weekday)
       WHERE p.active AND NOT EXISTS (
         SELECT 1 FROM doctor_schedules s WHERE s.doctor_id = p.id AND s.weekday = w.weekday AND s.active)
       RETURNING id`,
      [d.employeeNo, d.hours.start, d.hours.end, d.hours.days],
    );
  }

  const result = { departments, employees, users, doctors, scheduleRows };
  if (Object.values(result).some((v) => v > 0)) {
    await recordAudit(
      db,
      {
        actor: SYSTEM,
        action: 'demo_seed.specialists_applied',
        entityType: 'system',
        changes: { ...result },
      },
      { requestId: null, ip: null },
    );
  }
  return result;
}
