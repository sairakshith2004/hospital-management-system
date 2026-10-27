/**
 * "Find by patient number" for department counters (pharmacy, lab, billing). The number
 * lives in the URL (?mrn=MRN000123), so a lookup survives a reload and Back returns to
 * the queue. Each department page shows its own records for the patient.
 */
import { normalizeMrn, type PatientIdentity } from '@hospitalos/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { ageInYears, sexLabel } from '../../lib/format';

/** The patient number being looked up, or null for the department's normal queue. */
export function useLookupMrn(): [string | null, (mrn: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const mrn = normalizeMrn(params.get('mrn') ?? '');
  const set = (next: string | null) =>
    setParams(
      (p) => {
        const copy = new URLSearchParams(p);
        if (next) copy.set('mrn', next);
        else copy.delete('mrn');
        return copy;
      },
      { replace: false },
    );
  return [mrn, set];
}

export function PatientNumberSearch({
  mrn,
  onSearch,
  id = 'patient-number',
}: {
  mrn: string | null;
  onSearch(mrn: string | null): void;
  id?: string;
}) {
  const [text, setText] = useState(mrn ?? '');
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = normalizeMrn(text);
    if (!next) {
      setError('Enter a patient number, for example MRN000123 or just 123.');
      return;
    }
    setError(null);
    setText(next);
    onSearch(next);
  };
  return (
    <form onSubmit={submit} role="search" aria-label="Find patient by number" className="space-y-1">
      <Label htmlFor={id}>Patient number</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={id}
          className="max-w-xs font-mono"
          autoComplete="off"
          placeholder="MRN000123"
          value={text}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit">Find</Button>
        {mrn && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setText('');
              setError(null);
              onSearch(null);
            }}
          >
            Back to queue
          </Button>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}

/** Who was found, with the department's summary beside the name. */
export function PatientIdentityCard({
  patient,
  children,
}: {
  patient: PatientIdentity;
  children?: ReactNode;
}) {
  return (
    <Card className="flex flex-wrap items-start justify-between gap-3 p-4">
      <div>
        <h2 className="text-lg font-semibold">
          {patient.firstName} {patient.lastName}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          <span className="font-mono">{patient.mrn}</span> · {ageInYears(patient.dob)} y /{' '}
          {sexLabel(patient.sex)}
        </p>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </Card>
  );
}

/** A titled section of the lookup result. */
export function LookupSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2" aria-label={title}>
      <h3 className="text-base font-semibold">
        {title} <span className="text-sm font-normal text-slate-500">({count})</span>
      </h3>
      {count === 0 ? <p className="text-sm text-slate-600 dark:text-slate-400">None.</p> : children}
    </section>
  );
}
