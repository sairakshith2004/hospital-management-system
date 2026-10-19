import { SERVICE_KINDS, type ServiceItem } from '@hospitalos/shared';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Dialog } from '../../components/ui/dialog';
import { EmptyState } from '../../components/ui/empty-state';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { MoneyInput } from '../../components/ui/money-input';
import { PageHeader } from '../../components/ui/page-header';
import { Select } from '../../components/ui/select';
import { Spinner } from '../../components/ui/spinner';
import { Table, Td, Th } from '../../components/ui/table';
import { formatRupees } from '../../lib/format';
import { useAction, useApi } from '../../lib/use-api';
import { useAuth } from '../auth/auth-context';

/** The price list. A new price applies to new charges only; issued invoices keep theirs. */
export function ServicesPage() {
  const { can } = useAuth();
  const q = useApi<{ services: ServiceItem[] }>('/api/services');
  const [f, setF] = useState({ code: '', name: '', kind: 'procedure' });
  const [price, setPrice] = useState<number | null>(null);
  const [editing, setEditing] = useState<ServiceItem | null>(null);
  const [newPrice, setNewPrice] = useState<number | null>(null);
  const save = useAction('POST', '/api/services', {
    invalidate: ['/api/services'],
    onSuccess: () => {
      setF({ code: '', name: '', kind: 'procedure' });
      setPrice(null);
    },
  });
  const update = useAction<{ pricePaise: number | null }>(
    'PATCH',
    () => `/api/services/${editing?.id}`,
    {
      invalidate: ['/api/services', '/api/lab/tests'],
      onSuccess: () => setEditing(null),
    },
  );
  return (
    <div className="space-y-4">
      <PageHeader
        title="Price list"
        description="Doctor consultation fees are set on each doctor's profile; lab prices with each test."
      />
      {can('price:manage') && (
        <Card>
          <form
            className="grid gap-3 sm:grid-cols-5 sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              save.run({ ...f, pricePaise: price });
            }}
          >
            <FormField id="svc-code" label="Code" required>
              <Input
                value={f.code}
                onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
              />
            </FormField>
            <FormField id="svc-name" label="Name" required>
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </FormField>
            <FormField id="svc-kind" label="Kind">
              <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                {SERVICE_KINDS.filter((k) => k !== 'lab' && k !== 'consultation').map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </Select>
            </FormField>
            <FormField id="svc-price" label="Price" required>
              <MoneyInput valuePaise={price} onChange={setPrice} />
            </FormField>
            <Button type="submit" disabled={!f.code || !f.name || price === null || save.pending}>
              Add service
            </Button>
            {save.error && (
              <Alert tone="error" className="sm:col-span-5">
                {save.error}
              </Alert>
            )}
          </form>
        </Card>
      )}
      {q.isPending && <Spinner />}
      {q.data && q.data.services.length === 0 && <EmptyState title="No services priced yet" />}
      {q.data && q.data.services.length > 0 && (
        <Table aria-label="Services">
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Service</Th>
              <Th>Kind</Th>
              <Th>Price</Th>
              {can('price:manage') && <Th>Change</Th>}
            </tr>
          </thead>
          <tbody>
            {q.data.services.map((s) => (
              <tr key={s.id}>
                <Td className="font-mono">{s.code}</Td>
                <Td>
                  {s.name} {!s.active && <Badge>inactive</Badge>}
                </Td>
                <Td>{s.kind}</Td>
                <Td className="tabular-nums">{formatRupees(s.pricePaise)}</Td>
                {can('price:manage') && (
                  <Td>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(s);
                        setNewPrice(s.pricePaise);
                      }}
                    >
                      Edit price
                    </Button>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && (
        <Dialog
          open
          onOpenChange={(o) => !o && setEditing(null)}
          title={`Price for ${editing.name}`}
          description="New charges use the new price. Existing invoices keep the price they were charged."
        >
          <MoneyInput valuePaise={newPrice} onChange={setNewPrice} />
          {update.error && <Alert tone="error">{update.error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              disabled={newPrice === null || update.pending}
              onClick={() => update.run({ pricePaise: newPrice })}
            >
              Save price
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
