import type { VitalSigns } from '@hospitalos/shared';
import { EmptyState } from '../../components/ui/empty-state';
import { Table, Td, Th } from '../../components/ui/table';
import { formatDateTime } from '../../lib/format';
import { cn } from '../../lib/utils';

export function VitalsTable({ vitals }: { vitals: VitalSigns[] }) {
  if (vitals.length === 0) return <EmptyState title="No vital signs recorded" />;
  const v = (x: string | number | null) => (x === null ? '—' : String(Number(x)));
  return (
    <Table aria-label="Vital signs">
      <thead>
        <tr>
          <Th>Recorded</Th>
          <Th>Temp</Th>
          <Th>Pulse</Th>
          <Th>BP</Th>
          <Th>Resp</Th>
          <Th>SpO₂</Th>
          <Th>Wt / Ht</Th>
        </tr>
      </thead>
      <tbody>
        {vitals.map((r) => (
          <tr key={r.id} className={cn(r.enteredInError && 'line-through opacity-60')}>
            <Td className="text-xs">
              {formatDateTime(r.recordedAt)}
              <span className="block text-slate-500">
                {r.recordedBy}
                {r.enteredInError ? ' · entered in error' : ''}
              </span>
            </Td>
            <Td>{v(r.tempC)}</Td>
            <Td>{v(r.pulse)}</Td>
            <Td>{r.bpSys === null ? '—' : `${r.bpSys}/${r.bpDia}`}</Td>
            <Td>{v(r.respRate)}</Td>
            <Td>{v(r.spo2)}</Td>
            <Td>
              {v(r.weightKg)} / {v(r.heightCm)}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
