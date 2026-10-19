import type { PatientSummary } from '@hospitalos/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Spinner } from '../../components/ui/spinner';
import { ageInYears, sexLabel } from '../../lib/format';
import { patientKeys, searchPatients } from './patients-api';

export function patientName(p: { firstName: string; lastName: string }) {
  return `${p.firstName} ${p.lastName}`;
}

/** Search by name, phone or MRN and choose one patient. */
export function PatientPicker({
  value,
  onChange,
  id = 'patient-picker',
}: {
  value: PatientSummary | null;
  onChange(p: PatientSummary | null): void;
  id?: string;
}) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const results = useQuery({
    queryKey: patientKeys.search(q),
    queryFn: ({ signal }) => searchPatients(q, signal),
    enabled: q.length >= 2 && !value,
  });

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-brand-300 bg-brand-50 px-3 py-2 text-sm dark:border-brand-800 dark:bg-brand-950">
        <span>
          <span className="font-medium">{patientName(value)}</span>{' '}
          <span className="font-mono text-xs">{value.mrn}</span> · {ageInYears(value.dob)} y /{' '}
          {sexLabel(value.sex)} · {value.phone}
        </span>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Patient (name, phone or MRN)</Label>
      <Input
        id={id}
        type="search"
        autoComplete="off"
        value={text}
        placeholder="Type at least 2 characters"
        onChange={(e) => setText(e.target.value)}
      />
      {q.length >= 2 && results.isPending && <Spinner label="Searching…" />}
      {results.isError && <p className="text-sm text-red-700">{results.error.message}</p>}
      {results.isSuccess && results.data.length === 0 && (
        <p role="status" className="text-sm text-slate-600 dark:text-slate-400">
          No patients match “{q}”.
        </p>
      )}
      {results.isSuccess && results.data.length > 0 && (
        <ul
          aria-label="Matching patients"
          className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700"
        >
          {results.data.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                onClick={() => onChange(p)}
              >
                <span className="font-medium">{patientName(p)}</span>{' '}
                <span className="font-mono text-xs">{p.mrn}</span> · {ageInYears(p.dob)} y /{' '}
                {sexLabel(p.sex)} · {p.phone}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
