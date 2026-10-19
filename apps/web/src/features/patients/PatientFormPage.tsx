/**
 * Register a patient (/patients/new) or edit demographics (/patients/:id/edit). The shared
 * Zod schema checks the form first for quick feedback; the API checks again and is the
 * authority (its 422 field errors are shown on the same fields).
 */
import {
  BLOOD_GROUPS,
  SEXES,
  createPatientSchema,
  hospitalToday,
  type DuplicateCandidate,
  type Patient,
} from '@hospitalos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { NotFoundPage } from '../../app/NotFoundPage';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Spinner } from '../../components/ui/spinner';
import { Textarea } from '../../components/ui/textarea';
import { ApiError } from '../../lib/api';
import { sexLabel } from '../../lib/format';
import { createPatient, getPatient, patientKeys, updatePatient } from './patients-api';

type Values = {
  firstName: string;
  lastName: string;
  dob: string;
  sex: string;
  phone: string;
  email: string;
  address: string;
  bloodGroup: string;
};
type FieldErrors = Partial<Record<keyof Values, string>>;

const EMPTY: Values = {
  firstName: '',
  lastName: '',
  dob: '',
  sex: '',
  phone: '',
  email: '',
  address: '',
  bloodGroup: '',
};

function fromPatient(p: Patient): Values {
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    dob: p.dob,
    sex: p.sex,
    phone: p.phone,
    email: p.email ?? '',
    address: p.address ?? '',
    bloodGroup: p.bloodGroup ?? '',
  };
}

function errorsFrom(issues: { path: string; message: string }[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const field = issue.path.split('.')[0] as keyof Values;
    if (field in EMPTY && !errors[field]) errors[field] = issue.message;
  }
  return errors;
}

export function PatientFormPage() {
  const { id } = useParams();
  const editing = id !== undefined;
  const existing = useQuery({
    queryKey: patientKeys.detail(id ?? ''),
    queryFn: ({ signal }) => getPatient(id!, signal),
    enabled: editing,
  });

  if (editing && existing.isPending) return <Spinner label="Loading patient…" />;
  if (editing && existing.isError) {
    if (existing.error instanceof ApiError && existing.error.status === 404)
      return <NotFoundPage />;
    return <Alert tone="error">Couldn&apos;t load the patient: {existing.error.message}</Alert>;
  }
  return (
    <PatientForm
      key={existing.data?.version ?? 'new'}
      existing={existing.data}
      onReload={() => void existing.refetch()}
    />
  );
}

function PatientForm({ existing, onReload }: { existing?: Patient; onReload: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Values>(existing ? fromPatient(existing) : EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null);
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (field: keyof Values) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
    // A different phone or date of birth invalidates an earlier duplicate warning.
    if (field === 'phone' || field === 'dob') setDuplicates(null);
  };

  async function save(confirmDuplicate: boolean) {
    setFormError(null);
    const checked = createPatientSchema.safeParse({ ...values, confirmDuplicate });
    if (!checked.success) {
      setErrors(
        errorsFrom(
          checked.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        ),
      );
      return;
    }
    setSaving(true);
    try {
      const { confirmDuplicate: confirmed, ...fields } = checked.data;
      const patient = existing
        ? await updatePatient(existing.id, { ...fields, version: existing.version })
        : await createPatient({ ...fields, confirmDuplicate: confirmed });
      await queryClient.invalidateQueries({ queryKey: patientKeys.all });
      navigate(`/patients/${patient.id}`, { replace: true });
    } catch (err) {
      setSaving(false);
      if (!(err instanceof ApiError)) {
        setFormError('Saving failed. Please try again.');
      } else if (err.code === 'VALIDATION_FAILED' && err.details) {
        setErrors(errorsFrom(err.details));
      } else if (err.code === 'DUPLICATE_SUSPECTED') {
        setDuplicates((err.data?.candidates as DuplicateCandidate[] | undefined) ?? []);
      } else if (err.code === 'STALE_VERSION') {
        setStale(true);
      } else {
        setFormError(err.message);
      }
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!saving) void save(false);
  }

  const title = existing ? `Edit ${existing.firstName} ${existing.lastName}` : 'Register patient';
  return (
    <Card className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">{title}</h1>
      {existing && (
        <p className="font-mono text-sm text-slate-600 dark:text-slate-400">{existing.mrn}</p>
      )}
      {formError && <Alert tone="error">{formError}</Alert>}
      {stale && (
        <Alert tone="error">
          Someone else changed this patient while you were editing. Your changes were not saved.{' '}
          <Button variant="secondary" size="sm" onClick={onReload}>
            Reload latest
          </Button>
        </Alert>
      )}
      {duplicates && (
        <Alert tone="error">
          <p className="font-medium">
            A patient with this phone number and date of birth is already registered:
          </p>
          <ul className="my-2 list-disc pl-5">
            {duplicates.map((d) => (
              <li key={d.id}>
                <Link className="underline" to={`/patients/${d.id}`}>
                  {d.firstName} {d.lastName} ({d.mrn})
                </Link>
              </li>
            ))}
          </ul>
          <p>
            Open the existing record, or register a new patient anyway if this is a different
            person.
          </p>
          <Button
            className="mt-2"
            variant="secondary"
            size="sm"
            disabled={saving}
            onClick={() => void save(true)}
          >
            Register anyway
          </Button>
        </Alert>
      )}
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmit} noValidate>
        <FormField id="firstName" label="First name" error={errors.firstName} required>
          <Input
            autoComplete="off"
            value={values.firstName}
            onChange={(e) => set('firstName')(e.target.value)}
          />
        </FormField>
        <FormField id="lastName" label="Last name" error={errors.lastName} required>
          <Input
            autoComplete="off"
            value={values.lastName}
            onChange={(e) => set('lastName')(e.target.value)}
          />
        </FormField>
        <FormField id="dob" label="Date of birth" error={errors.dob} required>
          <Input
            type="date"
            max={hospitalToday()}
            value={values.dob}
            onChange={(e) => set('dob')(e.target.value)}
          />
        </FormField>
        <FormField id="sex" label="Sex" error={errors.sex} required>
          <Select value={values.sex} onChange={(e) => set('sex')(e.target.value)}>
            <option value="">Choose…</option>
            {SEXES.map((s) => (
              <option key={s} value={s}>
                {sexLabel(s)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="phone" label="Phone" error={errors.phone} hint="7–15 digits" required>
          <Input
            type="tel"
            autoComplete="off"
            value={values.phone}
            onChange={(e) => set('phone')(e.target.value)}
          />
        </FormField>
        <FormField id="email" label="Email" error={errors.email}>
          <Input
            type="email"
            autoComplete="off"
            value={values.email}
            onChange={(e) => set('email')(e.target.value)}
          />
        </FormField>
        <FormField id="bloodGroup" label="Blood group" error={errors.bloodGroup}>
          <Select value={values.bloodGroup} onChange={(e) => set('bloodGroup')(e.target.value)}>
            <option value="">Not recorded</option>
            {BLOOD_GROUPS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="sm:col-span-2">
          <FormField id="address" label="Address" error={errors.address}>
            <Textarea value={values.address} onChange={(e) => set('address')(e.target.value)} />
          </FormField>
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : existing ? 'Save changes' : 'Register patient'}
          </Button>
          <Button asChild variant="secondary">
            <Link to={existing ? `/patients/${existing.id}` : '/patients'}>Cancel</Link>
          </Button>
        </div>
      </form>
    </Card>
  );
}
