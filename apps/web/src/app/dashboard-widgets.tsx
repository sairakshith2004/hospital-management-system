import { hospitalToday } from '@hospitalos/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Spinner } from '../components/ui/spinner';
import { Stat } from '../components/ui/stat';
import { useAuth } from '../features/auth/auth-context';
import { getQueue, listAppointments, schedulingKeys } from '../features/scheduling/scheduling-api';
import type { InvoiceSummary, LabOrderView, StaffAccount, StockItemView } from '@hospitalos/shared';
import { formatRupees } from '../lib/format';
import { useApi } from '../lib/use-api';
import type { DashboardWidget } from './HomePage';

export function WidgetSection({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="space-y-3" aria-label={title}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
          <span
            aria-hidden="true"
            className="h-4 w-1 rounded-full bg-gradient-to-b from-brand-600 to-teal-400"
          />
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function FrontDeskToday() {
  const { can } = useAuth();
  const today = hospitalToday();
  const q = useQuery({
    queryKey: schedulingKeys.appointments(today),
    queryFn: ({ signal }) => listAppointments({ date: today }, signal),
    refetchInterval: 30_000,
  });
  const count = (...s: string[]) => q.data?.filter((a) => s.includes(a.status)).length ?? 0;
  return (
    <WidgetSection
      title="Today at the front desk"
      action={
        can('appointment:book') && (
          <Button asChild size="sm">
            <Link to="/appointments/new">Book appointment</Link>
          </Button>
        )
      }
    >
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{q.error.message}</Alert>}
      {q.isSuccess && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Appointments" value={q.data.length} to="/appointments" />
          <Stat label="Booked" value={count('booked')} to="/appointments?status=booked" />
          <Stat label="Waiting" value={count('checked_in')} to="/queue" />
          <Stat label="Seen" value={count('completed')} to="/appointments?status=completed" />
          <Stat label="Cancelled / no-show" value={count('cancelled', 'no_show')} />
        </div>
      )}
    </WidgetSection>
  );
}

function MyQueue() {
  const q = useQuery({
    queryKey: schedulingKeys.queue(hospitalToday()),
    queryFn: ({ signal }) => getQueue({}, signal),
    refetchInterval: 15_000,
  });
  if (q.isError) return null; // e.g. no doctor profile: the Queue page explains.
  const waiting = q.data?.queue.filter((a) => a.status === 'checked_in').length ?? 0;
  const inRoom = q.data?.queue.filter((a) => a.status === 'in_consultation').length ?? 0;
  return (
    <WidgetSection title="My queue today">
      {q.isPending ? (
        <Spinner />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Waiting" value={waiting} to="/queue" />
          <Stat label="In consultation" value={inRoom} to="/queue" />
        </div>
      )}
    </WidgetSection>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{children}</div>;
}

function MyConsultations() {
  const q = useApi<{ encounters: { id: string }[] }>('/api/encounters/mine');
  if (!q.data) return null;
  return (
    <WidgetSection title="Open consultations">
      <Grid>
        <Stat label="In progress" value={q.data.encounters.length} to="/queue" />
      </Grid>
    </WidgetSection>
  );
}

function PharmacyWork() {
  const rx = useApi<{ prescriptions: unknown[] }>('/api/pharmacy/prescriptions?status=open', {
    refetchInterval: 30_000,
  });
  const low = useApi<{ items: StockItemView[] }>('/api/stock?q=&kind=medicine&low=true');
  return (
    <WidgetSection title="Pharmacy">
      <Grid>
        <Stat label="To dispense" value={rx.data?.prescriptions.length ?? '…'} to="/pharmacy" />
        <Stat
          label="Medicines at or below reorder level"
          value={low.data?.items.length ?? '…'}
          tone={low.data?.items.length ? 'warning' : 'default'}
          to="/inventory/stock"
        />
      </Grid>
    </WidgetSection>
  );
}

function StoreWork() {
  const low = useApi<{ items: StockItemView[] }>('/api/stock?q=&low=true');
  const tr = useApi<{ transfers: { status: string }[] }>('/api/transfers');
  return (
    <WidgetSection title="Inventory">
      <Grid>
        <Stat
          label="Items at or below reorder level"
          value={low.data?.items.length ?? '…'}
          tone={low.data?.items.length ? 'warning' : 'default'}
          to="/inventory/stock"
        />
        <Stat
          label="Transfers in transit"
          value={tr.data?.transfers.filter((t) => t.status === 'dispatched').length ?? '…'}
          to="/inventory/transfers"
        />
      </Grid>
    </WidgetSection>
  );
}

function LabWork() {
  const q = useApi<{ orders: LabOrderView[] }>('/api/lab/orders', { refetchInterval: 30_000 });
  const n = (s: string) => q.data?.orders.filter((o) => o.status === s).length ?? '…';
  return (
    <WidgetSection title="Laboratory">
      <Grid>
        <Stat label="To collect" value={n('ordered')} to="/lab" />
        <Stat label="To result" value={n('collected')} to="/lab" />
        <Stat label="To verify" value={n('resulted')} to="/lab" />
        <Stat
          label="Urgent open"
          value={q.data?.orders.filter((o) => o.priority === 'urgent').length ?? '…'}
          tone="danger"
          to="/lab"
        />
      </Grid>
    </WidgetSection>
  );
}

function BillingWork() {
  const draft = useApi<{ invoices: InvoiceSummary[] }>('/api/invoices?status=draft');
  const issued = useApi<{ invoices: InvoiceSummary[] }>('/api/invoices?status=issued');
  const part = useApi<{ invoices: InvoiceSummary[] }>('/api/invoices?status=partially_paid');
  const due = [...(issued.data?.invoices ?? []), ...(part.data?.invoices ?? [])];
  return (
    <WidgetSection title="Billing">
      <Grid>
        <Stat
          label="Draft invoices"
          value={draft.data?.invoices.length ?? '…'}
          to="/billing?status=draft"
        />
        <Stat label="Unpaid invoices" value={due.length} to="/billing" />
        <Stat
          label="Outstanding"
          value={formatRupees(due.reduce((s, i) => s + i.balancePaise, 0))}
          tone={due.length ? 'warning' : 'default'}
          to="/billing"
        />
      </Grid>
    </WidgetSection>
  );
}

function FollowUpWork() {
  const q = useApi<{ followUps: unknown[] }>('/api/follow-ups?status=pending');
  return (
    <WidgetSection title="Follow-ups">
      <Grid>
        <Stat label="To book" value={q.data?.followUps.length ?? '…'} to="/follow-ups" />
      </Grid>
    </WidgetSection>
  );
}

function PeopleWork() {
  const leave = useApi<{ requests: { status: string; mine: boolean }[] }>(
    '/api/hr/leave?scope=all',
  );
  const att = useApi<{ rows: { status: string | null }[] }>(
    `/api/hr/attendance?date=${hospitalToday()}`,
  );
  return (
    <WidgetSection title="People today">
      <Grid>
        <Stat
          label="Leave to decide"
          value={
            leave.data?.requests.filter((r) => r.status === 'pending' && !r.mine).length ?? '…'
          }
          to="/hr/leave"
        />
        <Stat
          label="Attendance marked"
          value={
            att.data
              ? `${att.data.rows.filter((r) => r.status).length} / ${att.data.rows.length}`
              : '…'
          }
          to="/hr/attendance"
        />
      </Grid>
    </WidgetSection>
  );
}

function ApprovalsWork() {
  const exp = useApi<{ expenses: { mine: boolean }[] }>('/api/finance/expenses?status=submitted');
  return (
    <WidgetSection title="Approvals">
      <Grid>
        <Stat
          label="Expenses to approve"
          value={exp.data?.expenses.filter((e) => !e.mine).length ?? '…'}
          to="/finance/expenses"
        />
      </Grid>
    </WidgetSection>
  );
}

function FacilitiesWork() {
  const q = useApi<{ equipment: { maintenanceDue: boolean; status: string }[] }>('/api/equipment');
  return (
    <WidgetSection title="Equipment">
      <Grid>
        <Stat
          label="Maintenance due"
          value={
            q.data?.equipment.filter((e) => e.maintenanceDue && e.status !== 'retired').length ??
            '…'
          }
          tone="warning"
          to="/equipment"
        />
        <Stat
          label="Out of service"
          value={q.data?.equipment.filter((e) => e.status === 'out_of_service').length ?? '…'}
          to="/equipment"
        />
      </Grid>
    </WidgetSection>
  );
}

function OutreachWork() {
  const q = useApi<{ enquiries: { status: string }[] }>('/api/enquiries');
  const n = (s: string) => q.data?.enquiries.filter((e) => e.status === s).length ?? '…';
  return (
    <WidgetSection title="Enquiries">
      <Grid>
        <Stat label="Open" value={n('open')} to="/enquiries" />
        <Stat label="Following up" value={n('follow_up')} to="/enquiries" />
        <Stat label="Converted" value={n('converted')} to="/enquiries" />
      </Grid>
    </WidgetSection>
  );
}

function AccessWork() {
  const q = useApi<{ staff: StaffAccount[] }>('/api/admin/staff');
  return (
    <WidgetSection title="Accounts">
      <Grid>
        <Stat
          label="Awaiting a role"
          value={
            q.data?.staff.filter(
              (s) => s.user && s.user.status === 'active' && s.user.roles.length === 0,
            ).length ?? '…'
          }
          tone="warning"
          to="/admin/staff"
        />
        <Stat
          label="Locked out"
          value={q.data?.staff.filter((s) => s.user?.locked).length ?? '…'}
          to="/admin/staff"
        />
      </Grid>
    </WidgetSection>
  );
}

/** Widgets in display order. Each loads its own real data. */
export const DASHBOARD_WIDGETS: DashboardWidget[] = [
  { key: 'front-desk', anyOf: ['appointment:read_all'], Component: FrontDeskToday },
  { key: 'my-queue', anyOf: ['encounter:write'], Component: MyQueue },
  { key: 'my-consultations', anyOf: ['encounter:write'], Component: MyConsultations },
  { key: 'follow-ups', anyOf: ['followup:schedule'], Component: FollowUpWork },
  { key: 'billing', anyOf: ['invoice:issue'], Component: BillingWork },
  { key: 'pharmacy', anyOf: ['prescription:dispense'], Component: PharmacyWork },
  { key: 'store', anyOf: ['goods_receipt:create'], Component: StoreWork },
  { key: 'lab', anyOf: ['lab:process', 'lab_result:verify'], Component: LabWork },
  { key: 'people', anyOf: ['leave:approve'], Component: PeopleWork },
  { key: 'approvals', anyOf: ['expense:approve'], Component: ApprovalsWork },
  { key: 'facilities', anyOf: ['equipment:manage'], Component: FacilitiesWork },
  { key: 'outreach', anyOf: ['campaign:manage'], Component: OutreachWork },
  { key: 'access', anyOf: ['user_role:assign'], Component: AccessWork },
];
