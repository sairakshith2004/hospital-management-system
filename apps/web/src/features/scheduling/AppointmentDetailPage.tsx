import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { NotFoundPage } from '../../app/NotFoundPage';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { PageHeader } from '../../components/ui/page-header';
import { Spinner } from '../../components/ui/spinner';
import { ApiError } from '../../lib/api';
import { formatDate, formatDateTime, formatTime } from '../../lib/format';
import { useAuth } from '../auth/auth-context';
import { AppointmentActions } from './AppointmentActions';
import { getAppointment, schedulingKeys } from './scheduling-api';
import { kindLabel, StatusBadge } from './status';
import { VisitPanel } from './VisitPanel';

export function AppointmentDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const [notice, setNotice] = useState<string | null>(null);
  const q = useQuery({
    queryKey: schedulingKeys.appointment(id),
    queryFn: ({ signal }) => getAppointment(id, signal),
  });
  if (q.isPending) return <Spinner label="Loading appointment…" />;
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404) return <NotFoundPage />;
    return <Alert tone="error">Couldn&apos;t load the appointment: {q.error.message}</Alert>;
  }
  const a = q.data;
  const rows: [string, React.ReactNode][] = [
    ['Number', <span className="font-mono">{a.appointmentNo}</span>],
    ['Status', <StatusBadge status={a.status} />],
    ['Type', kindLabel(a.kind)],
    ['Date', formatDate(a.visitDate)],
    [
      'Time',
      a.slotStart && a.slotEnd ? `${formatTime(a.slotStart)}–${formatTime(a.slotEnd)}` : '—',
    ],
    ['Doctor', a.doctor.fullName],
    ['Token', a.tokenNo ?? '—'],
    ['Checked in', a.checkedInAt ? formatDateTime(a.checkedInAt) : '—'],
  ];
  if (a.cancelledAt)
    rows.push(['Cancelled', `${formatDateTime(a.cancelledAt)} — ${a.cancelReason ?? ''}`]);
  if (a.noShowAt) rows.push(['No-show', formatDateTime(a.noShowAt)]);
  if (a.rescheduledFromId)
    rows.push([
      'Moved from',
      <Link className="text-brand-700 underline" to={`/appointments/${a.rescheduledFromId}`}>
        earlier booking
      </Link>,
    ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${a.patient.firstName} ${a.patient.lastName}`}
        crumbs={[
          { label: 'Appointments', to: `/appointments?date=${a.visitDate}` },
          { label: a.appointmentNo },
        ]}
        actions={
          can('patient:read_demographics') && (
            <Button asChild variant="secondary">
              <Link to={`/patients/${a.patient.id}`}>Patient record</Link>
            </Button>
          )
        }
      />
      {notice && <Alert tone="success">{notice}</Alert>}
      <Card className="space-y-4">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
          <dt className="text-slate-500 dark:text-slate-400">MRN</dt>
          <dd className="font-mono">{a.patient.mrn}</dd>
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <AppointmentActions appointment={a} onDone={setNotice} size="md" />
      </Card>
      <VisitPanel appointment={a} />
    </div>
  );
}
