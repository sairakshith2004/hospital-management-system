import type { AuditRow } from '@hospitalos/shared';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Spinner } from '../../components/ui/spinner';
import { Table, Td, Th } from '../../components/ui/table';
import { formatDateTime } from '../../lib/format';
import { useApi } from '../../lib/use-api';

/** Read-only audit trail. Each search is itself recorded once. Patients appear by MRN only. */
export function AuditPage() {
  const [draft, setDraft] = useState({ action: '', entityType: '', from: '', to: '' });
  const [filters, setFilters] = useState(draft);
  const [before, setBefore] = useState<number | null>(null);
  const params = new URLSearchParams(
    Object.entries({ ...filters, ...(before ? { before: String(before) } : {}) }).filter(
      ([, v]) => v,
    ) as [string, string][],
  );
  const q = useApi<{ rows: AuditRow[] }>(`/api/admin/audit?${params.toString()}`, {
    staleTime: Infinity,
  });
  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit log"
        description="Append-only: entries can't be changed or deleted by anyone."
      />
      <form
        className="grid gap-3 sm:grid-cols-5 sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setBefore(null);
          setFilters(draft);
        }}
      >
        <FormField id="au-action" label="Action starts with">
          <Input
            value={draft.action}
            onChange={(e) => setDraft({ ...draft, action: e.target.value })}
            placeholder="e.g. appointment."
          />
        </FormField>
        <FormField id="au-entity" label="Entity type">
          <Input
            value={draft.entityType}
            onChange={(e) => setDraft({ ...draft, entityType: e.target.value })}
          />
        </FormField>
        <FormField id="au-from" label="From">
          <Input
            type="date"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </FormField>
        <FormField id="au-to" label="To">
          <Input
            type="date"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </FormField>
        <Button type="submit">Search</Button>
      </form>
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{q.error.message}</Alert>}
      {q.data && q.data.rows.length === 0 && <EmptyState title="No matching entries" />}
      {q.data && q.data.rows.length > 0 && (
        <>
          <Table aria-label="Audit entries">
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
                <Th>Patient</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((r) => (
                <tr key={r.id}>
                  <Td className="text-xs">{formatDateTime(r.occurredAt)}</Td>
                  <Td className="text-xs">{r.actor ?? r.actorType}</Td>
                  <Td className="font-mono text-xs">{r.action}</Td>
                  <Td className="text-xs">
                    {r.entityType}
                    {r.entityId ? ` · ${r.entityId.slice(0, 36)}` : ''}
                  </Td>
                  <Td className="font-mono text-xs">{r.patientMrn ?? ''}</Td>
                  <Td className="max-w-xs text-xs break-words">
                    {r.reason ? `${r.reason} ` : ''}
                    {r.changes ? JSON.stringify(r.changes) : ''}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {q.data.rows.length === 100 && (
            <Button variant="secondary" onClick={() => setBefore(q.data.rows[99]!.id)}>
              Older entries
            </Button>
          )}
        </>
      )}
    </div>
  );
}
