import {
  LEAVE_KINDS,
  LEAVE_KIND_LABELS,
  hospitalToday,
  type LeaveRequestView,
  type LeaveSummaryRow,
} from '@hospitalos/shared';
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
import { Tabs } from '../../components/ui/tabs';
import { formatDate, formatDateTime } from '../../lib/format';
import { useAction, useApi } from '../../lib/use-api';
import { useAuth } from '../auth/auth-context';

type View = 'mine' | 'decide' | 'all' | 'summary';
type Decision = { request: LeaveRequestView; decision: 'approved' | 'rejected' };
type DecideResult = { ok: true; blockedSchedule: boolean; bookedAppointments: number };

const RELOAD = ['/api/hr/leave', '/api/hr/attendance'];

/** Calendar days from start to end, both included (0 when the range is not valid yet). */
export function leaveDays(start: string, end: string): number {
  if (!start || !end || end < start) return 0;
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'approved'
      ? 'success'
      : status === 'rejected'
        ? 'danger'
        : status === 'pending'
          ? 'warning'
          : 'neutral';
  return <Badge tone={tone}>{status === 'pending' ? 'waiting for HR' : status}</Badge>;
}

/**
 * Leave. Everyone requests their own leave here; only HR (leave:approve) sees everyone's
 * requests, approves or rejects them, and sees the yearly counts per person. The server
 * enforces all of this; the tabs only shape the screen.
 */
export function LeavePage() {
  const { can } = useAuth();
  const isHr = can('leave:approve');
  const canRequest = can('leave:request');
  const [view, setView] = useState<View>(isHr ? 'decide' : 'mine');
  const [statusFilter, setStatusFilter] = useState('');
  const [person, setPerson] = useState<{ id: string; name: string } | null>(null);
  const [year, setYear] = useState(Number(hospitalToday().slice(0, 4)));
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const listPath =
    view === 'mine'
      ? '/api/hr/leave?scope=mine'
      : view === 'decide'
        ? '/api/hr/leave?scope=all&status=pending'
        : view === 'all'
          ? `/api/hr/leave?scope=all${statusFilter ? `&status=${statusFilter}` : ''}${person ? `&employeeId=${person.id}` : ''}`
          : null;
  const list = useApi<{ requests: LeaveRequestView[] }>(listPath);
  const pending = useApi<{ requests: LeaveRequestView[] }>(
    isHr ? '/api/hr/leave?scope=all&status=pending' : null,
  );
  const summary = useApi<{ summary: LeaveSummaryRow[] }>(
    isHr && view === 'summary' ? `/api/hr/leave/summary?year=${year}` : null,
  );
  const toDecide = pending.data?.requests.filter((r) => !r.mine).length;
  const ownPending = pending.data?.requests.filter((r) => r.mine).length ?? 0;
  // Nobody decides their own leave, so "To approve" lists only other people's requests.
  const shown = list.data?.requests.filter((r) => view !== 'decide' || !r.mine);

  const decide = useAction<{ id: string; decision: string; note?: string }, DecideResult>(
    'POST',
    (b) => `/api/hr/leave/${b.id}/decide`,
    {
      invalidate: RELOAD,
      onSuccess: (res, body) => {
        const who = deciding?.request.employee.fullName ?? 'The request';
        setDeciding(null);
        if (body.decision === 'rejected') {
          setNotice(`Rejected. ${who} can see the reason; no leave is recorded.`);
          return;
        }
        setNotice(
          [
            `Approved. ${who} is on leave for these days.`,
            res.blockedSchedule && 'Their appointment slots are blocked for new bookings.',
            res.bookedAppointments > 0 &&
              `${plural(res.bookedAppointments, 'booked appointment')} on these days should be rescheduled by reception.`,
          ]
            .filter(Boolean)
            .join(' '),
        );
      },
    },
  );
  const cancel = useAction<{ id: string }>('POST', (b) => `/api/hr/leave/${b.id}/cancel`, {
    invalidate: RELOAD,
  });
  const err = decide.error ?? cancel.error;

  const tabs: { value: View; label: string; count?: number }[] = isHr
    ? [
        { value: 'decide', label: 'To approve', ...(toDecide ? { count: toDecide } : {}) },
        { value: 'all', label: 'All requests' },
        { value: 'summary', label: 'Leave count' },
        ...(canRequest ? [{ value: 'mine' as const, label: 'My leave' }] : []),
      ]
    : [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Leave"
        description={
          isHr
            ? 'Approve or reject staff leave and keep count of the days each person takes.'
            : 'Ask for leave. HR approves or rejects it; only approved leave counts.'
        }
      />
      {tabs.length > 0 && (
        <Tabs
          label="Leave views"
          value={view}
          onChange={(v) => {
            setView(v);
            setNotice(null);
          }}
          tabs={tabs}
        />
      )}
      {notice && <Alert tone="success">{notice}</Alert>}
      {err && <Alert tone="error">{err}</Alert>}

      {view === 'decide' && ownPending > 0 && (
        <Alert tone="info">
          Your own leave ({plural(ownPending, 'request')} waiting) is under My leave. You can't
          approve your own leave; another HR user has to decide it.
        </Alert>
      )}
      {view === 'mine' && canRequest && <RequestForm />}

      {view === 'all' && (
        <div className="flex flex-wrap items-end gap-3">
          <FormField id="lv-status" label="Status">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="pending">Waiting for HR</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </FormField>
          {person && (
            <Button variant="secondary" size="sm" onClick={() => setPerson(null)}>
              Showing {person.name} only · show everyone
            </Button>
          )}
        </div>
      )}

      {view === 'summary' ? (
        <SummaryTable
          year={year}
          onYear={setYear}
          rows={summary.data?.summary}
          loading={summary.isPending}
          onShow={(r) => {
            setPerson({ id: r.employeeId, name: r.fullName });
            setStatusFilter('');
            setView('all');
          }}
        />
      ) : (
        <>
          {list.isPending && <Spinner />}
          {shown && shown.length === 0 && (
            <EmptyState
              title={
                view === 'decide'
                  ? 'No leave is waiting for approval'
                  : view === 'mine'
                    ? 'You have not asked for leave yet'
                    : 'No leave requests'
              }
            />
          )}
          {shown && shown.length > 0 && (
            <RequestTable
              requests={shown}
              showStaff={view !== 'mine'}
              canDecide={isHr}
              onDecide={(request, decision) => {
                setNotice(null);
                setDeciding({ request, decision });
              }}
              onCancel={(id) => cancel.run({ id })}
            />
          )}
        </>
      )}

      {deciding && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeciding(null)}
          title={
            deciding.decision === 'approved'
              ? `Approve leave for ${deciding.request.employee.fullName}?`
              : `Reject leave for ${deciding.request.employee.fullName}?`
          }
          description={`${LEAVE_KIND_LABELS[deciding.request.kind]}: ${formatDate(deciding.request.startDate)} to ${formatDate(deciding.request.endDate)} (${plural(deciding.request.days, 'day')}).`}
          confirmLabel={deciding.decision === 'approved' ? 'Approve leave' : 'Reject leave'}
          {...(deciding.decision === 'rejected' ? { reasonLabel: 'Reason for rejecting' } : {})}
          pending={decide.pending}
          error={decide.error}
          onConfirm={(note) =>
            decide.run({
              id: deciding.request.id,
              decision: deciding.decision,
              ...(note ? { note } : {}),
            })
          }
        >
          {deciding.decision === 'approved' && deciding.request.bookedAppointments > 0 && (
            <Alert tone="error">
              {plural(deciding.request.bookedAppointments, 'appointment')} already booked with this
              doctor on these days. Approving blocks new bookings; reception will need to reschedule
              these.
            </Alert>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}

function RequestForm() {
  const [f, setF] = useState({ kind: 'casual', startDate: '', endDate: '', reason: '' });
  const [sent, setSent] = useState(false);
  const request = useAction('POST', '/api/hr/leave', {
    invalidate: RELOAD,
    onSuccess: () => {
      setF({ kind: 'casual', startDate: '', endDate: '', reason: '' });
      setSent(true);
    },
  });
  const days = leaveDays(f.startDate, f.endDate);
  return (
    <Card className="space-y-3">
      <form
        className="grid gap-3 sm:grid-cols-5 sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setSent(false);
          request.run(f);
        }}
      >
        <FormField id="lv-kind" label="Type">
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {LEAVE_KINDS.map((k) => (
              <option key={k} value={k}>
                {LEAVE_KIND_LABELS[k]}
              </option>
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
            min={f.startDate || undefined}
            value={f.endDate}
            onChange={(e) => setF({ ...f, endDate: e.target.value })}
          />
        </FormField>
        <FormField id="lv-reason" label="Reason" required>
          <Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </FormField>
        <Button type="submit" disabled={days === 0 || !f.reason.trim() || request.pending}>
          Send to HR
        </Button>
      </form>
      {days > 0 && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {plural(days, 'day')}: {formatDate(f.startDate)}
          {days > 1 && ` to ${formatDate(f.endDate)}`}.
        </p>
      )}
      {request.error && <Alert tone="error">{request.error}</Alert>}
      {sent && (
        <Alert tone="success">Sent to HR. Your leave counts only once HR approves it.</Alert>
      )}
    </Card>
  );
}

function RequestTable({
  requests,
  showStaff,
  canDecide,
  onDecide,
  onCancel,
}: {
  requests: LeaveRequestView[];
  showStaff: boolean;
  canDecide: boolean;
  onDecide(r: LeaveRequestView, decision: 'approved' | 'rejected'): void;
  onCancel(id: string): void;
}) {
  return (
    <Table aria-label="Leave requests">
      <thead>
        <tr>
          {showStaff && <Th>Staff</Th>}
          <Th>Type</Th>
          <Th>Days</Th>
          <Th>Reason</Th>
          <Th>Applied</Th>
          <Th>Status</Th>
          <Th></Th>
        </tr>
      </thead>
      <tbody>
        {requests.map((r) => (
          <tr key={r.id}>
            {showStaff && (
              <Td>
                {r.employee.fullName}
                <span className="block text-xs text-slate-500">
                  {r.employee.department} · {r.employee.employeeNo}
                </span>
              </Td>
            )}
            <Td>{LEAVE_KIND_LABELS[r.kind]}</Td>
            <Td>
              {formatDate(r.startDate)}
              {r.days > 1 && ` – ${formatDate(r.endDate)}`}
              <span className="block text-xs text-slate-500">{plural(r.days, 'day')}</span>
              {showStaff && r.bookedAppointments > 0 && r.status === 'pending' && (
                <span className="block text-xs text-red-700 dark:text-red-300">
                  {plural(r.bookedAppointments, 'booked appointment')} on these days
                </span>
              )}
            </Td>
            <Td>{r.reason}</Td>
            <Td className="text-sm">{formatDateTime(r.createdAt)}</Td>
            <Td>
              <StatusBadge status={r.status} />
              {r.decidedAt && (
                <span className="block text-xs text-slate-500">
                  by {r.decidedBy ?? 'HR'}, {formatDateTime(r.decidedAt)}
                </span>
              )}
              {r.decisionNote && (
                <span className="block text-xs text-slate-600 dark:text-slate-300">
                  “{r.decisionNote}”
                </span>
              )}
            </Td>
            <Td>
              <div className="flex gap-1.5">
                {r.status === 'pending' && canDecide && !r.mine && (
                  <>
                    <Button size="sm" onClick={() => onDecide(r, 'approved')}>
                      Approve
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onDecide(r, 'rejected')}>
                      Reject
                    </Button>
                  </>
                )}
                {r.status === 'pending' && r.mine && (
                  <Button size="sm" variant="ghost" onClick={() => onCancel(r.id)}>
                    Cancel
                  </Button>
                )}
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function SummaryTable({
  year,
  onYear,
  rows,
  loading,
  onShow,
}: {
  year: number;
  onYear(y: number): void;
  rows: LeaveSummaryRow[] | undefined;
  loading: boolean;
  onShow(r: LeaveSummaryRow): void;
}) {
  const thisYear = Number(hospitalToday().slice(0, 4));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <FormField id="lv-year" label="Year">
          <Select value={String(year)} onChange={(e) => onYear(Number(e.target.value))}>
            {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </FormField>
        <p className="pb-2 text-sm text-slate-600 dark:text-slate-400">
          Approved leave only, in calendar days (weekends included).
        </p>
      </div>
      {loading && <Spinner />}
      {rows && rows.length === 0 && <EmptyState title="No staff yet" />}
      {rows && rows.length > 0 && (
        <Table aria-label={`Leave count ${year}`}>
          <thead>
            <tr>
              <Th>Staff</Th>
              {LEAVE_KINDS.map((k) => (
                <Th key={k}>{LEAVE_KIND_LABELS[k].replace(' leave', '')}</Th>
              ))}
              <Th>Total days</Th>
              <Th>Waiting</Th>
              <Th>Rejected</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employeeId}>
                <Td>
                  {r.fullName}
                  <span className="block text-xs text-slate-500">
                    {r.department} · {r.employeeNo}
                  </span>
                </Td>
                {LEAVE_KINDS.map((k) => (
                  <Td key={k} className="tabular-nums">
                    {r.approvedDays[k] || '–'}
                  </Td>
                ))}
                <Td className="font-semibold tabular-nums">{r.totalApprovedDays}</Td>
                <Td className="tabular-nums">{r.pendingRequests || '–'}</Td>
                <Td className="tabular-nums">{r.rejectedRequests || '–'}</Td>
                <Td>
                  <Button size="sm" variant="ghost" onClick={() => onShow(r)}>
                    View requests
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
