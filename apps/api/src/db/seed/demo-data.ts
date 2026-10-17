/**
 * Synthetic demo data for hms_dev: departments, staff with one account per role, doctor
 * profiles and patients. Every name, phone number and registration number is invented.
 *
 * Runs inside the caller's transaction as hms_app. Safe to re-run: existing rows are left
 * exactly as they are (never updated, never deleted), so an account's password is never
 * reset. One shared demo password is supplied already hashed; it is never stored in code.
 */
import type { Queryable } from '../client.js';
import { SYSTEM, recordAudit } from '../../lib/audit.js';

// Arbitrary constant; differs from the migration, seed and bootstrap locks.
const DEMO_SEED_LOCK_KEY = 4_200_404;

export const DEMO_DEPARTMENTS = [
  { code: 'GEN_MED', name: 'General Medicine', isClinical: true },
  { code: 'PAED', name: 'Paediatrics', isClinical: true },
  { code: 'ORTHO', name: 'Orthopaedics', isClinical: true },
  { code: 'DERM', name: 'Dermatology', isClinical: true },
  { code: 'ENT', name: 'ENT', isClinical: true },
  { code: 'PHARMACY', name: 'Pharmacy', isClinical: false },
  { code: 'LAB', name: 'Laboratory', isClinical: false },
  { code: 'FRONT_OFFICE', name: 'Front Office', isClinical: false },
  { code: 'ACCOUNTS', name: 'Accounts', isClinical: false },
  { code: 'ADMIN', name: 'Administration', isClinical: false },
] as const;

type DepartmentCode = (typeof DEMO_DEPARTMENTS)[number]['code'];

interface DemoStaff {
  username: string;
  employeeNo: string;
  fullName: string;
  department: DepartmentCode;
  designation: string;
  role: string;
  doctor?: { specialty: string; registrationNo: string; feePaise: number; slotMinutes: number };
}

export const DEMO_STAFF: DemoStaff[] = [
  {
    username: 'rec1',
    employeeNo: 'DEMO-001',
    fullName: 'Priya Sharma',
    department: 'FRONT_OFFICE',
    designation: 'Receptionist',
    role: 'REC',
  },
  {
    username: 'nur1',
    employeeNo: 'DEMO-002',
    fullName: 'Lakshmi Pillai',
    department: 'GEN_MED',
    designation: 'Staff Nurse',
    role: 'NUR',
  },
  {
    username: 'pha1',
    employeeNo: 'DEMO-003',
    fullName: 'Suresh Kumar',
    department: 'PHARMACY',
    designation: 'Pharmacist',
    role: 'PHA',
  },
  {
    username: 'lab1',
    employeeNo: 'DEMO-004',
    fullName: 'Neha Gupta',
    department: 'LAB',
    designation: 'Lab Technician',
    role: 'LAB',
  },
  {
    username: 'fin1',
    employeeNo: 'DEMO-005',
    fullName: 'Rahul Verma',
    department: 'ACCOUNTS',
    designation: 'Billing Officer',
    role: 'FIN',
  },
  {
    username: 'adm1',
    employeeNo: 'DEMO-006',
    fullName: 'Sunita Reddy',
    department: 'ADMIN',
    designation: 'Hospital Administrator',
    role: 'ADM',
  },
  {
    username: 'hr1',
    employeeNo: 'DEMO-007',
    fullName: 'Anil Joshi',
    department: 'ADMIN',
    designation: 'HR Officer',
    role: 'HR',
  },
  {
    username: 'inv1',
    employeeNo: 'DEMO-008',
    fullName: 'Deepak Singh',
    department: 'PHARMACY',
    designation: 'Store Keeper',
    role: 'INV',
  },
  {
    username: 'mkt1',
    employeeNo: 'DEMO-009',
    fullName: 'Pooja Bansal',
    department: 'FRONT_OFFICE',
    designation: 'Outreach Coordinator',
    role: 'MKT',
  },
  {
    username: 'doc1',
    employeeNo: 'DEMO-101',
    fullName: 'Dr. Ananya Rao',
    department: 'GEN_MED',
    designation: 'Consultant',
    role: 'DOC',
    doctor: {
      specialty: 'General Physician',
      registrationNo: 'DEMO-REG-0001',
      feePaise: 50_000,
      slotMinutes: 15,
    },
  },
  {
    username: 'doc2',
    employeeNo: 'DEMO-102',
    fullName: 'Dr. Vikram Shah',
    department: 'PAED',
    designation: 'Consultant',
    role: 'DOC',
    doctor: {
      specialty: 'Paediatrician',
      registrationNo: 'DEMO-REG-0002',
      feePaise: 60_000,
      slotMinutes: 15,
    },
  },
  {
    username: 'doc3',
    employeeNo: 'DEMO-103',
    fullName: 'Dr. Meera Iyer',
    department: 'ORTHO',
    designation: 'Consultant',
    role: 'DOC',
    doctor: {
      specialty: 'Orthopaedic Surgeon',
      registrationNo: 'DEMO-REG-0003',
      feePaise: 80_000,
      slotMinutes: 20,
    },
  },
  {
    username: 'doc4',
    employeeNo: 'DEMO-104',
    fullName: 'Dr. Arjun Menon',
    department: 'DERM',
    designation: 'Consultant',
    role: 'DOC',
    doctor: {
      specialty: 'Dermatologist',
      registrationNo: 'DEMO-REG-0004',
      feePaise: 70_000,
      slotMinutes: 15,
    },
  },
  {
    username: 'doc5',
    employeeNo: 'DEMO-105',
    fullName: 'Dr. Kavya Nair',
    department: 'ENT',
    designation: 'Consultant',
    role: 'DOC',
    doctor: {
      specialty: 'ENT Surgeon',
      registrationNo: 'DEMO-REG-0005',
      feePaise: 60_000,
      slotMinutes: 15,
    },
  },
  {
    username: 'doc6',
    employeeNo: 'DEMO-106',
    fullName: 'Dr. Rohan Das',
    department: 'GEN_MED',
    designation: 'Consultant',
    role: 'DOC',
    doctor: {
      specialty: 'Diabetologist',
      registrationNo: 'DEMO-REG-0006',
      feePaise: 55_000,
      slotMinutes: 15,
    },
  },
];

const FIRST = [
  'Aarav',
  'Diya',
  'Kabir',
  'Isha',
  'Vivaan',
  'Meera',
  'Arjun',
  'Saanvi',
  'Reyansh',
  'Anika',
];
const LAST = ['Agarwal', 'Bose', 'Chopra', 'Desai'];
const SEXES = ['male', 'female'] as const;
const BLOOD = ['O+', 'A+', 'B+', 'AB+', 'O-', null] as const;

/** 40 synthetic patients. Phones are in the reserved-looking 90000xxxxx range. */
export const DEMO_PATIENTS = Array.from({ length: 40 }, (_, i) => {
  const year = 1950 + ((i * 7) % 70);
  const month = String((i % 12) + 1).padStart(2, '0');
  const day = String((i % 27) + 1).padStart(2, '0');
  return {
    firstName: FIRST[i % FIRST.length]!,
    lastName: LAST[Math.floor(i / FIRST.length) % LAST.length]!,
    dob: `${year}-${month}-${day}`,
    sex: SEXES[i % 2]!,
    phone: `90000${String(i + 1).padStart(5, '0')}`,
    address: `${i + 1} Demo Street, Demo City`,
    bloodGroup: BLOOD[i % BLOOD.length] ?? null,
  };
});

export interface DemoSeedResult {
  departments: number;
  employees: number;
  users: number;
  roleGrants: number;
  doctors: number;
  patients: number;
}

export async function seedDemoData(
  db: Queryable,
  { passwordHash }: { passwordHash: string },
): Promise<DemoSeedResult> {
  await db.query('SELECT pg_advisory_xact_lock($1)', [DEMO_SEED_LOCK_KEY]);
  const count = async (sql: string, params: unknown[]) =>
    (await db.query(sql, params)).rowCount ?? 0;

  const departments = await count(
    `INSERT INTO departments (code, name, is_clinical)
     SELECT * FROM unnest($1::text[], $2::text[], $3::boolean[])
     ON CONFLICT DO NOTHING RETURNING id`,
    [
      DEMO_DEPARTMENTS.map((d) => d.code),
      DEMO_DEPARTMENTS.map((d) => d.name),
      DEMO_DEPARTMENTS.map((d) => d.isClinical),
    ],
  );
  const employees = await count(
    `INSERT INTO employees (employee_no, full_name, department_id, designation)
     SELECT t.no, t.name, d.id, t.designation
     FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS t(no, name, dept, designation)
     JOIN departments d ON d.code = t.dept
     ON CONFLICT (employee_no) DO NOTHING RETURNING id`,
    [
      DEMO_STAFF.map((s) => s.employeeNo),
      DEMO_STAFF.map((s) => s.fullName),
      DEMO_STAFF.map((s) => s.department),
      DEMO_STAFF.map((s) => s.designation),
    ],
  );
  const users = await count(
    `INSERT INTO users (employee_id, username, password_hash)
     SELECT e.id, t.username, $3
     FROM unnest($1::text[], $2::text[]) AS t(username, no)
     JOIN employees e ON e.employee_no = t.no
     ON CONFLICT DO NOTHING RETURNING id`,
    [DEMO_STAFF.map((s) => s.username), DEMO_STAFF.map((s) => s.employeeNo), passwordHash],
  );
  // Roles only for the demo accounts' own employees, so a pre-existing account that
  // happens to share a demo username is never given a role.
  const roleGrants = await count(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT u.id, r.id
     FROM unnest($1::text[], $2::text[], $3::text[]) AS t(username, no, role)
     JOIN users u ON u.username = t.username
     JOIN employees e ON e.id = u.employee_id AND e.employee_no = t.no
     JOIN roles r ON r.code = t.role
     ON CONFLICT DO NOTHING RETURNING 1`,
    [
      DEMO_STAFF.map((s) => s.username),
      DEMO_STAFF.map((s) => s.employeeNo),
      DEMO_STAFF.map((s) => s.role),
    ],
  );
  const docs = DEMO_STAFF.filter((s) => s.doctor);
  const doctors = await count(
    `INSERT INTO doctor_profiles
       (employee_id, department_id, specialty, registration_no, default_slot_minutes, consultation_fee_paise)
     SELECT e.id, e.department_id, t.specialty, t.reg, t.slot, t.fee
     FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::bigint[]) AS t(no, specialty, reg, slot, fee)
     JOIN employees e ON e.employee_no = t.no
     ON CONFLICT DO NOTHING RETURNING id`,
    [
      docs.map((s) => s.employeeNo),
      docs.map((s) => s.doctor!.specialty),
      docs.map((s) => s.doctor!.registrationNo),
      docs.map((s) => s.doctor!.slotMinutes),
      docs.map((s) => s.doctor!.feePaise),
    ],
  );
  const patients = await count(
    `INSERT INTO patients (first_name, last_name, dob, sex, phone, address, blood_group)
     SELECT t.first, t.last, t.dob, t.sex, t.phone, t.address, t.blood
     FROM unnest($1::text[], $2::text[], $3::date[], $4::text[], $5::text[], $6::text[], $7::text[])
       AS t(first, last, dob, sex, phone, address, blood)
     WHERE NOT EXISTS (SELECT 1 FROM patients p WHERE p.phone = t.phone AND p.dob = t.dob)
     RETURNING id`,
    [
      DEMO_PATIENTS.map((p) => p.firstName),
      DEMO_PATIENTS.map((p) => p.lastName),
      DEMO_PATIENTS.map((p) => p.dob),
      DEMO_PATIENTS.map((p) => p.sex),
      DEMO_PATIENTS.map((p) => p.phone),
      DEMO_PATIENTS.map((p) => p.address),
      DEMO_PATIENTS.map((p) => p.bloodGroup),
    ],
  );

  const result = { departments, employees, users, roleGrants, doctors, patients };
  if (Object.values(result).some((n) => n > 0)) {
    await recordAudit(
      db,
      { actor: SYSTEM, action: 'demo_seed.applied', entityType: 'system', changes: { ...result } },
      { requestId: null, ip: null },
    );
  }
  return result;
}
