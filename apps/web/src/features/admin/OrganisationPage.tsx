import { LOCATION_KINDS, type Department, type Location } from '@hospitalos/shared';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Select } from '../../components/ui/select';
import { Table, Td, Th } from '../../components/ui/table';
import { useAction, useApi } from '../../lib/use-api';

export function OrganisationPage() {
  const depts = useApi<{ departments: Department[] }>('/api/departments');
  const locs = useApi<{ locations: Location[] }>('/api/locations');
  const [d, setD] = useState({ code: '', name: '', isClinical: true });
  const [l, setL] = useState({ code: '', name: '', kind: 'pharmacy' });
  const addDept = useAction('POST', '/api/admin/departments', {
    invalidate: ['/api/departments'],
    onSuccess: () => setD({ code: '', name: '', isClinical: true }),
  });
  const addLoc = useAction('POST', '/api/locations', {
    invalidate: ['/api/locations'],
    onSuccess: () => setL({ code: '', name: '', kind: 'pharmacy' }),
  });
  return (
    <div className="space-y-6">
      <PageHeader title="Departments and locations" />
      <section className="space-y-3">
        <h2 className="font-semibold">Departments</h2>
        <Card>
          <form
            className="grid gap-3 sm:grid-cols-4 sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              addDept.run(d);
            }}
          >
            <FormField id="d-code" label="Code" required>
              <Input
                value={d.code}
                onChange={(e) => setD({ ...d, code: e.target.value.toUpperCase() })}
              />
            </FormField>
            <FormField id="d-name" label="Name" required>
              <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
            </FormField>
            <label className="flex h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={d.isClinical}
                onChange={(e) => setD({ ...d, isClinical: e.target.checked })}
              />{' '}
              Clinical (has doctors)
            </label>
            <Button type="submit" disabled={!d.code || !d.name || addDept.pending}>
              Add department
            </Button>
            {addDept.error && (
              <Alert tone="error" className="sm:col-span-4">
                {addDept.error}
              </Alert>
            )}
          </form>
        </Card>
        <Table aria-label="Departments">
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Type</Th>
            </tr>
          </thead>
          <tbody>
            {depts.data?.departments.map((x) => (
              <tr key={x.id}>
                <Td className="font-mono">{x.code}</Td>
                <Td>{x.name}</Td>
                <Td>
                  {x.isClinical ? <Badge tone="accent">Clinical</Badge> : <Badge>Support</Badge>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">Stock locations</h2>
        <Card>
          <form
            className="grid gap-3 sm:grid-cols-4 sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              addLoc.run(l);
            }}
          >
            <FormField id="l-code" label="Code" required>
              <Input
                value={l.code}
                onChange={(e) => setL({ ...l, code: e.target.value.toUpperCase() })}
              />
            </FormField>
            <FormField id="l-name" label="Name" required>
              <Input value={l.name} onChange={(e) => setL({ ...l, name: e.target.value })} />
            </FormField>
            <FormField id="l-kind" label="Kind">
              <Select value={l.kind} onChange={(e) => setL({ ...l, kind: e.target.value })}>
                {LOCATION_KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </Select>
            </FormField>
            <Button type="submit" disabled={!l.code || !l.name || addLoc.pending}>
              Add location
            </Button>
            {addLoc.error && (
              <Alert tone="error" className="sm:col-span-4">
                {addLoc.error}
              </Alert>
            )}
          </form>
        </Card>
        <Table aria-label="Locations">
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Kind</Th>
            </tr>
          </thead>
          <tbody>
            {locs.data?.locations.map((x) => (
              <tr key={x.id}>
                <Td className="font-mono">{x.code}</Td>
                <Td>{x.name}</Td>
                <Td>{x.kind}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
    </div>
  );
}
