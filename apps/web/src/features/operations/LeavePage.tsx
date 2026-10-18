import { LEAVE_KINDS } from '@hospitalos/shared';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { EmptyState } from '../../components/ui/empty-state';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Select } from '../../components/ui/select';
import { Table, Td, Th } from '../../components/ui/table';
import { Tabs } from '../../components/ui/tabs';
import { formatDate } from '../../lib/format';
import { useAction, useApi } from '../../lib/use-api';
import { useAuth } from '../auth/auth-context';

interface Req {
  id: string;
  kind: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: string;
  decisionNote: string | null;
  employee: { fullName: string; employeeNo: string };
  mine: boolean;
}

export function LeavePage() {
  const { can } = useAuth();
  const [scope, setScope] = useState<'mine' | 'all'>(can('leave:request') ? 'mine' : 'all');
  const q = useApi<{ requests: Req[] }>(`/api/hr/leave?scope=${scope}`);
  const [f, setF] = useState({ kind: 'casual', startDate: '', endDate: '', reason: '' });
  const reload = ['/api/hr/leave', '/api/hr/attendance'];
  const request = useAction('POST', '/api/hr/leave', {
    invalidate: reload,
    onSuccess: () => setF({ kind: 'casual', startDate: '', endDate: '', reason: '' }),
  });
  const decide = useAction<{ id: string; decision: string }>(
    'POST',
    (b) => `/api/hr/leave/${b.id}/decide`,
    { invalidate: reload },
  );
  const cancel = useAction<{ id: string }>('POST', (b) => `/api/hr/leave/${b.id}/cancel`, {
    invalidate: reload,
  });
  const err = request.error ?? decide.error ?? cancel.error;
  return (
    <div className="space-y-4">
      <PageHeader title="Leave" />
      {can('leave:approve') && can('leave:request') && (
        <Tabs
          label="Whose requests"
          value={scope}
          onChange={setScope}
          tabs={[
            { value: 'mine', label: 'My requests' },
            { value: 'all', label: 'All staff' },
          ]}
        />
      )}
      {scope === 'mine' && can('leave:request') && (
        <Card>
          <form
            className="grid gap-3 sm:grid-cols-5 sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              request.run(f);
            }}
          >
            <FormField id="lv-kind" label="Type">
              <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                {LEAVE_KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </Select>
            </FormField>
            <FormField id="lv-from" label="From" required>
              <Input
                type="date"
                value={f.startDate}
                onChange={(e) => setF({ ...f, startDate: e.target.value })}
              />
            </FormField>
            <FormField id="lv-to" label="To" required>
              <Input
                type="date"
                value={f.endDate}
                onChange={(e) => setF({ ...f, endDate: e.target.value })}
              />
            </FormField>
            <FormField id="lv-reason" label="Reason" required>
              <Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
            </FormField>
            <Button
              type="submit"
              disabled={!f.startDate || !f.endDate || !f.reason.trim() || request.pending}
            >
              Request leave
            </Button>
          </form>
        </Card>
      )}
      {err && <Alert tone="error">{err}</Alert>}
      {q.data && q.data.requests.length === 0 && <EmptyState title="No leave requests" />}
      {q.data && q.data.requests.length > 0 && (
        <Table aria-label="Leave requests">
          <thead>
            <tr>
              <Th>Staff</Th>
              <Th>Dates</Th>
              <Th>Type</Th>
              <Th>Reason</Th>
              <Th>Status</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {q.data.requests.map((r) => (
              <tr key={r.id}>
                <Td>{r.employee.fullName}</Td>
                <Td>
                  {formatDate(r.startDate)} – {formatDate(r.endDate)}
                </Td>
                <Td>{r.kind}</Td>
                <Td>
                  {r.reason}
                  {r.decisionNote && (
                    <span className="block text-xs text-slate-500">{r.decisionNote}</span>
                  )}
                </Td>
                <Td>
                  <Badge
                    tone={
                      r.status === 'approved'
                        ? 'success'
                        : r.status === 'rejected'
                          ? 'danger'
                          : r.status === 'pending'
                            ? 'warning'
                            : 'neutral'
                    }
                  >
                    {r.status}
                  </Badge>
                </Td>
                <Td>
                  <div className="flex gap-1.5">
                    {r.status === 'pending' && can('leave:approve') && !r.mine && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => decide.run({ id: r.id, decision: 'approved' })}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => decide.run({ id: r.id, decision: 'rejected' })}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    {r.status === 'pending' && r.mine && (
                      <Button size="sm" variant="ghost" onClick={() => cancel.run({ id: r.id })}>
                        Cancel
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
