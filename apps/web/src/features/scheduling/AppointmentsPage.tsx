import { APPOINTMENT_STATUSES, hospitalToday, type AppointmentStatus } from '@hospitalos/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Select } from '../../components/ui/select';
import { Spinner } from '../../components/ui/spinner';
import { Table, Td, Th } from '../../components/ui/table';
import { addDays, formatDate, formatTime } from '../../lib/format';
import { useAuth } from '../auth/auth-context';
import { listDoctors } from '../doctors/doctors-api';
import { AppointmentActions } from './AppointmentActions';
import { listAppointments, schedulingKeys } from './scheduling-api';
import { kindLabel, STATUS_LABELS, StatusBadge } from './status';

export function AppointmentsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? hospitalToday();
  const doctorId = params.get('doctorId') ?? '';
  const status = (params.get('status') ?? '') as AppointmentStatus | '';
  const [notice, setNotice] = useState<string | null>(null);
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const doctors = useQuery({
    queryKey: ['doctors'],
    queryFn: ({ signal }) => listDoctors(signal),
    enabled: can('schedule:read'),
  });
  const list = useQuery({
    queryKey: schedulingKeys.appointments(date, doctorId, status),
    queryFn: ({ signal }) =>
      listAppointments(
        { date, ...(doctorId ? { doctorId } : {}), ...(status ? { status } : {}) },
        signal,
      ),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title={can('appointment:read_all') ? 'Appointments' : 'My appointments'}
        description={formatDate(date)}
        actions={
          can('appointment:book') && (
            <Button asChild>
              <Link to={`/appointments/new?date=${date}${doctorId ? `&doctorId=${doctorId}` : ''}`}>
                Book appointment
              </Link>
            </Button>
          )
        }
      />
      <div className="grid gap-3 sm:grid-cols-[auto_1fr_1fr] sm:items-end">
        <div className="flex items-end gap-2">
          <FormField id="appt-date" label="Date">
            <Input type="date" value={date} onChange={(e) => set('date', e.target.value)} />
          </FormField>
          <Button
            variant="secondary"
            onClick={() => set('date', addDays(date, -1))}
            aria-label="Previous day"
          >
            ‹
          </Button>
          <Button
            variant="secondary"
            onClick={() => set('date', addDays(date, 1))}
            aria-label="Next day"
          >
            ›
          </Button>
        </div>
        {can('appointment:read_all') && (
          <FormField id="appt-doctor" label="Doctor">
            <Select value={doctorId} onChange={(e) => set('doctorId', e.target.value)}>
              <option value="">All doctors</option>
              {doctors.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName} — {d.departmentName}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        <FormField id="appt-status" label="Status">
          <Select value={status} onChange={(e) => set('status', e.target.value)}>
            <option value="">All statuses</option>
            {APPOINTMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      {notice && (
        <Alert tone="success" onClick={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {list.isPending && <Spinner label="Loading appointments…" />}
      {list.isError && (
        <Alert tone="error">Couldn&apos;t load appointments: {list.error.message}</Alert>
      )}
      {list.isSuccess && list.data.length === 0 && (
        <EmptyState title="No appointments">Nothing matches this day and these filters.</EmptyState>
      )}
      {list.isSuccess && list.data.length > 0 && (
        <Table aria-label="Appointments">
          <thead>
            <tr>
              <Th>Time</Th>
              <Th>Token</Th>
              <Th>Patient</Th>
              <Th>Doctor</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {list.data.map((a) => (
              <tr key={a.id}>
                <Td className="tabular-nums">
                  {a.slotStart ? formatTime(a.slotStart) : kindLabel(a.kind)}
                </Td>
                <Td className="tabular-nums">{a.tokenNo ?? '—'}</Td>
                <Td>
                  <Link
                    className="text-brand-700 hover:underline dark:text-brand-400"
                    to={`/appointments/${a.id}`}
                  >
                    {a.patient.firstName} {a.patient.lastName}
                  </Link>
                  <span className="block font-mono text-xs text-slate-500">{a.patient.mrn}</span>
                </Td>
                <Td>{a.doctor.fullName}</Td>
                <Td>
                  <StatusBadge status={a.status} />
                </Td>
                <Td>
                  <AppointmentActions appointment={a} onDone={setNotice} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
