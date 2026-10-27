import {
  INVOICE_STATUSES,
  type InvoiceStatus,
  type InvoiceSummary,
  type PatientIdentity,
} from '@hospitalos/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { EmptyState } from '../../components/ui/empty-state';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Select } from '../../components/ui/select';
import { Spinner } from '../../components/ui/spinner';
import { Table, Td, Th } from '../../components/ui/table';
import { formatDateTime, formatRupees } from '../../lib/format';
import { useApi } from '../../lib/use-api';
import {
  LookupSection,
  PatientIdentityCard,
  PatientNumberSearch,
  useLookupMrn,
} from '../patients/PatientNumberLookup';
import { INVOICE_LABEL, InvoiceStatusBadge } from './status';

export function InvoicesPage() {
  const [mrn, setMrn] = useLookupMrn();
  return (
    <div className="space-y-4">
      <PageHeader
        title="Invoices"
        description="One invoice per visit. Charges are added automatically at check-in, dispensing and lab ordering. Enter a patient number to see one patient's bills."
      />
      <PatientNumberSearch key={mrn ?? ''} mrn={mrn} onSearch={setMrn} />
      {mrn ? <PatientBills mrn={mrn} /> : <InvoiceList />}
    </div>
  );
}

function InvoiceList() {
  const [status, setStatus] = useState<InvoiceStatus | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const params = new URLSearchParams({
    ...(status ? { status } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });
  const q = useApi<{ invoices: InvoiceSummary[] }>(`/api/invoices?${params.toString()}`);
  const totals = q.data?.invoices.reduce(
    (s, i) => ({
      total: s.total + i.totalPaise,
      balance: s.balance + (i.status === 'void' || i.status === 'draft' ? 0 : i.balancePaise),
    }),
    { total: 0, balance: 0 },
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField id="inv-status" label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as InvoiceStatus | '')}>
            <option value="">All</option>
            {INVOICE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {INVOICE_LABEL[s]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="inv-from" label="Created from">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </FormField>
        <FormField id="inv-to" label="Created to">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </FormField>
      </div>
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{q.error.message}</Alert>}
      {q.data && q.data.invoices.length === 0 && <EmptyState title="No invoices match" />}
      {q.data && q.data.invoices.length > 0 && (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {q.data.invoices.length} invoices · total {formatRupees(totals!.total)} · outstanding{' '}
            {formatRupees(totals!.balance)}
          </p>
          <InvoiceTable invoices={q.data.invoices} />
        </>
      )}
    </div>
  );
}

function InvoiceTable({
  invoices,
  label = 'Invoices',
}: {
  invoices: InvoiceSummary[];
  label?: string;
}) {
  return (
    <Table aria-label={label}>
      <thead>
        <tr>
          <Th>Invoice</Th>
          <Th>Patient</Th>
          <Th>Total</Th>
          <Th>Paid</Th>
          <Th>Balance</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {invoices.map((i) => (
          <tr key={i.id}>
            <Td>
              <Link
                className="font-mono text-brand-700 hover:underline dark:text-brand-400"
                to={`/billing/invoices/${i.id}`}
              >
                {i.invoiceNo ?? 'Draft'}
              </Link>
              <span className="block text-xs text-slate-500">
                {formatDateTime(i.issuedAt ?? i.createdAt)}
              </span>
            </Td>
            <Td>
              {i.patient.firstName} {i.patient.lastName}
              <span className="block font-mono text-xs text-slate-500">{i.patient.mrn}</span>
            </Td>
            <Td className="tabular-nums">{formatRupees(i.totalPaise)}</Td>
            <Td className="tabular-nums">{formatRupees(i.paidPaise)}</Td>
            <Td className="tabular-nums">{formatRupees(i.balancePaise)}</Td>
            <Td>
              <InvoiceStatusBadge status={i.status} />
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** One patient's bills, found by patient number. */
function PatientBills({ mrn }: { mrn: string }) {
  const q = useApi<{ patient: PatientIdentity; invoices: InvoiceSummary[] }>(
    `/api/billing/patients/${encodeURIComponent(mrn)}`,
  );
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="error">{q.error.message}</Alert>;
  const { patient, invoices } = q.data;
  const toPay = invoices.filter((i) => i.status === 'issued' || i.status === 'partially_paid');
  const drafts = invoices.filter((i) => i.status === 'draft');
  const past = invoices.filter((i) => i.status === 'paid' || i.status === 'void');
  const due = toPay.reduce((s, i) => s + i.balancePaise, 0);
  return (
    <div className="space-y-4">
      <PatientIdentityCard patient={patient}>
        <Badge tone={due > 0 ? 'warning' : 'success'}>Due {formatRupees(due)}</Badge>
      </PatientIdentityCard>
      <LookupSection title="Bills to be paid" count={toPay.length}>
        <InvoiceTable invoices={toPay} label="Bills to be paid" />
      </LookupSection>
      <LookupSection title="Open visits (draft, not issued yet)" count={drafts.length}>
        <InvoiceTable invoices={drafts} label="Draft bills" />
      </LookupSection>
      <LookupSection title="Past bills" count={past.length}>
        <InvoiceTable invoices={past} label="Past bills" />
      </LookupSection>
    </div>
  );
}
