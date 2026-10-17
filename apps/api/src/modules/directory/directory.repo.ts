import type { Department, DoctorListItem } from '@hospitalos/shared';
import type { Queryable } from '../../db/client.js';

export async function listDepartments(db: Queryable): Promise<Department[]> {
  const { rows } = await db.query<Department>(
    `SELECT id, code, name, is_clinical AS "isClinical"
     FROM departments WHERE active ORDER BY name`,
  );
  return rows;
}

/** Active doctors whose employment is active, optionally in one department. */
export async function listDoctors(db: Queryable, departmentId?: string): Promise<DoctorListItem[]> {
  const { rows } = await db.query<DoctorListItem>(
    `SELECT d.id, e.full_name AS "fullName", d.department_id AS "departmentId",
            dep.name AS "departmentName", d.specialty,
            d.default_slot_minutes AS "defaultSlotMinutes",
            d.consultation_fee_paise::int AS "consultationFeePaise"
     FROM doctor_profiles d
     JOIN employees e ON e.id = d.employee_id
     JOIN departments dep ON dep.id = d.department_id
     WHERE d.active AND e.employment_status = 'active' AND dep.active
       AND ($1::uuid IS NULL OR d.department_id = $1)
     ORDER BY dep.name, e.full_name`,
    [departmentId ?? null],
  );
  return rows;
}
