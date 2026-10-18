import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { NotFoundPage } from '../../app/NotFoundPage';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Spinner } from '../../components/ui/spinner';
import { ApiError } from '../../lib/api';
import { ageInYears, sexLabel } from '../../lib/format';
import { useAuth } from '../auth/auth-context';
import { getPatient, patientKeys } from './patients-api';

export function PatientDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const patient = useQuery({
    queryKey: patientKeys.detail(id),
    queryFn: ({ signal }) => getPatient(id, signal),
  });

  if (patient.isPending) return <Spinner label="Loading patient…" />;
  if (patient.isError) {
    if (patient.error instanceof ApiError && patient.error.status === 404) return <NotFoundPage />;
    return <Alert tone="error">Couldn&apos;t load the patient: {patient.error.message}</Alert>;
  }
  const p = patient.data;
  const rows: [string, string][] = [
    ['MRN', p.mrn],
    ['Date of birth', `${p.dob} (${ageInYears(p.dob)} years)`],
    ['Sex', sexLabel(p.sex)],
    ['Phone', p.phone],
    ['Email', p.email ?? '—'],
    ['Address', p.address ?? '—'],
    ['Blood group', p.bloodGroup ?? '—'],
  ];
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-xl font-semibold">
          {p.firstName} {p.lastName}
        </h1>
        <div className="flex gap-2">
          <Button asChild variant="secondary">
            <Link to="/patients">Back to search</Link>
          </Button>
          {can('appointment:book') && (
            <Button asChild variant="secondary">
              <Link to={`/appointments/new?patientId=${p.id}`}>Book appointment</Link>
            </Button>
          )}
          {can('patient:update_demographics') && (
            <Button asChild>
              <Link to={`/patients/${p.id}/edit`}>Edit</Link>
            </Button>
          )}
        </div>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
            <dd className={label === 'MRN' ? 'font-mono' : undefined}>{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
