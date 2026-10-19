import type { LabOrderStatus, LabOrderView } from '@hospitalos/shared';
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
  const [tab, setTab] = useState<'' | LabOrderStatus>('');
  const q = useApi<{ orders: LabOrderView[] }>(`/api/lab/orders${tab ? `?status=${tab}` : ''}`, {
    refetchInterval: 20_000,
  });
  return (
    <div className="space-y-4">
      <PageHeader
        title="Lab worklist"
        description="Urgent orders first. Refreshes automatically."
      />
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
      {q.data && q.data.orders.length > 0 && (
        <Table aria-label="Lab orders">
          <thead>
            <tr>
              <Th>Order</Th>
              <Th>Test</Th>
              <Th>Patient</Th>
              <Th>Ordered by</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {q.data.orders.map((o) => (
              <tr key={o.id}>
                <Td>
                  <Link
                    className="font-mono text-brand-700 hover:underline dark:text-brand-400"
                    to={`/lab/orders/${o.id}`}
                  >
                    {o.orderNo}
                  </Link>
                  <span className="block text-xs text-slate-500">
                    {formatDateTime(o.orderedAt)}
                  </span>
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
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
