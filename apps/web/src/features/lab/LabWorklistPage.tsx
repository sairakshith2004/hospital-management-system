import type { LabOrderStatus, LabOrderView, PatientIdentity } from '@hospitalos/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { EmptyState } from '../../components/ui/empty-state';
import { PageHeader } from '../../components/ui/page-header';
import { Spinner } from '../../components/ui/spinner';
import { Table, Td, Th } from '../../components/ui/table';
import { Tabs } from '../../components/ui/tabs';
import { formatDateTime } from '../../lib/format';
import { useApi } from '../../lib/use-api';
import {
  LookupSection,
  PatientIdentityCard,
  PatientNumberSearch,
  useLookupMrn,
} from '../patients/PatientNumberLookup';

export function LabStatus({ status }: { status: LabOrderStatus }) {
  const tone = {
    ordered: 'info',
    collected: 'accent',
    resulted: 'warning',
    verified: 'success',
    cancelled: 'neutral',
  } as const;
  return <Badge tone={tone[status]}>{status}</Badge>;
}

export function LabWorklistPage() {
  const [mrn, setMrn] = useLookupMrn();
  return (
    <div className="space-y-4">
      <PageHeader
        title="Lab worklist"
        description="Urgent orders first. Enter a patient number to see one patient's tests to be done and previous tests."
      />
      <PatientNumberSearch key={mrn ?? ''} mrn={mrn} onSearch={setMrn} />
      {mrn ? <PatientLabOrders mrn={mrn} /> : <LabQueue />}
    </div>
  );
}

function LabQueue() {
  const [tab, setTab] = useState<'' | LabOrderStatus>('');
  const q = useApi<{ orders: LabOrderView[] }>(`/api/lab/orders${tab ? `?status=${tab}` : ''}`, {
    refetchInterval: 20_000,
  });
  return (
    <div className="space-y-4">
      <Tabs
        label="Order status"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: '', label: 'In progress' },
          { value: 'ordered', label: 'To collect' },
          { value: 'collected', label: 'To result' },
          { value: 'resulted', label: 'To verify' },
          { value: 'verified', label: 'Verified' },
        ]}
      />
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{q.error.message}</Alert>}
      {q.data && q.data.orders.length === 0 && <EmptyState title="No orders here" />}
      {q.data && q.data.orders.length > 0 && <LabOrderTable orders={q.data.orders} />}
    </div>
  );
}

function LabOrderTable({
  orders,
  label = 'Lab orders',
  showResults = false,
}: {
  orders: LabOrderView[];
  label?: string;
  showResults?: boolean;
}) {
  return (
    <Table aria-label={label}>
      <thead>
        <tr>
          <Th>Order</Th>
          <Th>Test</Th>
          <Th>Patient</Th>
          <Th>Ordered by</Th>
          <Th>Status</Th>
          {showResults && <Th>Results</Th>}
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id}>
            <Td>
              <Link
                className="font-mono text-brand-700 hover:underline dark:text-brand-400"
                to={`/lab/orders/${o.id}`}
              >
                {o.orderNo}
              </Link>
              <span className="block text-xs text-slate-500">{formatDateTime(o.orderedAt)}</span>
              {o.priority === 'urgent' && <Badge tone="danger">Urgent</Badge>}
            </Td>
            <Td>
              {o.test.name}
              <span className="block text-xs text-slate-500">{o.test.sampleType}</span>
            </Td>
            <Td>
              {o.patient.firstName} {o.patient.lastName}
              <span className="block font-mono text-xs text-slate-500">{o.patient.mrn}</span>
            </Td>
            <Td>{o.doctor.fullName}</Td>
            <Td>
              <LabStatus status={o.status} />
            </Td>
            {showResults && (
              <Td className="text-xs">
                {o.results.length === 0
                  ? '—'
                  : o.results.map((r) => (
                      <span key={r.parameterId} className="block">
                        {r.parameter}: {r.valueNum ?? r.valueText} {r.unit ?? ''}
                        {r.abnormalFlag && r.abnormalFlag !== 'normal' && (
                          <Badge tone="danger" className="ml-1">
                            {r.abnormalFlag}
                          </Badge>
                        )}
                      </span>
                    ))}
              </Td>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

const TO_DO: LabOrderStatus[] = ['ordered', 'collected', 'resulted'];

/** One patient's lab orders, found by patient number. */
function PatientLabOrders({ mrn }: { mrn: string }) {
  const q = useApi<{ patient: PatientIdentity; orders: LabOrderView[] }>(
    `/api/lab/patients/${encodeURIComponent(mrn)}`,
  );
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="error">{q.error.message}</Alert>;
  const { patient, orders } = q.data;
  const toDo = orders.filter((o) => TO_DO.includes(o.status));
  const past = orders.filter((o) => !TO_DO.includes(o.status));
  return (
    <div className="space-y-4">
      <PatientIdentityCard patient={patient}>
        <Badge tone={toDo.length > 0 ? 'warning' : 'neutral'}>{toDo.length} to be done</Badge>
      </PatientIdentityCard>
      <LookupSection title="Tests to be done" count={toDo.length}>
        <LabOrderTable orders={toDo} label="Tests to be done" />
      </LookupSection>
      <LookupSection title="Previous tests" count={past.length}>
        <LabOrderTable orders={past} label="Previous tests" showResults />
      </LookupSection>
    </div>
  );
}
