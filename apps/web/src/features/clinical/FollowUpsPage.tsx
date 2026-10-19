import { useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { PageHeader } from '../../components/ui/page-header';
import { Spinner } from '../../components/ui/spinner';
import { Table, Td, Th } from '../../components/ui/table';
import { Tabs } from '../../components/ui/tabs';
import { formatDate } from '../../lib/format';
import { useAction, useApi } from '../../lib/use-api';
import { useAuth } from '../auth/auth-context';

interface Row {
  id: string;
  reason: string;
  dueFrom: string;
  dueTo: string;
  status: string;
  patient: { id: string; mrn: string; firstName: string; lastName: string; phone: string };
  targetDoctor: { id: string; fullName: string } | null;
}

/** Follow-ups recommended by doctors, for reception to book. */
export function FollowUpsPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState<'pending' | 'booked' | 'completed' | 'cancelled'>('pending');
  const q = useApi<{ followUps: Row[] }>(`/api/follow-ups?status=${status}`);
  const set = useAction<{ id: string; status: string }>(
    'POST',
    (b) => `/api/follow-ups/${b.id}/status`,
    { invalidate: ['/api/follow-ups'] },
  );
  return (
    <div className="space-y-4">
      <PageHeader
        title="Follow-ups"
        description="Book the appointment, then mark the follow-up as booked."
      />
      <Tabs
        label="Status"
        value={status}
        onChange={setStatus}
        tabs={[
          { value: 'pending', label: 'To book' },
          { value: 'booked', label: 'Booked' },
          { value: 'completed', label: 'Completed' },
          { value: 'cancelled', label: 'Cancelled' },
        ]}
      />
      {set.error && <Alert tone="error">{set.error}</Alert>}
      {q.isPending && <Spinner />}
      {q.data && q.data.followUps.length === 0 && <EmptyState title="Nothing here" />}
      {q.data && q.data.followUps.length > 0 && (
        <Table aria-label="Follow-ups">
          <thead>
            <tr>
              <Th>Due</Th>
              <Th>Patient</Th>
              <Th>With</Th>
              <Th>Reason</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {q.data.followUps.map((f) => (
              <tr key={f.id}>
                <Td>
                  {formatDate(f.dueFrom)} – {formatDate(f.dueTo)}
                </Td>
                <Td>
                  {f.patient.firstName} {f.patient.lastName}
                  <span className="block font-mono text-xs text-slate-500">
                    {f.patient.mrn} · {f.patient.phone}
                  </span>
                </Td>
                <Td>{f.targetDoctor?.fullName ?? 'Any'}</Td>
                <Td>{f.reason}</Td>
                <Td>
                  {can('followup:schedule') && (
                    <div className="flex flex-wrap gap-1.5">
                      {f.status === 'pending' && (
                        <>
                          <Button asChild size="sm">
                            <Link
                              to={`/appointments/new?patientId=${f.patient.id}${f.targetDoctor ? `&doctorId=${f.targetDoctor.id}` : ''}&date=${f.dueFrom}`}
                            >
                              Book
                            </Link>
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => set.run({ id: f.id, status: 'booked' })}
                          >
                            Mark booked
                          </Button>
                        </>
                      )}
                      {f.status === 'booked' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => set.run({ id: f.id, status: 'completed' })}
                        >
                          Mark completed
                        </Button>
                      )}
                      {(f.status === 'pending' || f.status === 'booked') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => set.run({ id: f.id, status: 'cancelled' })}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
