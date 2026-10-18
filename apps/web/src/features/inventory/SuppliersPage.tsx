import type { Supplier } from '@hospitalos/shared';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { EmptyState } from '../../components/ui/empty-state';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Spinner } from '../../components/ui/spinner';
import { Table, Td, Th } from '../../components/ui/table';
import { useAction, useApi } from '../../lib/use-api';
import { useAuth } from '../auth/auth-context';

export function SuppliersPage() {
  const { can } = useAuth();
  const list = useApi<{ suppliers: Supplier[] }>('/api/suppliers');
  const [form, setForm] = useState({ code: '', name: '', gstin: '', phone: '', email: '' });
  const save = useAction('POST', '/api/suppliers', {
    invalidate: ['/api/suppliers'],
    onSuccess: () => setForm({ code: '', name: '', gstin: '', phone: '', email: '' }),
  });
  return (
    <div className="space-y-4">
      <PageHeader title="Suppliers" />
      {can('supplier:manage') && (
        <Card>
          <form
            className="grid gap-3 sm:grid-cols-6 sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              save.run(form);
            }}
          >
            {(
              [
                ['code', 'Code'],
                ['name', 'Name'],
                ['gstin', 'GSTIN'],
                ['phone', 'Phone'],
                ['email', 'Email'],
              ] as const
            ).map(([k, label]) => (
              <FormField
                key={k}
                id={`sup-${k}`}
                label={label}
                required={k === 'code' || k === 'name'}
              >
                <Input
                  value={form[k]}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      [k]: k === 'code' ? e.target.value.toUpperCase() : e.target.value,
                    })
                  }
                />
              </FormField>
            ))}
            <Button type="submit" disabled={!form.code || !form.name || save.pending}>
              Add supplier
            </Button>
            {save.error && (
              <Alert tone="error" className="sm:col-span-6">
                {save.error}
              </Alert>
            )}
          </form>
        </Card>
      )}
      {list.isPending && <Spinner />}
      {list.data && list.data.suppliers.length === 0 && <EmptyState title="No suppliers yet" />}
      {list.data && list.data.suppliers.length > 0 && (
        <Table aria-label="Suppliers">
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>GSTIN</Th>
              <Th>Contact</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {list.data.suppliers.map((s) => (
              <tr key={s.id}>
                <Td className="font-mono">{s.code}</Td>
                <Td>{s.name}</Td>
                <Td>{s.gstin ?? '—'}</Td>
                <Td className="text-xs">
                  {s.phone ?? ''} {s.email ?? ''}
                </Td>
                <Td>
                  <Badge tone={s.active ? 'success' : 'neutral'}>
                    {s.active ? 'Active' : 'Inactive'}
                  </Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
