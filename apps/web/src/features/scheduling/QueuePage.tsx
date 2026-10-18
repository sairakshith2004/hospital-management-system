import { hospitalToday } from '@hospitalos/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '../../components/ui/alert';
import { EmptyState } from '../../components/ui/empty-state';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Select } from '../../components/ui/select';
import { Spinner } from '../../components/ui/spinner';
import { Table, Td, Th } from '../../components/ui/table';
import { formatDate, formatTime } from '../../lib/format';
import { useAuth } from '../auth/auth-context';
import { listDoctors } from '../doctors/doctors-api';
import { QueueRowActions } from './QueueRowActions';
import { getQueue, schedulingKeys } from './scheduling-api';
import { StatusBadge } from './status';

/** Refreshes every 15 seconds so new check-ins appear without reloading. */
export function QueuePage() {
  const { can } = useAuth();
  const allDoctors = can('appointment:read_all');
  const [date, setDate] = useState(hospitalToday());
  const [doctorId, setDoctorId] = useState('');
  const doctors = useQuery({
    queryKey: ['doctors'],
    queryFn: ({ signal }) => listDoctors(signal),
    enabled: allDoctors && can('schedule:read'),
  });
  const queue = useQuery({
    queryKey: schedulingKeys.queue(date, doctorId),
    queryFn: ({ signal }) => getQueue({ date, ...(doctorId ? { doctorId } : {}) }, signal),
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title={allDoctors ? 'Patient queue' : 'My queue'}
        description={`${formatDate(date)} · checked-in patients in token order`}
      />
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <FormField id="queue-date" label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
        {allDoctors && (
          <FormField id="queue-doctor" label="Doctor">
            <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">All doctors</option>
              {doctors.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName} — {d.departmentName}
                </option>
              ))}
            </Select>
          </FormField>
        )}
      </div>
      {queue.isPending && <Spinner label="Loading queue…" />}
      {queue.isError && (
        <Alert tone="error">
          {queue.error.message === 'You do not have permission to do this'
            ? 'Your account is not linked to a doctor profile, so there is no queue to show.'
            : `Couldn't load the queue: ${queue.error.message}`}
        </Alert>
      )}
      {queue.isSuccess && queue.data.queue.length === 0 && (
        <EmptyState title="No one is waiting">
          Checked-in patients appear here automatically.
        </EmptyState>
      )}
      {queue.isSuccess && queue.data.queue.length > 0 && (
        <Table aria-label="Queue">
          <thead>
            <tr>
              <Th>Token</Th>
              <Th>Patient</Th>
              {allDoctors && <Th>Doctor</Th>}
              <Th>Checked in</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {queue.data.queue.map((a) => (
              <tr key={a.id}>
                <Td className="text-lg font-semibold tabular-nums">{a.tokenNo}</Td>
                <Td>
                  <Link
                    className="text-brand-700 hover:underline dark:text-brand-400"
                    to={`/appointments/${a.id}`}
                  >
                    {a.patient.firstName} {a.patient.lastName}
                  </Link>
                  <span className="block font-mono text-xs text-slate-500">{a.patient.mrn}</span>
                </Td>
                {allDoctors && <Td>{a.doctor.fullName}</Td>}
                <Td className="tabular-nums">{a.checkedInAt ? formatTime(a.checkedInAt) : '—'}</Td>
                <Td>
                  <StatusBadge status={a.status} />
                </Td>
                <Td>
                  <QueueRowActions appointment={a} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
