import type { AppointmentDetail, InvoiceSummary } from '@hospitalos/shared';
import { Link, useNavigate } from 'react-router';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { formatRupees } from '../../lib/format';
import { useAction, useApi } from '../../lib/use-api';
import { useAuth } from '../auth/auth-context';
import { VitalsForm } from '../clinical/VitalsForm';

/** What other modules offer for this visit: consultation, triage vitals and billing. */
export function VisitPanel({ appointment: a }: { appointment: AppointmentDetail }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const active = a.status === 'checked_in' || a.status === 'in_consultation';
  const enc = useApi<{ encounter: { id: string } | null }>(
    can('patient:read_clinical') && a.status !== 'booked'
      ? `/api/appointments/${a.id}/encounter`
      : null,
    { retry: false },
  );
  const invoices = useApi<{ invoices: InvoiceSummary[] }>(
    can('invoice:read') ? `/api/invoices?patientId=${a.patient.id}` : null,
  );
  const visitInvoice = invoices.data?.invoices.find(
    (i) => i.appointmentId === a.id && i.status !== 'void',
  );
  const start = useAction<object, { encounterId: string }>(
    'POST',
    `/api/appointments/${a.id}/encounter`,
    {
      invalidate: ['scheduling', '/api/encounters'],
      onSuccess: (res) => void navigate(`/encounters/${res.encounterId}`),
    },
  );
  const showConsult = can('encounter:write') && (active || enc.data?.encounter);
  const showVitals = can('vitals:record') && active && !can('encounter:write');
  if (!showConsult && !showVitals && !visitInvoice) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {showConsult && (
        <Card className="space-y-3">
          <h2 className="font-semibold">Consultation</h2>
          {enc.data?.encounter ? (
            <Button asChild>
              <Link to={`/encounters/${enc.data.encounter.id}`}>Open consultation</Link>
            </Button>
          ) : (
            <Button disabled={start.pending} onClick={() => start.run({})}>
              Start consultation
            </Button>
          )}
          {start.error && <Alert tone="error">{start.error}</Alert>}
        </Card>
      )}
      {showVitals && (
        <Card className="space-y-3">
          <h2 className="font-semibold">Triage vital signs</h2>
          <VitalsForm appointmentId={a.id} />
        </Card>
      )}
      {visitInvoice && (
        <Card className="space-y-2">
          <h2 className="font-semibold">Billing</h2>
          <p className="text-sm">
            {visitInvoice.invoiceNo ?? 'Draft invoice'} · {formatRupees(visitInvoice.totalPaise)} ·
            balance {formatRupees(visitInvoice.balancePaise)}
          </p>
          <Button asChild variant="secondary">
            <Link to={`/billing/invoices/${visitInvoice.id}`}>Open invoice</Link>
          </Button>
        </Card>
      )}
    </div>
  );
}
