import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Spinner } from '../../components/ui/spinner';
import { Table, Td, Th } from '../../components/ui/table';
import { ageInYears, sexLabel } from '../../lib/format';
import { useAuth } from '../auth/auth-context';
import { patientKeys, searchPatients } from './patients-api';

/** Waits until typing pauses, so each keystroke doesn't send a request. */
function useDebounced(value: string, ms = 300): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export function PatientSearchPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const q = useDebounced(text.trim());
  const ready = q.length >= 2;

  useEffect(() => {
    setParams(q ? { q } : {}, { replace: true });
  }, [q, setParams]);

  const results = useQuery({
    queryKey: patientKeys.search(q),
    queryFn: ({ signal }) => searchPatients(q, signal),
    enabled: ready,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Patients</h1>
        {can('patient:create') && (
          <Button asChild>
            <Link to="/patients/new">Register patient</Link>
          </Button>
        )}
      </div>
      <div className="max-w-xl space-y-1.5">
        <Label htmlFor="patient-search">Search by name, phone number or MRN</Label>
        <Input
          id="patient-search"
          type="search"
          autoComplete="off"
          placeholder="e.g. Agarwal, 9000000001 or MRN000001"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      {!ready && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Type at least 2 characters to search.
        </p>
      )}
      {ready && results.isPending && <Spinner label="Searching…" />}
      {ready && results.isError && (
        <Alert tone="error">Search failed: {results.error.message}</Alert>
      )}
      {ready && results.isSuccess && results.data.length === 0 && (
        <p role="status" className="text-sm text-slate-600 dark:text-slate-400">
          No patients match “{q}”.
        </p>
      )}
      {ready && results.isSuccess && results.data.length > 0 && (
        <Table aria-label="Search results">
          <thead>
            <tr>
              <Th>MRN</Th>
              <Th>Name</Th>
              <Th>Age / sex</Th>
              <Th>Phone</Th>
            </tr>
          </thead>
          <tbody>
            {results.data.map((p) => (
              <tr key={p.id}>
                <Td className="font-mono">{p.mrn}</Td>
                <Td>
                  <Link
                    className="text-teal-700 hover:underline dark:text-teal-400"
                    to={`/patients/${p.id}`}
                  >
                    {p.firstName} {p.lastName}
                  </Link>
                </Td>
                <Td>
                  {ageInYears(p.dob)} y / {sexLabel(p.sex)}
                </Td>
                <Td>{p.phone}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
