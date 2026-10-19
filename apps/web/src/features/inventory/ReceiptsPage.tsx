import type { Location, StockItemView, Supplier } from '@hospitalos/shared';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { EmptyState } from '../../components/ui/empty-state';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { MoneyInput } from '../../components/ui/money-input';
import { PageHeader } from '../../components/ui/page-header';
import { Select } from '../../components/ui/select';
import { Spinner } from '../../components/ui/spinner';
import { Table, Td, Th } from '../../components/ui/table';
import { formatDateTime, formatRupees } from '../../lib/format';
import { useAction, useApi } from '../../lib/use-api';
import { useAuth } from '../auth/auth-context';

interface Receipt {
  id: string;
  grnNo: string;
  receivedAt: string;
  supplierInvoiceRef: string | null;
  supplier: { name: string };
  location: { name: string };
  receivedBy: string;
  lines: number;
  valuePaise: number;
}

interface Line {
  stockItemId: string;
  batchNo: string;
  expiryDate: string;
  qty: string;
  unitCostPaise: number | null;
  salePricePaise: number | null;
}
const blank = (): Line => ({
  stockItemId: '',
  batchNo: '',
  expiryDate: '',
  qty: '',
  unitCostPaise: null,
  salePricePaise: null,
});

/** Supplier deliveries into the general store. */
export function ReceiptsPage() {
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const list = useApi<{ receipts: Receipt[] }>('/api/goods-receipts');
  return (
    <div className="space-y-4">
      <PageHeader
        title="Goods receipts"
        description="Supplier deliveries are received into a store, then transferred to the pharmacy."
        actions={
          can('goods_receipt:create') &&
          !creating && <Button onClick={() => setCreating(true)}>Receive goods</Button>
        }
      />
      {notice && <Alert tone="success">{notice}</Alert>}
      {creating && (
        <NewReceipt
          onClose={() => setCreating(false)}
          onDone={(no) => {
            setCreating(false);
            setNotice(`${no} recorded. Stock and movements are updated.`);
          }}
        />
      )}
      {list.isPending && <Spinner />}
      {list.isError && <Alert tone="error">{list.error.message}</Alert>}
      {list.data && list.data.receipts.length === 0 && <EmptyState title="No receipts yet" />}
      {list.data && list.data.receipts.length > 0 && (
        <Table aria-label="Goods receipts">
          <thead>
            <tr>
              <Th>GRN</Th>
              <Th>Received</Th>
              <Th>Supplier</Th>
              <Th>Into</Th>
              <Th>Lines</Th>
              <Th>Value</Th>
            </tr>
          </thead>
          <tbody>
            {list.data.receipts.map((r) => (
              <tr key={r.id}>
                <Td className="font-mono">{r.grnNo}</Td>
                <Td className="text-xs">
                  {formatDateTime(r.receivedAt)}
                  <span className="block text-slate-500">{r.receivedBy}</span>
                </Td>
                <Td>
                  {r.supplier.name}
                  {r.supplierInvoiceRef && (
                    <span className="block text-xs text-slate-500">
                      Invoice {r.supplierInvoiceRef}
                    </span>
                  )}
                </Td>
                <Td>{r.location.name}</Td>
                <Td>{r.lines}</Td>
                <Td className="tabular-nums">{formatRupees(r.valuePaise)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function NewReceipt({ onClose, onDone }: { onClose(): void; onDone(grnNo: string): void }) {
  const suppliers = useApi<{ suppliers: Supplier[] }>('/api/suppliers');
  const locations = useApi<{ locations: Location[] }>('/api/locations');
  const items = useApi<{ items: StockItemView[] }>('/api/stock?q=');
  const stores = locations.data?.locations.filter((l) => l.kind === 'store') ?? [];
  const [supplierId, setSupplierId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [ref, setRef] = useState('');
  const [lines, setLines] = useState<Line[]>([blank()]);
  const save = useAction<object, { receipt: { grnNo: string } }>('POST', '/api/goods-receipts', {
    invalidate: ['/api/goods-receipts', '/api/stock'],
    onSuccess: (res) => onDone(res.receipt.grnNo),
  });
  const set = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const loc = locationId || stores[0]?.id || '';
  const ready =
    supplierId &&
    loc &&
    lines.every(
      (l) =>
        l.stockItemId &&
        l.batchNo.trim() &&
        Number(l.qty) > 0 &&
        l.unitCostPaise !== null &&
        l.salePricePaise !== null,
    );
  return (
    <Card className="space-y-4">
      <h2 className="font-semibold">Receive goods</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField id="grn-sup" label="Supplier" required>
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Choose…</option>
            {suppliers.data?.suppliers
              .filter((s) => s.active)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </Select>
        </FormField>
        <FormField id="grn-loc" label="Into store" required>
          <Select value={loc} onChange={(e) => setLocationId(e.target.value)}>
            {stores.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="grn-ref" label="Supplier invoice no.">
          <Input value={ref} onChange={(e) => setRef(e.target.value)} />
        </FormField>
      </div>
      {lines.map((l, i) => {
        const item = items.data?.items.find((x) => x.id === l.stockItemId);
        return (
          <fieldset
            key={i}
            className="grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-6 dark:border-slate-700"
          >
            <legend className="px-1 text-xs text-slate-500">Line {i + 1}</legend>
            <div className="sm:col-span-2">
              <FormField id={`grn-${i}-item`} label="Item" required>
                <Select
                  value={l.stockItemId}
                  onChange={(e) => set(i, { stockItemId: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {items.data?.items.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} ({x.sku})
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
            <FormField id={`grn-${i}-batch`} label="Batch no." required>
              <Input value={l.batchNo} onChange={(e) => set(i, { batchNo: e.target.value })} />
            </FormField>
            <FormField
              id={`grn-${i}-exp`}
              label="Expiry (last valid day)"
              required={item?.tracksExpiry ?? true}
              hint={'"03/2027" means 2027-03-31'}
            >
              <Input
                type="date"
                value={l.expiryDate}
                onChange={(e) => set(i, { expiryDate: e.target.value })}
              />
            </FormField>
            <FormField
              id={`grn-${i}-qty`}
              label={`Quantity${item ? ` (${item.baseUnit})` : ''}`}
              required
            >
              <Input
                inputMode="numeric"
                value={l.qty}
                onChange={(e) => set(i, { qty: e.target.value })}
              />
            </FormField>
            <div className="flex items-end">
              {lines.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              )}
            </div>
            <FormField id={`grn-${i}-cost`} label="Unit cost" required>
              <MoneyInput
                valuePaise={l.unitCostPaise}
                onChange={(v) => set(i, { unitCostPaise: v })}
              />
            </FormField>
            <FormField id={`grn-${i}-price`} label="Sale price" required>
              <MoneyInput
                valuePaise={l.salePricePaise}
                onChange={(v) => set(i, { salePricePaise: v })}
              />
            </FormField>
          </fieldset>
        );
      })}
      <Button variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, blank()])}>
        Add line
      </Button>
      {save.error && <Alert tone="error">{save.error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!ready || save.pending}
          onClick={() =>
            save.run({
              supplierId,
              locationId: loc,
              supplierInvoiceRef: ref,
              lines: lines.map((l) => ({
                stockItemId: l.stockItemId,
                batchNo: l.batchNo.trim(),
                expiryDate: l.expiryDate || null,
                qty: Number(l.qty),
                unitCostPaise: l.unitCostPaise,
                salePricePaise: l.salePricePaise,
              })),
            })
          }
        >
          {save.pending ? 'Saving…' : 'Record receipt'}
        </Button>
      </div>
    </Card>
  );
}
