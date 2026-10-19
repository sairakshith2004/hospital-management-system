import type { AppointmentStatus, PatientChart } from '@hospitalos/shared';
import { Link, useParams, useSearchParams } from 'react-router';
import { ForbiddenPage } from '../../app/ForbiddenPage';
import { NotFoundPage } from '../../app/NotFoundPage';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { EmptyState } from '../../components/ui/empty-state';
import { PageHeader } from '../../components/ui/page-header';
import { Spinner } from '../../components/ui/spinner';
import { Table, Td, Th } from '../../components/ui/table';
import { ApiError } from '../../lib/api';
import { ageInYears, formatDate, formatDateTime, formatTime, sexLabel } from '../../lib/format';
import { useApi } from '../../lib/use-api';
import { useAuth } from '../auth/auth-context';
import { StatusBadge } from '../scheduling/status';
import { AllergyPanel } from './AllergyPanel';
import { PrescriptionList } from './PrescriptionList';
import { VitalsTable } from './VitalsTable';

/**
 * The treating doctor's view of the record. By default it holds only this doctor's own
 * consultations, results and prescriptions; "Previous reports from other doctors" shows
 * everyone's (?scope=all). Allergies are always complete. Every open is audited.
 */
export function PatientChartPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const all = params.get('scope') === 'all';
  const q = useApi<{ chart: PatientChart }>(`/api/patients/${id}/chart${all ? '?scope=all' : ''}`, {
    retry: false,
  });
  if (q.isPending) return <Spinner label="Loading chart…" />;
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404) return <NotFoundPage />;
    if (q.error instanceof ApiError && q.error.status === 403)
      return (
        <div className="space-y-3">
          <ForbiddenPage />
          <p className="text-center text-sm text-slate-600">
            Clinical records open only to a doctor caring for this patient (an appointment,
            consultation or follow-up with you).
          </p>
        </div>
      );
    return <Alert tone="error">{q.error.message}</Alert>;
  }
  const c = q.data.chart;
  const p = c.patient;
  return (
    <div className="space-y-4">
      <PageHeader
        title={`${p.firstName} ${p.lastName}`}
        crumbs={[
          { label: 'Patients', to: '/patients' },
          { label: p.mrn, to: `/patients/${p.id}` },
          { label: 'Chart' },
        ]}
        description={
          <>
            <span className="font-mono">{p.mrn}</span> · {ageInYears(p.dob)} y / {sexLabel(p.sex)}
            {p.bloodGroup ? ` · ${p.bloodGroup}` : ''}
          </>
        }
      />
      <AllergyPanel patientId={p.id} allergies={c.allergies} editable={can('allergy:record')} />
      {all ? (
        <Alert tone="info" className="flex flex-wrap items-center justify-between gap-2">
          <span>Showing records from every doctor at this hospital. This view is recorded.</span>
          <Button size="sm" variant="secondary" onClick={() => setParams({})}>
            Show only my records
          </Button>
        </Alert>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600 dark:text-slate-400">
          <span>Showing your own consultations, results and prescriptions for this patient.</span>
          {c.otherDoctorRecords > 0 && (
            <Button size="sm" variant="secondary" onClick={() => setParams({ scope: 'all' })}>
              Previous reports from other doctors ({c.otherDoctorRecords})
            </Button>
          )}
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="font-semibold">Consultations</h2>
          {c.encounters.length === 0 ? (
            <EmptyState title="No consultations yet" />
          ) : (
            <ul className="space-y-2 text-sm">
              {c.encounters.map((e) => (
                <li key={e.id} className="rounded-md bg-slate-50 p-2 dark:bg-slate-800">
                  <Link
                    className="font-medium text-brand-700 hover:underline dark:text-brand-400"
                    to={`/encounters/${e.id}`}
                  >
                    {formatDateTime(e.startedAt)} · {e.doctor.fullName}
                  </Link>{' '}
                  <Badge tone={e.status === 'completed' ? 'success' : 'warning'}>
                    {e.status.replace('_', ' ')}
                  </Badge>
                  {e.chiefComplaint && (
                    <span className="block text-slate-600 dark:text-slate-400">
                      {e.chiefComplaint}
                    </span>
                  )}
                  {e.diagnoses.length > 0 && (
                    <span className="block">
                      Dx: {e.diagnoses.map((d) => d.description).join('; ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="space-y-3">
          <h2 className="font-semibold">Lab results</h2>
          {c.labOrders.length === 0 ? (
            <EmptyState title="No lab orders" />
          ) : (
            <ul className="space-y-1 text-sm">
              {c.labOrders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2">
                  <Link
                    className="text-brand-700 hover:underline dark:text-brand-400"
                    to={`/lab/orders/${o.id}`}
                  >
                    {o.test.name} · {formatDate(o.orderedAt.slice(0, 10))}
                  </Link>
                  {all && <span className="text-xs text-slate-500">{o.doctor.fullName}</span>}
                  <Badge tone={o.status === 'verified' ? 'success' : 'info'}>{o.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="space-y-3 xl:col-span-2">
          <h2 className="font-semibold">Vital signs</h2>
          <VitalsTable vitals={c.vitals} />
        </Card>
        <Card className="space-y-3">
          <h2 className="font-semibold">Prescriptions</h2>
          <PrescriptionList prescriptions={c.prescriptions} canCancel={false} />
        </Card>
        <Card className="space-y-3">
          <h2 className="font-semibold">Appointments and follow-ups</h2>
          {c.followUps
            .filter((f) => f.status === 'pending' || f.status === 'booked')
            .map((f) => (
              <p key={f.id} className="text-sm">
                Follow-up: {f.reason} · {formatDate(f.dueFrom)}–{formatDate(f.dueTo)}{' '}
                <Badge>{f.status}</Badge>
              </p>
            ))}
          {c.appointments.length === 0 ? (
            <EmptyState title="No appointments" />
          ) : (
            <Table aria-label="Appointments">
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Doctor</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {c.appointments.map((a) => (
                  <tr key={a.id}>
                    <Td>
                      {formatDate(a.visitDate)} {a.slotStart ? formatTime(a.slotStart) : ''}
                    </Td>
                    <Td>{a.doctor.fullName}</Td>
                    <Td>
                      <StatusBadge status={a.status as AppointmentStatus} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
