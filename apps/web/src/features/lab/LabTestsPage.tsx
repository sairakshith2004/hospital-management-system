import type { LabTestView } from '@hospitalos/shared';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { EmptyState } from '../../components/ui/empty-state';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { MoneyInput } from '../../components/ui/money-input';
import { PageHeader } from '../../components/ui/page-header';
import { Spinner } from '../../components/ui/spinner';
import { Table, Td, Th } from '../../components/ui/table';
import { formatRupees } from '../../lib/format';
import { useAction, useApi } from '../../lib/use-api';
import { useAuth } from '../auth/auth-context';

export function LabTestsPage() {
  const { can } = useAuth();
  const q = useApi<{ tests: LabTestView[] }>('/api/lab/tests');
  const [f, setF] = useState({ code: '', name: '', sampleType: 'Blood', turnaroundHours: '24' });
  const [price, setPrice] = useState<number | null>(null);
  const [params, setParams] = useState([{ name: '', unit: '', refLow: '', refHigh: '' }]);
  const save = useAction('POST', '/api/lab/tests', {
    invalidate: ['/api/lab/tests', '/api/services'],
    onSuccess: () => {
      setF({ code: '', name: '', sampleType: 'Blood', turnaroundHours: '24' });
      setParams([{ name: '', unit: '', refLow: '', refHigh: '' }]);
    },
  });
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  return (
    <div className="space-y-4">
      <PageHeader
        title="Lab tests"
        description="The test catalogue, reference ranges and prices."
      />
      {can('price:manage') && (
        <Card className="space-y-3">
          <h2 className="font-semibold">Add a test</h2>
          <div className="grid gap-3 sm:grid-cols-5">
            <FormField id="lt-code" label="Code" required>
              <Input
                value={f.code}
                onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
              />
            </FormField>
            <FormField id="lt-name" label="Name" required>
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </FormField>
            <FormField id="lt-sample" label="Sample" required>
              <Input
                value={f.sampleType}
                onChange={(e) => setF({ ...f, sampleType: e.target.value })}
              />
            </FormField>
            <FormField id="lt-tat" label="Turnaround (h)" required>
              <Input
                inputMode="numeric"
                value={f.turnaroundHours}
                onChange={(e) => setF({ ...f, turnaroundHours: e.target.value })}
              />
            </FormField>
            <FormField id="lt-price" label="Price" required>
              <MoneyInput valuePaise={price} onChange={setPrice} />
            </FormField>
          </div>
          {params.map((p, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-5">
              {(['name', 'unit', 'refLow', 'refHigh'] as const).map((k) => (
                <Input
                  key={k}
                  aria-label={`Parameter ${i + 1} ${k}`}
                  placeholder={
                    { name: 'Parameter', unit: 'Unit', refLow: 'Ref low', refHigh: 'Ref high' }[k]
                  }
                  value={p[k]}
                  onChange={(e) =>
                    setParams(params.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))
                  }
                />
              ))}
              <Button
                variant="ghost"
                size="sm"
                disabled={params.length === 1}
                onClick={() => setParams(params.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setParams([...params, { name: '', unit: '', refLow: '', refHigh: '' }])}
          >
            Add parameter
          </Button>
          {save.error && <Alert tone="error">{save.error}</Alert>}
          <div className="flex justify-end">
            <Button
              disabled={
                !f.code ||
                !f.name ||
                price === null ||
                params.some((p) => !p.name.trim()) ||
                save.pending
              }
              onClick={() =>
                save.run({
                  ...f,
                  turnaroundHours: Number(f.turnaroundHours),
                  pricePaise: price,
                  parameters: params.map((p) => ({
                    name: p.name,
                    unit: p.unit,
                    refLow: num(p.refLow),
                    refHigh: num(p.refHigh),
                  })),
                })
              }
            >
              Add test
            </Button>
          </div>
        </Card>
      )}
      {q.isPending && <Spinner />}
      {q.data && q.data.tests.length === 0 && <EmptyState title="No tests set up yet" />}
      {q.data && q.data.tests.length > 0 && (
        <Table aria-label="Lab tests">
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Test</Th>
              <Th>Sample</Th>
              <Th>Parameters</Th>
              <Th>Price</Th>
            </tr>
          </thead>
          <tbody>
            {q.data.tests.map((t) => (
              <tr key={t.id}>
                <Td className="font-mono">{t.code}</Td>
                <Td>
                  {t.name}
                  <span className="block text-xs text-slate-500">{t.turnaroundHours} h</span>
                </Td>
                <Td>{t.sampleType}</Td>
                <Td className="text-xs">
                  {t.parameters.map((p) => (
                    <span key={p.id} className="block">
                      {p.name} {p.unit ? `(${p.unit})` : ''}{' '}
                      {p.refLow !== null || p.refHigh !== null
                        ? `${p.refLow !== null ? Number(p.refLow) : ''}–${p.refHigh !== null ? Number(p.refHigh) : ''}`
                        : ''}
                    </span>
                  ))}
                </Td>
                <Td className="tabular-nums">{formatRupees(t.pricePaise)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
