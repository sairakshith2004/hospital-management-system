import {
  EQUIPMENT_STATUSES,
  MAINTENANCE_KINDS,
  hospitalToday,
  type Department,
} from '@hospitalos/shared';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Dialog } from '../../components/ui/dialog';
import { EmptyState } from '../../components/ui/empty-state';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Select } from '../../components/ui/select';
import { Table, Td, Th } from '../../components/ui/table';
import { Textarea } from '../../components/ui/textarea';
import { formatDate } from '../../lib/format';
import { useAction, useApi } from '../../lib/use-api';
import { useAuth } from '../auth/auth-context';

interface Item {
  id: string;
  assetTag: string;
  name: string;
  category: string | null;
  serialNo: string | null;
  locationNote: string | null;
  status: string;
  nextMaintenanceDue: string | null;
  maintenanceIntervalDays: number | null;
  department: { name: string } | null;
  maintenanceDue: boolean;
}

const TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  in_service: 'success',
  under_maintenance: 'warning',
  out_of_service: 'danger',
  retired: 'neutral',
};

export function EquipmentPage() {
  const { can } = useAuth();
  const q = useApi<{ equipment: Item[] }>('/api/equipment');
  const depts = useApi<{ departments: Department[] }>('/api/departments');
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({
    assetTag: '',
    name: '',
    category: '',
    serialNo: '',
    departmentId: '',
    locationNote: '',
    purchaseDate: '',
    maintenanceIntervalDays: '',
  });
  const [logFor, setLogFor] = useState<Item | null>(null);
  const add = useAction('POST', '/api/equipment', {
    invalidate: ['/api/equipment'],
    onSuccess: () => setAdding(false),
  });
  const status = useAction<{ id: string; status: string; note: string }>(
    'POST',
    (b) => `/api/equipment/${b.id}/status`,
    { invalidate: ['/api/equipment'] },
  );
  const due =
    q.data?.equipment.filter((e) => e.maintenanceDue && e.status !== 'retired').length ?? 0;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Equipment"
        description={due ? `${due} item(s) due for maintenance` : undefined}
        actions={
          can('equipment:manage') &&
          !adding && <Button onClick={() => setAdding(true)}>Register equipment</Button>
        }
      />
      {adding && (
        <Card className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <FormField id="eq-tag" label="Asset tag" required>
              <Input
                value={f.assetTag}
                onChange={(e) => setF({ ...f, assetTag: e.target.value.toUpperCase() })}
              />
            </FormField>
            <FormField id="eq-name" label="Name" required>
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </FormField>
            <FormField id="eq-cat" label="Category">
              <Input
                value={f.category}
                onChange={(e) => setF({ ...f, category: e.target.value })}
              />
            </FormField>
            <FormField id="eq-serial" label="Serial no.">
              <Input
                value={f.serialNo}
                onChange={(e) => setF({ ...f, serialNo: e.target.value })}
              />
            </FormField>
            <FormField id="eq-dept" label="Department">
              <Select
                value={f.departmentId}
                onChange={(e) => setF({ ...f, departmentId: e.target.value })}
              >
                <option value="">—</option>
                {depts.data?.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="eq-loc" label="Location">
              <Input
                value={f.locationNote}
                onChange={(e) => setF({ ...f, locationNote: e.target.value })}
              />
            </FormField>
            <FormField id="eq-bought" label="Purchased">
              <Input
                type="date"
                value={f.purchaseDate}
                onChange={(e) => setF({ ...f, purchaseDate: e.target.value })}
              />
            </FormField>
            <FormField id="eq-int" label="Service every (days)">
              <Input
                inputMode="numeric"
                value={f.maintenanceIntervalDays}
                onChange={(e) => setF({ ...f, maintenanceIntervalDays: e.target.value })}
              />
            </FormField>
          </div>
          {add.error && <Alert tone="error">{add.error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              disabled={!f.assetTag || !f.name || add.pending}
              onClick={() =>
                add.run({
                  ...f,
                  departmentId: f.departmentId || null,
                  purchaseDate: f.purchaseDate || null,
                  maintenanceIntervalDays: f.maintenanceIntervalDays
                    ? Number(f.maintenanceIntervalDays)
                    : null,
                })
              }
            >
              Register
            </Button>
          </div>
        </Card>
      )}
      {status.error && <Alert tone="error">{status.error}</Alert>}
      {q.data && q.data.equipment.length === 0 && <EmptyState title="No equipment registered" />}
      {q.data && q.data.equipment.length > 0 && (
        <Table aria-label="Equipment">
          <thead>
            <tr>
              <Th>Asset</Th>
              <Th>Where</Th>
              <Th>Status</Th>
              <Th>Next service</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {q.data.equipment.map((e) => (
              <tr key={e.id}>
                <Td>
                  <span className="font-mono">{e.assetTag}</span> {e.name}
                  <span className="block text-xs text-slate-500">
                    {[e.category, e.serialNo].filter(Boolean).join(' · ')}
                  </span>
                </Td>
                <Td>
                  {e.department?.name ?? ''} {e.locationNote ?? ''}
                </Td>
                <Td>
                  {can('equipment:manage') && e.status !== 'retired' ? (
                    <Select
                      aria-label={`Status of ${e.name}`}
                      className="h-8"
                      value={e.status}
                      onChange={(ev) =>
                        status.run({ id: e.id, status: ev.target.value, note: 'Status updated' })
                      }
                    >
                      {EQUIPMENT_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s.replaceAll('_', ' ')}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Badge tone={TONE[e.status]}>{e.status.replaceAll('_', ' ')}</Badge>
                  )}
                </Td>
                <Td>
                  {e.nextMaintenanceDue ? (
                    <Badge tone={e.maintenanceDue ? 'danger' : 'neutral'}>
                      {formatDate(e.nextMaintenanceDue)}
                    </Badge>
                  ) : (
                    '—'
                  )}
                </Td>
                <Td>
                  {(can('maintenance:log') || can('equipment:manage')) && (
                    <Button size="sm" variant="ghost" onClick={() => setLogFor(e)}>
                      Maintenance
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {logFor && <MaintenanceDialog item={logFor} onClose={() => setLogFor(null)} />}
    </div>
  );
}

function MaintenanceDialog({ item, onClose }: { item: Item; onClose(): void }) {
  const { can } = useAuth();
  const logs = useApi<{
    logs: {
      id: string;
      kind: string;
      performedOn: string;
      notes: string;
      outcome: string;
      loggedBy: string;
    }[];
  }>(`/api/equipment/${item.id}/maintenance`);
  const [f, setF] = useState({
    kind: 'preventive',
    performedOn: hospitalToday(),
    notes: '',
    outcome: 'in_service',
  });
  const save = useAction('POST', `/api/equipment/${item.id}/maintenance`, {
    invalidate: ['/api/equipment'],
    onSuccess: () => setF({ ...f, notes: '' }),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Maintenance — ${item.name}`}
      className="max-w-2xl"
    >
      <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
        {logs.data?.logs.length === 0 && <li className="text-slate-500">No maintenance logged.</li>}
        {logs.data?.logs.map((l) => (
          <li key={l.id}>
            {formatDate(l.performedOn)} · {l.kind} · {l.outcome.replaceAll('_', ' ')} · {l.loggedBy}
            <span className="block text-xs text-slate-500">{l.notes}</span>
          </li>
        ))}
      </ul>
      {can('maintenance:log') && item.status !== 'retired' && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.run(f);
          }}
        >
          <div className="grid grid-cols-3 gap-2">
            <Select
              aria-label="Kind"
              value={f.kind}
              onChange={(e) => setF({ ...f, kind: e.target.value })}
            >
              {MAINTENANCE_KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </Select>
            <Input
              aria-label="Date"
              type="date"
              value={f.performedOn}
              onChange={(e) => setF({ ...f, performedOn: e.target.value })}
            />
            <Select
              aria-label="Outcome"
              value={f.outcome}
              onChange={(e) => setF({ ...f, outcome: e.target.value })}
            >
              <option value="in_service">Back in service</option>
              <option value="under_maintenance">Still under maintenance</option>
              <option value="out_of_service">Out of service</option>
            </Select>
          </div>
          <Textarea
            aria-label="Notes"
            value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
            placeholder="What was done"
          />
          {save.error && <Alert tone="error">{save.error}</Alert>}
          <Button type="submit" disabled={!f.notes.trim() || save.pending}>
            Log maintenance
          </Button>
        </form>
      )}
    </Dialog>
  );
}
