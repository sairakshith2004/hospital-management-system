import type { Location, StockMovementView } from '@hospitalos/shared';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { EmptyState } from '../../components/ui/empty-state';
import { FormField } from '../../components/ui/form-field';
import { PageHeader } from '../../components/ui/page-header';
import { Select } from '../../components/ui/select';
import { Spinner } from '../../components/ui/spinner';
import { Table, Td, Th } from '../../components/ui/table';
import { formatDateTime } from '../../lib/format';
import { useApi } from '../../lib/use-api';

/** Every stock change, newest first (append-only). */
export function MovementsPage() {
  const [locationId, setLocationId] = useState('');
  const locations = useApi<{ locations: Location[] }>('/api/locations');
  const q = useApi<{ movements: StockMovementView[] }>(
    `/api/stock/movements${locationId ? `?locationId=${locationId}` : ''}`,
  );
  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock movements"
        crumbs={[{ label: 'Stock', to: '/inventory/stock' }, { label: 'Movements' }]}
        description="The latest 200 changes. Movements are never edited or deleted."
      />
      <div className="max-w-xs">
        <FormField id="mv-loc" label="Location">
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">All locations</option>
            {locations.data?.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{q.error.message}</Alert>}
      {q.data && q.data.movements.length === 0 && <EmptyState title="No movements yet" />}
      {q.data && q.data.movements.length > 0 && (
        <Table aria-label="Movements">
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Item / batch</Th>
              <Th>Location</Th>
              <Th>Type</Th>
              <Th>Change</Th>
              <Th>Balance</Th>
              <Th>By / reason</Th>
            </tr>
          </thead>
          <tbody>
            {q.data.movements.map((m) => (
              <tr key={m.id}>
                <Td className="text-xs">{formatDateTime(m.occurredAt)}</Td>
                <Td>
                  {m.item.name}
                  <span className="block font-mono text-xs text-slate-500">{m.batch.batchNo}</span>
                </Td>
                <Td>{m.location.name}</Td>
                <Td>
                  <Badge tone={m.qty > 0 ? 'success' : 'warning'}>{m.kind.replace('_', ' ')}</Badge>
                </Td>
                <Td className="tabular-nums">{m.qty > 0 ? `+${m.qty}` : m.qty}</Td>
                <Td className="tabular-nums">{m.balanceAfter}</Td>
                <Td className="text-xs">
                  {m.performedBy}
                  {m.reason && <span className="block text-slate-500">{m.reason}</span>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
