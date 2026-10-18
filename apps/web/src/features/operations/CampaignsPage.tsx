import { CAMPAIGN_STATUSES } from '@hospitalos/shared';
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
import { Stat } from '../../components/ui/stat';
import { Table, Td, Th } from '../../components/ui/table';
import { formatDate, formatRupees } from '../../lib/format';
import { useAction, useApi } from '../../lib/use-api';
import { useAuth } from '../auth/auth-context';

interface Campaign {
  id: string;
  name: string;
  channel: string;
  startDate: string;
  endDate: string | null;
  status: string;
  budgetPaise: number;
  enquiries: number;
  converted: number;
}

/** Campaigns with enquiry and conversion counts (aggregates only). */
export function CampaignsPage() {
  const { can } = useAuth();
  const q = useApi<{ campaigns: Campaign[] }>('/api/campaigns');
  const summary = useApi<{
    summary: { byStatus: Record<string, number>; byChannel: Record<string, number> };
  }>(can('report:marketing') ? '/api/marketing/summary' : null);
  const [f, setF] = useState({ name: '', channel: '', startDate: '', endDate: '' });
  const [budget, setBudget] = useState<number | null>(0);
  const add = useAction('POST', '/api/campaigns', {
    invalidate: ['/api/campaigns'],
    onSuccess: () => setF({ name: '', channel: '', startDate: '', endDate: '' }),
  });
  const status = useAction<{ id: string; status: string }>(
    'POST',
    (b) => `/api/campaigns/${b.id}/status`,
    { invalidate: ['/api/campaigns'] },
  );
  const by = summary.data?.summary.byStatus ?? {};
  return (
    <div className="space-y-4">
      <PageHeader title="Campaigns" />
      {summary.data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {['open', 'follow_up', 'converted', 'closed'].map((s) => (
            <Stat key={s} label={`Enquiries · ${s.replace('_', ' ')}`} value={by[s] ?? 0} />
          ))}
        </div>
      )}
      {can('campaign:manage') && (
        <Card>
          <form
            className="grid gap-3 sm:grid-cols-6 sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              add.run({ ...f, endDate: f.endDate || null, budgetPaise: budget ?? 0 });
            }}
          >
            <FormField id="cp-name" label="Name" required>
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </FormField>
            <FormField id="cp-ch" label="Channel" required>
              <Input
                value={f.channel}
                onChange={(e) => setF({ ...f, channel: e.target.value })}
                placeholder="e.g. health camp"
              />
            </FormField>
            <FormField id="cp-from" label="Start" required>
              <Input
                type="date"
                value={f.startDate}
                onChange={(e) => setF({ ...f, startDate: e.target.value })}
              />
            </FormField>
            <FormField id="cp-to" label="End">
              <Input
                type="date"
                value={f.endDate}
                onChange={(e) => setF({ ...f, endDate: e.target.value })}
              />
            </FormField>
            <FormField id="cp-budget" label="Budget">
              <MoneyInput valuePaise={budget} onChange={setBudget} />
            </FormField>
            <Button type="submit" disabled={!f.name || !f.channel || !f.startDate || add.pending}>
              Add campaign
            </Button>
            {add.error && (
              <Alert tone="error" className="sm:col-span-6">
                {add.error}
              </Alert>
            )}
          </form>
        </Card>
      )}
      {status.error && <Alert tone="error">{status.error}</Alert>}
      {q.data && q.data.campaigns.length === 0 && <EmptyState title="No campaigns" />}
      {q.data && q.data.campaigns.length > 0 && (
        <Table aria-label="Campaigns">
          <thead>
            <tr>
              <Th>Campaign</Th>
              <Th>Dates</Th>
              <Th>Budget</Th>
              <Th>Enquiries</Th>
              <Th>Converted</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {q.data.campaigns.map((c) => (
              <tr key={c.id}>
                <Td>
                  {c.name}
                  <span className="block text-xs text-slate-500">{c.channel}</span>
                </Td>
                <Td>
                  {formatDate(c.startDate)}
                  {c.endDate ? ` – ${formatDate(c.endDate)}` : ''}
                </Td>
                <Td className="tabular-nums">{formatRupees(c.budgetPaise)}</Td>
                <Td className="tabular-nums">{c.enquiries}</Td>
                <Td className="tabular-nums">{c.converted}</Td>
                <Td>
                  {can('campaign:manage') ? (
                    <Select
                      aria-label={`Status of ${c.name}`}
                      className="h-8"
                      value={c.status}
                      onChange={(e) => status.run({ id: c.id, status: e.target.value })}
                    >
                      {CAMPAIGN_STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </Select>
                  ) : (
                    c.status
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
