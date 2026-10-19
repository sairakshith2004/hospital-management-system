/**
 *   GET /api/reports/doctors?from=&to=   appointment:read_all | report:finance | encounter:write
 *
 * Per-doctor patient counts and consultation earnings for visit dates in the range.
 * Scope, decided on the server only:
 *   - appointment:read_all (reception, administration): every doctor's counts;
 *   - report:finance (finance, administration): every doctor's counts and earnings;
 *   - otherwise a doctor (encounter:write) gets only their own row, earnings included, and
 *     403 (audited) without an active doctor profile.
 * Earnings are consultation fees on real invoice lines (active, invoice not void), never
 * salaries or payouts. Read-only aggregates: no patient names or clinical data.
 */
import {
  doctorReportQuerySchema,
  type DoctorReport,
  type DoctorReportRow,
} from '@hospitalos/shared';
import { Router } from 'express';
import type { Database } from '../../db/client.js';
import { denyAccess, requireAnyPermission, requireUser } from '../../middleware/auth.js';
import { doctorIdOfUser } from '../scheduling/scheduling.repo.js';

interface Row {
  doctor_id: string;
  full_name: string;
  department_name: string | null;
  patients: number;
  booked: number;
  waiting: number;
  in_consultation: number;
  seen: number;
  no_show: number;
  cancelled: number;
  consultations: number;
  billed_paise: string;
  paid_paise: string;
}

export async function doctorReport(
  db: Database,
  { from, to, doctorId }: { from: string; to: string; doctorId: string | null },
): Promise<Row[]> {
  const { rows } = await db.query<Row>(
    `WITH docs AS (
       SELECT d.id, e.full_name, dep.name AS department_name
         FROM doctor_profiles d
         JOIN employees e ON e.id = d.employee_id
         LEFT JOIN departments dep ON dep.id = d.department_id
        WHERE d.active AND ($3::uuid IS NULL OR d.id = $3)
     ), visits AS (
       SELECT doctor_id,
              count(*) FILTER (WHERE status <> 'cancelled')::int AS patients,
              count(*) FILTER (WHERE status = 'booked')::int AS booked,
              count(*) FILTER (WHERE status = 'checked_in')::int AS waiting,
              count(*) FILTER (WHERE status = 'in_consultation')::int AS in_consultation,
              count(*) FILTER (WHERE status = 'completed')::int AS seen,
              count(*) FILTER (WHERE status = 'no_show')::int AS no_show,
              count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
         FROM appointments
        WHERE visit_date BETWEEN $1::date AND $2::date
        GROUP BY doctor_id
     ), fees AS (
       SELECT a.doctor_id,
              count(*)::int AS consultations,
              sum(ii.line_total_paise)::bigint AS billed,
              coalesce(sum(ii.line_total_paise) FILTER (WHERE i.status = 'paid'), 0)::bigint AS paid
         FROM invoice_items ii
         JOIN invoices i ON i.id = ii.invoice_id
         JOIN appointments a ON a.id = ii.consultation_appointment_id
        WHERE ii.source_type = 'consultation' AND ii.is_active AND i.status <> 'void'
          AND a.visit_date BETWEEN $1::date AND $2::date
        GROUP BY a.doctor_id
     )
     SELECT docs.id AS doctor_id, docs.full_name, docs.department_name,
            coalesce(v.patients, 0) AS patients, coalesce(v.booked, 0) AS booked,
            coalesce(v.waiting, 0) AS waiting, coalesce(v.in_consultation, 0) AS in_consultation,
            coalesce(v.seen, 0) AS seen, coalesce(v.no_show, 0) AS no_show,
            coalesce(v.cancelled, 0) AS cancelled,
            coalesce(f.consultations, 0) AS consultations,
            coalesce(f.billed, 0)::text AS billed_paise, coalesce(f.paid, 0)::text AS paid_paise
       FROM docs
       LEFT JOIN visits v ON v.doctor_id = docs.id
       LEFT JOIN fees f ON f.doctor_id = docs.id
      ORDER BY docs.full_name, docs.id`,
    [from, to, doctorId],
  );
  return rows;
}

export function reportRoutes(db: Database): Router {
  const router = Router();

  router.get(
    '/reports/doctors',
    requireAnyPermission(db, ['appointment:read_all', 'report:finance', 'encounter:write']),
    async (req, res) => {
      const { from, to } = doctorReportQuerySchema.parse(req.query);
      const user = requireUser(res);
      const seesAll = user.can('appointment:read_all') || user.can('report:finance');
      const ownDoctorId = await doctorIdOfUser(db, user.id);
      if (!seesAll && !ownDoctorId) await denyAccess(db, req, res, 'encounter:write');

      const rows = await doctorReport(db, { from, to, doctorId: seesAll ? null : ownDoctorId! });
      const report: DoctorReport = {
        from,
        to,
        scope: seesAll ? 'all' : 'own',
        rows: rows.map((r): DoctorReportRow => ({
          doctorId: r.doctor_id,
          fullName: r.full_name,
          departmentName: r.department_name,
          visits: {
            patients: r.patients,
            booked: r.booked,
            waiting: r.waiting,
            inConsultation: r.in_consultation,
            seen: r.seen,
            noShow: r.no_show,
            cancelled: r.cancelled,
          },
          // Finance sees everyone's earnings; a doctor sees only their own.
          earnings:
            user.can('report:finance') || r.doctor_id === ownDoctorId
              ? {
                  consultations: r.consultations,
                  billedPaise: r.billed_paise,
                  paidPaise: r.paid_paise,
                }
              : null,
        })),
      };
      res.json({ report });
    },
  );

  return router;
}
