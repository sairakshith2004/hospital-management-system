import { z } from 'zod';

/** The longest range one doctor report covers. */
export const DOCTOR_REPORT_MAX_DAYS = 366;

/** GET /api/reports/doctors?from=&to= (visit dates, Asia/Kolkata, inclusive). */
export const doctorReportQuerySchema = z
  .strictObject({ from: z.iso.date(), to: z.iso.date() })
  .refine((q) => q.from <= q.to, { message: '"from" must not be after "to"', path: ['to'] })
  .refine(
    (q) =>
      (Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`)) / 86_400_000 <
      DOCTOR_REPORT_MAX_DAYS,
    { message: `The range may cover at most ${DOCTOR_REPORT_MAX_DAYS} days`, path: ['to'] },
  );
export type DoctorReportQuery = z.infer<typeof doctorReportQuerySchema>;

/** Appointment counts for one doctor over the range, by status (cancelled kept apart). */
export interface DoctorVisitCounts {
  /** Every appointment that was not cancelled. */
  patients: number;
  booked: number;
  waiting: number;
  inConsultation: number;
  seen: number;
  noShow: number;
  cancelled: number;
}

/**
 * Consultation fees from real invoice lines (active lines on invoices that are not void),
 * for appointments in the range. Not salary or a payout: only what was billed.
 */
export interface DoctorEarnings {
  consultations: number;
  /** Paise, as a string (bigint). */
  billedPaise: string;
  /** Of billedPaise, the part on invoices that are fully paid. */
  paidPaise: string;
}

export interface DoctorReportRow {
  doctorId: string;
  fullName: string;
  departmentName: string | null;
  visits: DoctorVisitCounts;
  /** Null when the caller may not see this doctor's earnings. */
  earnings: DoctorEarnings | null;
}

export interface DoctorReport {
  from: string;
  to: string;
  /** "all" for reception, administration and finance; "own" for a doctor. */
  scope: 'all' | 'own';
  rows: DoctorReportRow[];
}
