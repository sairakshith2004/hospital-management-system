import { hospitalToday } from '@hospitalos/shared';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Spinner } from '../../components/ui/spinner';
import { Stat } from '../../components/ui/stat';
import { addDays, formatRupees } from '../../lib/format';
import { useApi } from '../../lib/use-api';

interface Summary {
  invoicesIssued: number;
  invoicedPaise: string;
  collectedPaise: string;
  byMethod: Record<string, string>;
  outstandingPaise: string;
  approvedExpensesPaise: string;
}

/** Totals from issued invoices, payments and approved expenses. Not a statutory account. */
export function FinanceSummaryPage() {
  const [from, setFrom] = useState(addDays(hospitalToday(), -30));
  const [to, setTo] = useState(hospitalToday());
  const q = useApi<{ summary: Summary }>(`/api/billing/summary?from=${from}&to=${to}`);
  const s = q.data?.summary;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Finance summary"
        description="Simple operational totals from billing and expenses; not a statutory accounting report."
      />
      <div className="grid max-w-md grid-cols-2 gap-3">
        <FormField id="fs-from" label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </FormField>
        <FormField id="fs-to" label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </FormField>
      </div>
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{q.error.message}</Alert>}
      {s && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat label="Invoices issued" value={s.invoicesIssued} to="/billing" />
          <Stat label="Invoiced" value={formatRupees(Number(s.invoicedPaise))} />
          <Stat label="Collected" value={formatRupees(Number(s.collectedPaise))} />
          {Object.entries(s.byMethod).map(([m, v]) => (
            <Stat key={m} label={`Collected · ${m}`} value={formatRupees(Number(v))} />
          ))}
          <Stat
            label="Outstanding (all time)"
            value={formatRupees(Number(s.outstandingPaise))}
            tone={Number(s.outstandingPaise) > 0 ? 'warning' : 'default'}
            to="/billing?status=issued"
          />
          <Stat
            label="Approved expenses"
            value={formatRupees(Number(s.approvedExpensesPaise))}
            to="/finance/expenses"
          />
        </div>
      )}
    </div>
  );
}
