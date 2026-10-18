import {
  ADJUSTMENT_KINDS,
  BATCH_STATUSES,
  type BatchStock,
  type Location,
  type StockItemView,
} from '@hospitalos/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { EmptyState } from '../../components/ui/empty-state';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Select } from '../../components/ui/select';
import { Spinner } from '../../components/ui/spinner';
import { Table, Td, Th } from '../../components/ui/table';
import { Textarea } from '../../components/ui/textarea';
import { formatDate, formatRupees } from '../../lib/format';
import { useAction, useApi } from '../../lib/use-api';
import { useAuth } from '../auth/auth-context';
import { ingredientsLabel } from '../clinical/PrescriptionBuilder';

const KIND_LABEL: Record<string, string> = {
  adjustment_in: 'Count correction (+)',
  adjustment_out: 'Count correction (−)',
  damage: 'Damaged',
  expiry_writeoff: 'Expired write-off',
};

/** Stock by item and batch; adjust or quarantine batches at locations you manage. */
export function StockPage() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [d, setD] = useState('');
  const [locationId, setLocationId] = useState('');
  const [low, setLow] = useState(false);
  const [acting, setActing] = useState<{
    item: StockItemView;
    batch: BatchStock;
    mode: 'adjust' | 'status';
  } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setD(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const locations = useApi<{ locations: Location[] }>('/api/locations');
  const params = new URLSearchParams({
    q: d,
    ...(locationId ? { locationId } : {}),
    ...(low ? { low: 'true' } : {}),
  });
  const stock = useApi<{ items: StockItemView[] }>(`/api/stock?${params.toString()}`);
  const canAdjust = (kind: string) =>
    (kind === 'pharmacy' && can('stock:adjust_pharmacy')) ||
    (kind === 'store' && can('stock:adjust_store'));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock"
        description="Usable quantity counts active, unexpired batches only."
        actions={
          <>
            {can('medicine:catalog_manage') && (
              <Button asChild variant="secondary">
                <Link to="/inventory/catalogue">Catalogue</Link>
              </Button>
            )}
            <Button asChild variant="secondary">
              <Link to="/inventory/movements">Movement history</Link>
            </Button>
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
        <FormField id="stock-q" label="Search item, brand, ingredient or SKU">
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} />
        </FormField>
        <FormField id="stock-loc" label="Location">
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">All locations</option>
            {locations.data?.locations
              .filter((l) => l.kind === 'pharmacy' || l.kind === 'store')
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </Select>
        </FormField>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Low
          stock only
        </label>
      </div>
      {stock.isPending && <Spinner />}
      {stock.isError && <Alert tone="error">{stock.error.message}</Alert>}
      {stock.data && stock.data.items.length === 0 && <EmptyState title="No items match" />}
      {stock.data && stock.data.items.length > 0 && (
        <Table aria-label="Stock">
          <thead>
            <tr>
              <Th>Item</Th>
              <Th>Usable</Th>
              <Th>Batches</Th>
            </tr>
          </thead>
          <tbody>
            {stock.data.items.map((item) => (
              <tr key={item.id} className="align-top">
                <Td>
                  <span className="font-medium">{item.name}</span>
                  <span className="block font-mono text-xs text-slate-500">{item.sku}</span>
                  {item.medicine && (
                    <span className="block text-xs text-slate-500">{ingredientsLabel(item)}</span>
                  )}
                </Td>
                <Td className="tabular-nums">
                  <Badge tone={item.totalAvailable <= item.reorderLevel ? 'warning' : 'success'}>
                    {item.totalAvailable} {item.baseUnit}
                  </Badge>
                  <span className="block text-xs text-slate-500">
                    reorder at {item.reorderLevel}
                  </span>
                </Td>
                <Td>
                  {item.batches.length === 0 ? (
                    <span className="text-sm text-slate-500">No stock</span>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {item.batches.map((b) => (
                        <li key={b.id} className="flex flex-wrap items-center gap-2">
                          <span className="tabular-nums">
                            {b.location.name} · <span className="font-mono">{b.batchNo}</span> ·{' '}
                            {b.expiryDate ? `exp ${formatDate(b.expiryDate)}` : 'no expiry'} ·{' '}
                            <strong>{b.qtyOnHand}</strong> · {formatRupees(b.salePricePaise)}
                          </span>
                          {b.status !== 'active' && <Badge tone="danger">{b.status}</Badge>}
                          {canAdjust(b.location.kind) && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setActing({ item, batch: b, mode: 'adjust' })}
                              >
                                Adjust
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setActing({ item, batch: b, mode: 'status' })}
                              >
                                Status
                              </Button>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {acting && <BatchDialog {...acting} onClose={() => setActing(null)} />}
    </div>
  );
}

function BatchDialog({
  item,
  batch,
  mode,
  onClose,
}: {
  item: StockItemView;
  batch: BatchStock;
  mode: 'adjust' | 'status';
  onClose(): void;
}) {
  const [kind, setKind] = useState<string>('adjustment_out');
  const [status, setStatus] = useState<string>(
    batch.status === 'active' ? 'quarantined' : 'active',
  );
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const invalidate = ['/api/stock'];
  const adjust = useAction('POST', '/api/stock/adjustments', { invalidate, onSuccess: onClose });
  const setStat = useAction('POST', `/api/stock/batches/${batch.id}/status`, {
    invalidate,
    onSuccess: onClose,
  });
  const action = mode === 'adjust' ? adjust : setStat;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={mode === 'adjust' ? 'Adjust stock' : 'Batch status'}
      description={`${item.name} · batch ${batch.batchNo} at ${batch.location.name} (${batch.qtyOnHand} on hand)`}
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === 'adjust') adjust.run({ batchId: batch.id, kind, qty: Number(qty), reason });
          else setStat.run({ status, reason });
        }}
      >
        {mode === 'adjust' ? (
          <div className="grid grid-cols-2 gap-3">
            <FormField id="adj-kind" label="Type">
              <Select value={kind} onChange={(e) => setKind(e.target.value)}>
                {ADJUSTMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="adj-qty" label="Quantity" required>
              <Input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
            </FormField>
          </div>
        ) : (
          <FormField id="batch-status" label="New status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {BATCH_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        <FormField id="adj-reason" label="Reason" required>
          <Textarea maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        {action.error && <Alert tone="error">{action.error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={action.pending || !reason.trim() || (mode === 'adjust' && !(Number(qty) > 0))}
          >
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
