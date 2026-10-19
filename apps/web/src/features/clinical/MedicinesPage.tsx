import type { StockItemView } from '@hospitalos/shared';
import { useEffect, useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { EmptyState } from '../../components/ui/empty-state';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { PageHeader } from '../../components/ui/page-header';
import { Spinner } from '../../components/ui/spinner';
import { Table, Td, Th } from '../../components/ui/table';
import { formatDate } from '../../lib/format';
import { useApi } from '../../lib/use-api';
import { ingredientsLabel } from './PrescriptionBuilder';

/** Read-only medicine lookup: every brand, strength and form of an ingredient, and where it is. */
export function MedicinesPage() {
  const [q, setQ] = useState('');
  const [d, setD] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setD(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const res = useApi<{ items: StockItemView[] }>(
    d.length >= 2 ? `/api/stock?kind=medicine&q=${encodeURIComponent(d)}` : null,
  );
  return (
    <div className="space-y-4">
      <PageHeader
        title="Medicines"
        description="Search by ingredient, brand or code. Stock shown is usable stock (active, unexpired)."
      />
      <div className="max-w-xl space-y-1.5">
        <Label htmlFor="med-q">Ingredient, brand or code</Label>
        <Input
          id="med-q"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. amoxicillin"
        />
      </div>
      {d.length < 2 && (
        <p className="text-sm text-slate-600 dark:text-slate-400">Type at least 2 characters.</p>
      )}
      {res.isFetching && <Spinner />}
      {res.isError && <Alert tone="error">{res.error.message}</Alert>}
      {res.data && res.data.items.length === 0 && <EmptyState title="No medicines match" />}
      {res.data && res.data.items.length > 0 && (
        <Table aria-label="Medicines">
          <thead>
            <tr>
              <Th>Product</Th>
              <Th>Ingredients</Th>
              <Th>Form / route</Th>
              <Th>Available</Th>
              <Th>Batches (location · expiry · qty)</Th>
            </tr>
          </thead>
          <tbody>
            {res.data.items.map((i) => (
              <tr key={i.id}>
                <Td>
                  <span className="font-medium">{i.medicine?.brandName ?? i.name}</span>
                  <span className="block font-mono text-xs text-slate-500">{i.sku}</span>
                  {i.medicine?.rxOnly && <Badge tone="info">Rx</Badge>}
                </Td>
                <Td>{ingredientsLabel(i)}</Td>
                <Td>
                  {i.medicine?.dosageForm} · {i.medicine?.route}
                  {i.medicine?.packSize && (
                    <span className="block text-xs text-slate-500">{i.medicine.packSize}</span>
                  )}
                </Td>
                <Td className="tabular-nums">
                  <Badge
                    tone={
                      i.totalAvailable === 0
                        ? 'danger'
                        : i.totalAvailable <= i.reorderLevel
                          ? 'warning'
                          : 'success'
                    }
                  >
                    {i.totalAvailable} {i.baseUnit}
                  </Badge>
                </Td>
                <Td className="text-xs">
                  {i.batches.length === 0
                    ? '—'
                    : i.batches.map((b) => (
                        <span key={b.id} className="block">
                          {b.location.name} ·{' '}
                          {b.expiryDate ? formatDate(b.expiryDate) : 'no expiry'} · {b.qtyOnHand}
                          {b.status !== 'active' && <Badge tone="danger">{b.status}</Badge>}
                        </span>
                      ))}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
