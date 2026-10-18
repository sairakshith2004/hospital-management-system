import { PAYMENT_METHODS, type InvoiceView, type ServiceItem } from '@hospitalos/shared';
import { useState } from 'react';
import { useParams } from 'react-router';
import { NotFoundPage } from '../../app/NotFoundPage';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { MoneyInput } from '../../components/ui/money-input';
import { PageHeader } from '../../components/ui/page-header';
import { Select } from '../../components/ui/select';
import { Spinner } from '../../components/ui/spinner';
import { Table, Td, Th } from '../../components/ui/table';
import { ApiError } from '../../lib/api';
import { formatDateTime, formatRupees } from '../../lib/format';
import { newKey, useAction, useApi } from '../../lib/use-api';
import { useAuth } from '../auth/auth-context';
import { InvoiceStatusBadge } from './status';

const METHOD: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  upi: 'UPI',
  bank: 'Bank transfer',
};

/** One invoice: lines, issue, payments, void and a printable layout. */
export function InvoicePage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const q = useApi<{ invoice: InvoiceView }>(`/api/invoices/${id}`);
  const services = useApi<{ services: ServiceItem[] }>(
    can('invoice:issue') ? '/api/services' : null,
  );
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [key, setKey] = useState(newKey);
  const [serviceId, setServiceId] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const reload = ['/api/invoices', '/api/billing'];
  const issue = useAction('POST', `/api/invoices/${id}/issue`, {
    invalidate: reload,
    onSuccess: () => setIssuing(false),
  });
  const pay = useAction<object, { receiptNo: string }>('POST', `/api/invoices/${id}/payments`, {
    invalidate: reload,
    onSuccess: (r) => {
      setNotice(`Payment recorded. Receipt ${r.receiptNo}.`);
      setAmount(null);
      setReference('');
      setKey(newKey());
    },
  });
  const addLine = useAction('POST', `/api/invoices/${id}/lines`, {
    invalidate: reload,
    onSuccess: () => setServiceId(''),
  });
  const voidIt = useAction<{ reason: string }>('POST', `/api/invoices/${id}/void`, {
    invalidate: reload,
    onSuccess: () => setVoiding(false),
  });

  if (q.isPending) return <Spinner />;
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404) return <NotFoundPage />;
    return <Alert tone="error">{q.error.message}</Alert>;
  }
  const inv = q.data.invoice;
  const payable = inv.status === 'issued' || inv.status === 'partially_paid';
  const lines = inv.lines.filter((l) => l.isActive);
  const canVoid =
    (inv.status === 'draft' && (can('invoice:discard_draft') || can('invoice:void'))) ||
    (inv.status === 'issued' && inv.paidPaise === 0 && can('invoice:void'));
  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <PageHeader
          title={inv.invoiceNo ?? 'Draft invoice'}
          crumbs={[{ label: 'Invoices', to: '/billing' }, { label: inv.invoiceNo ?? 'Draft' }]}
          actions={
            <>
              <InvoiceStatusBadge status={inv.status} />
              {inv.status !== 'draft' && (
                <Button variant="secondary" onClick={() => window.print()}>
                  Print
                </Button>
              )}
              {inv.status === 'draft' && can('invoice:issue') && (
                <Button onClick={() => setIssuing(true)}>Issue invoice</Button>
              )}
              {canVoid && (
                <Button variant="ghost" onClick={() => setVoiding(true)}>
                  {inv.status === 'draft' ? 'Discard draft' : 'Void'}
                </Button>
              )}
            </>
          }
        />
      </div>
      {notice && (
        <Alert tone="success" className="print:hidden">
          {notice}
        </Alert>
      )}
      <Card className="space-y-4 print:border-0 print:shadow-none">
        <div className="flex flex-wrap justify-between gap-3 text-sm">
          <div>
            <p className="text-lg font-semibold">HospitalOS Demo Hospital</p>
            <p className="text-slate-500">Synthetic demonstration invoice</p>
          </div>
          <div className="text-right">
            <p className="font-mono">{inv.invoiceNo ?? 'DRAFT'}</p>
            <p>{formatDateTime(inv.issuedAt ?? inv.createdAt)}</p>
            <p>
              {inv.patient.firstName} {inv.patient.lastName} ·{' '}
              <span className="font-mono">{inv.patient.mrn}</span>
            </p>
          </div>
        </div>
        <Table aria-label="Charges">
          <thead>
            <tr>
              <Th>Description</Th>
              <Th className="text-right">Qty</Th>
              <Th className="text-right">Rate</Th>
              <Th className="text-right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <Td>{l.description}</Td>
                <Td className="text-right tabular-nums">{l.qty}</Td>
                <Td className="text-right tabular-nums">{formatRupees(l.unitPricePaise)}</Td>
                <Td className="text-right tabular-nums">{formatRupees(l.lineTotalPaise)}</Td>
              </tr>
            ))}
            <tr>
              <Td colSpan={3} className="text-right font-medium">
                Total
              </Td>
              <Td className="text-right font-semibold tabular-nums">
                {formatRupees(inv.totalPaise)}
              </Td>
            </tr>
            <tr>
              <Td colSpan={3} className="text-right">
                Paid
              </Td>
              <Td className="text-right tabular-nums">{formatRupees(inv.paidPaise)}</Td>
            </tr>
            <tr>
              <Td colSpan={3} className="text-right font-medium">
                Balance due
              </Td>
              <Td className="text-right font-semibold tabular-nums">
                {formatRupees(inv.balancePaise)}
              </Td>
            </tr>
          </tbody>
        </Table>
        {inv.payments.length > 0 && (
          <div className="text-sm">
            <h3 className="font-medium">Payments</h3>
            <ul>
              {inv.payments.map((p) => (
                <li key={p.id} className="tabular-nums">
                  {p.receiptNo} · {formatDateTime(p.receivedAt)} · {METHOD[p.method]}{' '}
                  {p.reference ? `(${p.reference})` : ''} · {formatRupees(p.amountPaise)} ·{' '}
                  {p.receivedBy}
                </li>
              ))}
            </ul>
          </div>
        )}
        {inv.voidReason && <Alert tone="error">Void: {inv.voidReason}</Alert>}
      </Card>

      {inv.status === 'draft' && can('invoice:issue') && (
        <Card className="space-y-3 print:hidden">
          <h2 className="font-semibold">Add a service charge</h2>
          <div className="flex flex-wrap items-end gap-3">
            <FormField id="svc" label="Service">
              <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                <option value="">Choose…</option>
                {services.data?.services
                  .filter((s) => s.active && (s.kind === 'procedure' || s.kind === 'other'))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {formatRupees(s.pricePaise)}
                    </option>
                  ))}
              </Select>
            </FormField>
            <Button
              disabled={!serviceId || addLine.pending}
              onClick={() => addLine.run({ serviceId, qty: 1 })}
            >
              Add
            </Button>
          </div>
          {addLine.error && <Alert tone="error">{addLine.error}</Alert>}
        </Card>
      )}

      {payable && can('payment:record') && (
        <Card className="space-y-3 print:hidden">
          <h2 className="font-semibold">Record payment</h2>
          <form
            className="grid gap-3 sm:grid-cols-4 sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              pay.run({ amountPaise: amount, method, reference, idempotencyKey: key });
            }}
          >
            <FormField
              id="pay-amt"
              label="Amount"
              required
              hint={`Balance ${formatRupees(inv.balancePaise)}`}
            >
              <MoneyInput key={key} valuePaise={amount} onChange={setAmount} />
            </FormField>
            <FormField id="pay-method" label="Method">
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {METHOD[m]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="pay-ref" label="Reference">
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Card / UPI ref"
              />
            </FormField>
            <Button type="submit" disabled={!amount || pay.pending}>
              {pay.pending ? 'Saving…' : 'Record payment'}
            </Button>
            {pay.error && (
              <Alert tone="error" className="sm:col-span-4">
                {pay.error}
              </Alert>
            )}
          </form>
        </Card>
      )}
      <ConfirmDialog
        open={issuing}
        onOpenChange={setIssuing}
        title="Issue this invoice?"
        description={`It gets the next invoice number and its charges (${formatRupees(inv.totalPaise)}) can no longer change.`}
        confirmLabel="Issue invoice"
        pending={issue.pending}
        error={issue.error}
        onConfirm={() => issue.run(undefined)}
      />
      <ConfirmDialog
        open={voiding}
        onOpenChange={setVoiding}
        title={inv.status === 'draft' ? 'Discard draft invoice' : 'Void invoice'}
        confirmLabel={inv.status === 'draft' ? 'Discard' : 'Void'}
        reasonLabel="Reason"
        pending={voidIt.pending}
        error={voidIt.error}
        onConfirm={(reason) => voidIt.run({ reason })}
      />
    </div>
  );
}
