import { hospitalToday, type DoctorReport, type DoctorReportRow } from '@hospitalos/shared';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Spinner } from '../../components/ui/spinner';
import { Stat } from '../../components/ui/stat';
import { Table, Td, Th } from '../../components/ui/table';
import { formatDate, formatRupees } from '../../lib/format';
import { useApi } from '../../lib/use-api';

export const doctorReportPath = (from: string, to: string) =>
  `/api/reports/doctors?from=${from}&to=${to}`;

/** First day of the month containing `day` (YYYY-MM-DD). */
export const monthStart = (day: string) => `${day.slice(0, 8)}01`;

/** Live report data: refreshes every 30 s so new bookings and check-ins show up. */
export function useDoctorReport(from: string, to: string) {
  return useApi<{ report: DoctorReport }>(doctorReportPath(from, to), {
    refetchInterval: 30_000,
  });
}

const paise = (s: string) => formatRupees(Number(s));
const sum = (rows: DoctorReportRow[], pick: (r: DoctorReportRow) => number) =>
  rows.reduce((t, r) => t + pick(r), 0);

/**
 * Per-doctor patient counts ("visits") or consultation earnings ("earnings") for a date
 * range. Which doctors and whether earnings appear are decided by the API.
 */
export function DoctorReportPage({ view }: { view: 'visits' | 'earnings' }) {
  const today = hospitalToday();
  const [from, setFrom] = useState(view === 'earnings' ? monthStart(today) : today);
  const [to, setTo] = useState(today);
  const q = useDoctorReport(from, to);
  const report = q.data?.report;
  const own = report?.scope === 'own';
  const rows = report?.rows ?? [];
  const range = from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;

  const title =
    view === 'earnings'
      ? own
        ? 'My earnings'
        : 'Doctor earnings'
      : own
        ? 'My patients'
        : 'Patients per doctor';
  const description =
    view === 'earnings'
      ? `Consultation fees billed for visits on ${range}, from real invoices (void invoices and removed lines excluded). Not salary or payout figures.`
      : `Appointments for each doctor on ${range}. Cancelled visits are counted separately and not included in the patient total.`;

  return (
    <div className="space-y-4">
      <PageHeader title={title} description={description} />
      <div className="flex flex-wrap items-end gap-3">
        <FormField id="dr-from" label="From">
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </FormField>
        <FormField id="dr-to" label="To">
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </FormField>
        <Button
          variant="secondary"
          onClick={() => {
            setFrom(today);
            setTo(today);
          }}
        >
          Today
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setFrom(monthStart(today));
            setTo(today);
          }}
        >
          This month
        </Button>
      </div>

      {q.isPending && <Spinner label="Loading…" />}
      {q.isError && <Alert tone="error">Couldn&apos;t load the report: {q.error.message}</Alert>}
      {report && rows.length === 0 && (
        <EmptyState title="No doctors">No active doctor profiles were found.</EmptyState>
      )}

      {report && rows.length > 0 && view === 'visits' && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Patients" value={sum(rows, (r) => r.visits.patients)} />
            <Stat label="Waiting now" value={sum(rows, (r) => r.visits.waiting)} />
            <Stat label="Seen" value={sum(rows, (r) => r.visits.seen)} />
            <Stat
              label="No-shows"
              value={sum(rows, (r) => r.visits.noShow)}
              tone={sum(rows, (r) => r.visits.noShow) > 0 ? 'warning' : 'default'}
            />
          </div>
          <Table aria-label="Patients per doctor">
            <thead>
              <tr>
                <Th>Doctor</Th>
                <Th className="text-right">Patients</Th>
                <Th className="text-right">Booked</Th>
                <Th className="text-right">Waiting</Th>
                <Th className="text-right">In consultation</Th>
                <Th className="text-right">Seen</Th>
                <Th className="text-right">No-show</Th>
                <Th className="text-right">Cancelled</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.doctorId}>
                  <Td>
                    <span className="font-medium">{r.fullName}</span>
                    <span className="block text-xs text-slate-500">{r.departmentName ?? '—'}</span>
                  </Td>
                  <Td className="text-right font-semibold tabular-nums">{r.visits.patients}</Td>
                  <Td className="text-right tabular-nums">{r.visits.booked}</Td>
                  <Td className="text-right tabular-nums">{r.visits.waiting}</Td>
                  <Td className="text-right tabular-nums">{r.visits.inConsultation}</Td>
                  <Td className="text-right tabular-nums">{r.visits.seen}</Td>
                  <Td className="text-right tabular-nums">{r.visits.noShow}</Td>
                  <Td className="text-right tabular-nums">{r.visits.cancelled}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}

      {report && rows.length > 0 && view === 'earnings' && (
        <>
          {rows.every((r) => r.earnings === null) ? (
            <Alert tone="info">
              Earnings are visible to finance, administration and each doctor.
            </Alert>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <Stat
                  label="Consultations billed"
                  value={sum(rows, (r) => r.earnings?.consultations ?? 0)}
                />
                <Stat
                  label="Fees billed"
                  value={formatRupees(sum(rows, (r) => Number(r.earnings?.billedPaise ?? 0)))}
                />
                <Stat
                  label="On fully paid invoices"
                  value={formatRupees(sum(rows, (r) => Number(r.earnings?.paidPaise ?? 0)))}
                />
              </div>
              <Table aria-label="Doctor earnings">
                <thead>
                  <tr>
                    <Th>Doctor</Th>
                    <Th className="text-right">Patients</Th>
                    <Th className="text-right">Consultations billed</Th>
                    <Th className="text-right">Fees billed</Th>
                    <Th className="text-right">On fully paid invoices</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.doctorId}>
                      <Td>
                        <span className="font-medium">{r.fullName}</span>
                        <span className="block text-xs text-slate-500">
                          {r.departmentName ?? '—'}
                        </span>
                      </Td>
                      <Td className="text-right tabular-nums">{r.visits.patients}</Td>
                      <Td className="text-right tabular-nums">
                        {r.earnings?.consultations ?? '—'}
                      </Td>
                      <Td className="text-right font-semibold tabular-nums">
                        {r.earnings ? paise(r.earnings.billedPaise) : '—'}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {r.earnings ? paise(r.earnings.paidPaise) : '—'}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          )}
        </>
      )}
    </div>
  );
}
