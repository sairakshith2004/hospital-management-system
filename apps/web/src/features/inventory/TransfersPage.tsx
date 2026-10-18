import type { Location, StockItemView } from '@hospitalos/shared';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { EmptyState } from '../../components/ui/empty-state';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Select } from '../../components/ui/select';
import { Spinner } from '../../components/ui/spinner';
import { Table, Td, Th } from '../../components/ui/table';
import { formatDate, formatDateTime } from '../../lib/format';
import { useAction, useApi } from '../../lib/use-api';
import { useAuth } from '../auth/auth-context';

interface Transfer {
  id: string;
  transferNo: string;
  status: 'dispatched' | 'received' | 'rejected';
  reason: string;
  dispatchedAt: string;
  dispatchedById: string;
  rejectionReason: string | null;
  from: { id: string; name: string; kind: string };
  to: { id: string; name: string; kind: string };
  lines: { item: string; batchNo: string; qty: number }[] | null;
}

/** Stock moving between store and pharmacy: sent by one person, received by another. */
export function TransfersPage() {
  const { user, can } = useAuth();
  const list = useApi<{ transfers: Transfer[] }>('/api/transfers');
  const [creating, setCreating] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reload = ['/api/transfers', '/api/stock'];
  const receive = useAction<{ id: string }>('POST', (b) => `/api/transfers/${b.id}/receive`, {
    invalidate: reload,
    onSuccess: () => setNotice('Transfer received; stock is at the destination.'),
  });
  const reject = useAction<{ reason: string }>('POST', () => `/api/transfers/${rejecting}/reject`, {
    invalidate: reload,
    onSuccess: () => {
      setRejecting(null);
      setNotice('Transfer rejected; stock went back to its source batches.');
    },
  });
  const canReceive = (kind: string) =>
    (kind === 'pharmacy' && can('stock_transfer:receive_pharmacy')) ||
    (kind === 'store' && can('stock_transfer:receive_store'));
  const canDispatch =
    can('stock_transfer:dispatch_pharmacy') || can('stock_transfer:dispatch_store');
  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock transfers"
        actions={
          canDispatch &&
          !creating && <Button onClick={() => setCreating(true)}>New transfer</Button>
        }
      />
      {notice && <Alert tone="success">{notice}</Alert>}
      {receive.error && <Alert tone="error">{receive.error}</Alert>}
      {creating && (
        <NewTransfer
          onClose={() => setCreating(false)}
          onDone={(no) => {
            setCreating(false);
            setNotice(`${no} sent. Someone at the destination must receive it.`);
          }}
        />
      )}
      {list.isPending && <Spinner />}
      {list.data && list.data.transfers.length === 0 && <EmptyState title="No transfers yet" />}
      {list.data && list.data.transfers.length > 0 && (
        <Table aria-label="Transfers">
          <thead>
            <tr>
              <Th>Transfer</Th>
              <Th>From → to</Th>
              <Th>Items</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {list.data.transfers.map((t) => (
              <tr key={t.id}>
                <Td>
                  <span className="font-mono">{t.transferNo}</span>
                  <span className="block text-xs text-slate-500">
                    {formatDateTime(t.dispatchedAt)}
                  </span>
                  <span className="block text-xs text-slate-500">{t.reason}</span>
                </Td>
                <Td>
                  {t.from.name} → {t.to.name}
                </Td>
                <Td className="text-xs">
                  {t.lines?.map((l, i) => (
                    <span key={i} className="block">
                      {l.item} · {l.batchNo} · {l.qty}
                    </span>
                  ))}
                </Td>
                <Td>
                  <Badge
                    tone={
                      t.status === 'received'
                        ? 'success'
                        : t.status === 'rejected'
                          ? 'danger'
                          : 'info'
                    }
                  >
                    {t.status}
                  </Badge>
                  {t.rejectionReason && <span className="block text-xs">{t.rejectionReason}</span>}
                </Td>
                <Td>
                  {t.status === 'dispatched' &&
                    canReceive(t.to.kind) &&
                    t.dispatchedById !== user?.id && (
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          disabled={receive.pending}
                          onClick={() => receive.run({ id: t.id })}
                        >
                          Receive
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setRejecting(t.id)}>
                          Reject
                        </Button>
                      </div>
                    )}
                  {t.status === 'dispatched' && t.dispatchedById === user?.id && (
                    <span className="text-xs text-slate-500">Awaiting the destination</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <ConfirmDialog
        open={rejecting !== null}
        onOpenChange={(o) => !o && setRejecting(null)}
        title="Reject transfer"
        description="The stock goes back into its source batches."
        confirmLabel="Reject"
        reasonLabel="Reason"
        pending={reject.pending}
        error={reject.error}
        onConfirm={(reason) => reject.run({ reason })}
      />
    </div>
  );
}

function NewTransfer({ onClose, onDone }: { onClose(): void; onDone(no: string): void }) {
  const { can } = useAuth();
  const locations = useApi<{ locations: Location[] }>('/api/locations');
  const usable =
    locations.data?.locations.filter((l) => l.kind === 'pharmacy' || l.kind === 'store') ?? [];
  const sources = usable.filter(
    (l) =>
      (l.kind === 'pharmacy' && can('stock_transfer:dispatch_pharmacy')) ||
      (l.kind === 'store' && can('stock_transfer:dispatch_store')),
  );
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [reason, setReason] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const from = fromId || sources[0]?.id || '';
  const stock = useApi<{ items: StockItemView[] }>(
    from ? `/api/stock?q=&locationId=${from}` : null,
  );
  const save = useAction<object, { transfer: { transferNo: string } }>('POST', '/api/transfers', {
    invalidate: ['/api/transfers', '/api/stock'],
    onSuccess: (r) => onDone(r.transfer.transferNo),
  });
  const lines = Object.entries(qty)
    .filter(([, v]) => Number(v) > 0)
    .map(([batchId, v]) => ({ batchId, qty: Number(v) }));
  const to = toId || usable.find((l) => l.id !== from)?.id || '';
  return (
    <Card className="space-y-4">
      <h2 className="font-semibold">New transfer</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField id="tr-from" label="From">
          <Select
            value={from}
            onChange={(e) => {
              setFromId(e.target.value);
              setQty({});
            }}
          >
            {sources.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="tr-to" label="To">
          <Select value={to} onChange={(e) => setToId(e.target.value)}>
            {usable
              .filter((l) => l.id !== from)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </Select>
        </FormField>
        <FormField id="tr-reason" label="Reason" required>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Pharmacy restock"
          />
        </FormField>
      </div>
      {stock.isPending && from && <Spinner />}
      {stock.data && (
        <Table aria-label="Batches to send">
          <thead>
            <tr>
              <Th>Item</Th>
              <Th>Batch · expiry</Th>
              <Th>On hand</Th>
              <Th>Send</Th>
            </tr>
          </thead>
          <tbody>
            {stock.data.items.flatMap((item) =>
              item.batches
                .filter((b) => b.location.id === from && b.status === 'active' && b.qtyOnHand > 0)
                .map((b) => (
                  <tr key={b.id}>
                    <Td>{item.name}</Td>
                    <Td>
                      <span className="font-mono">{b.batchNo}</span> ·{' '}
                      {b.expiryDate ? formatDate(b.expiryDate) : 'no expiry'}
                    </Td>
                    <Td className="tabular-nums">{b.qtyOnHand}</Td>
                    <Td>
                      <Input
                        aria-label={`Send from ${b.batchNo}`}
                        className="w-24"
                        inputMode="numeric"
                        value={qty[b.id] ?? ''}
                        onChange={(e) => setQty({ ...qty, [b.id]: e.target.value })}
                      />
                    </Td>
                  </tr>
                )),
            )}
          </tbody>
        </Table>
      )}
      {save.error && <Alert tone="error">{save.error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!from || !to || !reason.trim() || lines.length === 0 || save.pending}
          onClick={() => save.run({ fromLocationId: from, toLocationId: to, reason, lines })}
        >
          Send transfer
        </Button>
      </div>
    </Card>
  );
}
