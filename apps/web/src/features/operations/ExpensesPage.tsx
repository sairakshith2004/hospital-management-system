import { useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { EmptyState } from '../../components/ui/empty-state';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { MoneyInput } from '../../components/ui/money-input';
import { PageHeader } from '../../components/ui/page-header';
import { Select } from '../../components/ui/select';
import { Table, Td, Th } from '../../components/ui/table';
import { Tabs } from '../../components/ui/tabs';
import { formatDate, formatRupees } from '../../lib/format';
import { useAction, useApi } from '../../lib/use-api';
import { useAuth } from '../auth/auth-context';
import { hospitalToday } from '@hospitalos/shared';

interface Expense {
  id: string;
  expenseNo: string;
  expenseDate: string;
  amountPaise: number;
  payee: string;
  description: string;
  status: string;
  category: { name: string };
  submittedBy: string;
  decidedBy: string | null;
  mine: boolean;
}

export function ExpensesPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState<'' | 'submitted' | 'approved' | 'rejected'>('');
  const q = useApi<{ expenses: Expense[] }>(
    `/api/finance/expenses${status ? `?status=${status}` : ''}`,
  );
  const cats = useApi<{ categories: { id: string; name: string; active: boolean }[] }>(
    '/api/finance/categories',
  );
  const [f, setF] = useState({
    categoryId: '',
    expenseDate: hospitalToday(),
    payee: '',
    description: '',
  });
  const [amount, setAmount] = useState<number | null>(null);
  const [cat, setCat] = useState({ code: '', name: '' });
  const reload = ['/api/finance', '/api/billing/summary'];
  const add = useAction('POST', '/api/finance/expenses', {
    invalidate: reload,
    onSuccess: () => {
      setF({ ...f, payee: '', description: '' });
      setAmount(null);
    },
  });
  const addCat = useAction('POST', '/api/finance/categories', {
    invalidate: reload,
    onSuccess: () => setCat({ code: '', name: '' }),
  });
  const decide = useAction<{ id: string; decision: string }>(
    'POST',
    (b) => `/api/finance/expenses/${b.id}/decide`,
    { invalidate: reload },
  );
  const err = add.error ?? addCat.error ?? decide.error;
  return (
    <div className="space-y-4">
      <PageHeader title="Expenses" description="Submitted expenses are approved by someone else." />
      {can('expense:create') && (
        <Card className="space-y-3">
          <form
            className="grid gap-3 sm:grid-cols-6 sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              add.run({ ...f, amountPaise: amount });
            }}
          >
            <FormField id="ex-cat" label="Category" required>
              <Select
                value={f.categoryId}
                onChange={(e) => setF({ ...f, categoryId: e.target.value })}
              >
                <option value="">Choose…</option>
                {cats.data?.categories
                  .filter((c) => c.active)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </FormField>
            <FormField id="ex-date" label="Date" required>
              <Input
                type="date"
                value={f.expenseDate}
                onChange={(e) => setF({ ...f, expenseDate: e.target.value })}
              />
            </FormField>
            <FormField id="ex-amt" label="Amount" required>
              <MoneyInput valuePaise={amount} onChange={setAmount} />
            </FormField>
            <FormField id="ex-payee" label="Payee" required>
              <Input value={f.payee} onChange={(e) => setF({ ...f, payee: e.target.value })} />
            </FormField>
            <FormField id="ex-desc" label="Description" required>
              <Input
                value={f.description}
                onChange={(e) => setF({ ...f, description: e.target.value })}
              />
            </FormField>
            <Button
              type="submit"
              disabled={!f.categoryId || !amount || !f.payee || !f.description || add.pending}
            >
              Submit
            </Button>
          </form>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addCat.run(cat);
            }}
          >
            <FormField id="cat-code" label="New category code">
              <Input
                value={cat.code}
                onChange={(e) => setCat({ ...cat, code: e.target.value.toUpperCase() })}
              />
            </FormField>
            <FormField id="cat-name" label="Name">
              <Input value={cat.name} onChange={(e) => setCat({ ...cat, name: e.target.value })} />
            </FormField>
            <Button
              type="submit"
              variant="secondary"
              disabled={!cat.code || !cat.name || addCat.pending}
            >
              Add category
            </Button>
          </form>
        </Card>
      )}
      {err && <Alert tone="error">{err}</Alert>}
      <Tabs
        label="Status"
        value={status}
        onChange={setStatus}
        tabs={[
          { value: '', label: 'All' },
          { value: 'submitted', label: 'To approve' },
          { value: 'approved', label: 'Approved' },
          { value: 'rejected', label: 'Rejected' },
        ]}
      />
      {q.data && q.data.expenses.length === 0 && <EmptyState title="No expenses" />}
      {q.data && q.data.expenses.length > 0 && (
        <Table aria-label="Expenses">
          <thead>
            <tr>
              <Th>No.</Th>
              <Th>Date</Th>
              <Th>Category</Th>
              <Th>Payee / description</Th>
              <Th>Amount</Th>
              <Th>Status</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {q.data.expenses.map((x) => (
              <tr key={x.id}>
                <Td className="font-mono">{x.expenseNo}</Td>
                <Td>{formatDate(x.expenseDate)}</Td>
                <Td>{x.category.name}</Td>
                <Td>
                  {x.payee}
                  <span className="block text-xs text-slate-500">
                    {x.description} · by {x.submittedBy}
                  </span>
                </Td>
                <Td className="tabular-nums">{formatRupees(x.amountPaise)}</Td>
                <Td>
                  <Badge
                    tone={
                      x.status === 'approved'
                        ? 'success'
                        : x.status === 'rejected'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {x.status}
                  </Badge>
                  {x.decidedBy && <span className="block text-xs">{x.decidedBy}</span>}
                </Td>
                <Td>
                  {x.status === 'submitted' && can('expense:approve') && !x.mine && (
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        onClick={() => decide.run({ id: x.id, decision: 'approved' })}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => decide.run({ id: x.id, decision: 'rejected' })}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
