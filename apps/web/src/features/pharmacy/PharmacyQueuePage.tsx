import { useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { EmptyState } from '../../components/ui/empty-state';
import { PageHeader } from '../../components/ui/page-header';
import { Spinner } from '../../components/ui/spinner';
import { Table, Td, Th } from '../../components/ui/table';
import { Tabs } from '../../components/ui/tabs';
import { formatDateTime } from '../../lib/format';
import { useApi } from '../../lib/use-api';
import { RxStatus } from '../clinical/PrescriptionList';
import type { PatientIdentity, PrescriptionView } from '@hospitalos/shared';
import {
  LookupSection,
  PatientIdentityCard,
  PatientNumberSearch,
  useLookupMrn,
} from '../patients/PatientNumberLookup';
import type { PharmacyAllergy, PharmacyPrescription } from './types';

const OPEN: string[] = ['issued', 'partially_dispensed'];

export function PharmacyQueuePage() {
  const [mrn, setMrn] = useLookupMrn();
  return (
    <div className="space-y-4">
      <PageHeader
        title="Prescriptions"
        description="Prescriptions issued by doctors, oldest first. Enter a patient number to see one patient's prescriptions."
      />
      <PatientNumberSearch key={mrn ?? ''} mrn={mrn} onSearch={setMrn} />
      {mrn ? <PatientPrescriptions mrn={mrn} /> : <PrescriptionQueue />}
    </div>
  );
}

function PrescriptionQueue() {
  const [status, setStatus] = useState<'open' | 'dispensed' | 'all'>('open');
  const q = useApi<{ prescriptions: PharmacyPrescription[] }>(
    `/api/pharmacy/prescriptions?status=${status}`,
    {
      refetchInterval: 20_000,
    },
  );
  return (
    <div className="space-y-4">
      <Tabs
        label="Prescription status"
        value={status}
        onChange={setStatus}
        tabs={[
          { value: 'open', label: 'To dispense' },
          { value: 'dispensed', label: 'Dispensed / closed' },
          { value: 'all', label: 'All' },
        ]}
      />
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{q.error.message}</Alert>}
      {q.data && q.data.prescriptions.length === 0 && (
        <EmptyState title="Nothing here">
          New prescriptions appear as doctors issue them.
        </EmptyState>
      )}
      {q.data && q.data.prescriptions.length > 0 && (
        <PrescriptionTable prescriptions={q.data.prescriptions} />
      )}
    </div>
  );
}

function PrescriptionTable({
  prescriptions,
  label = 'Prescriptions',
}: {
  prescriptions: (PrescriptionView & { allergies?: PharmacyAllergy[] })[];
  label?: string;
}) {
  return (
    <Table aria-label={label}>
      <thead>
        <tr>
          <Th>Prescription</Th>
          <Th>Patient</Th>
          <Th>Doctor</Th>
          <Th>Items</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {prescriptions.map((rx) => (
          <tr key={rx.id}>
            <Td>
              <Link
                className="font-mono text-brand-700 hover:underline dark:text-brand-400"
                to={`/pharmacy/prescriptions/${rx.id}`}
              >
                {rx.rxNo}
              </Link>
              <span className="block text-xs text-slate-500">{formatDateTime(rx.issuedAt)}</span>
            </Td>
            <Td>
              {rx.patient.firstName} {rx.patient.lastName}
              <span className="block font-mono text-xs text-slate-500">{rx.patient.mrn}</span>
              {(rx.allergies?.length ?? 0) > 0 && <Badge tone="danger">Allergies</Badge>}
            </Td>
            <Td>{rx.doctor.fullName}</Td>
            <Td className="text-xs">
              {rx.items.map((i) => (
                <span key={i.id} className="block">
                  {i.product} × {i.qtyPrescribed}
                  {i.qtyDispensed > 0 ? ` (${i.qtyDispensed} given)` : ''}
                </span>
              ))}
            </Td>
            <Td>
              <RxStatus status={rx.status} />
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** One patient's prescriptions, found by patient number. */
function PatientPrescriptions({ mrn }: { mrn: string }) {
  const q = useApi<{
    patient: PatientIdentity;
    allergies: PharmacyAllergy[];
    prescriptions: PrescriptionView[];
  }>(`/api/pharmacy/patients/${encodeURIComponent(mrn)}`);
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="error">{q.error.message}</Alert>;
  const { patient, allergies, prescriptions } = q.data;
  const open = prescriptions.filter((p) => OPEN.includes(p.status));
  const past = prescriptions.filter((p) => !OPEN.includes(p.status));
  return (
    <div className="space-y-4">
      <PatientIdentityCard patient={patient}>
        <Badge tone={open.length > 0 ? 'warning' : 'neutral'}>{open.length} to dispense</Badge>
        {allergies.length > 0 && <Badge tone="danger">Allergies</Badge>}
      </PatientIdentityCard>
      {allergies.length > 0 && (
        <Alert tone="error">
          Active allergies:{' '}
          {allergies
            .map((a) => `${a.substance} (${a.severity}${a.reaction ? `, ${a.reaction}` : ''})`)
            .join('; ')}
        </Alert>
      )}
      <LookupSection title="To dispense" count={open.length}>
        <PrescriptionTable prescriptions={open} label="Prescriptions to dispense" />
      </LookupSection>
      <LookupSection title="Previous prescriptions" count={past.length}>
        <PrescriptionTable prescriptions={past} label="Previous prescriptions" />
      </LookupSection>
    </div>
  );
}
