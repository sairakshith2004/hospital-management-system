import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Card } from '../../components/ui/card';
import { Label } from '../../components/ui/label';
import { Select } from '../../components/ui/select';
import { Spinner } from '../../components/ui/spinner';
import { formatRupees } from '../../lib/format';
import { listDoctors } from './doctors-api';

export function DoctorDirectoryPage() {
  const doctors = useQuery({ queryKey: ['doctors'], queryFn: ({ signal }) => listDoctors(signal) });
  const [department, setDepartment] = useState('');

  if (doctors.isPending) return <Spinner label="Loading doctors…" />;
  if (doctors.isError)
    return <Alert tone="error">Couldn&apos;t load doctors: {doctors.error.message}</Alert>;

  const departments = [...new Map(doctors.data.map((d) => [d.departmentId, d.departmentName]))];
  const shown = doctors.data.filter((d) => !department || d.departmentId === department);
  const groups = departments.filter(([id]) => !department || id === department);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Doctors</h1>
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="department-filter">Department</Label>
        <Select
          id="department-filter"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
        >
          <option value="">All departments</option>
          {departments.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
      </div>
      {shown.length === 0 && (
        <p role="status" className="text-sm text-slate-600 dark:text-slate-400">
          No doctors are listed yet.
        </p>
      )}
      {groups.map(([id, name]) => (
        <section key={id} aria-labelledby={`dept-${id}`} className="space-y-2">
          <h2 id={`dept-${id}`} className="font-medium">
            {name}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {shown
              .filter((d) => d.departmentId === id)
              .map((d) => (
                <li key={d.id}>
                  <Card className="space-y-1 p-4">
                    <p className="font-medium">{d.fullName}</p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">{d.specialty}</p>
                    <p className="text-sm">
                      Consultation {formatRupees(d.consultationFeePaise)} · {d.defaultSlotMinutes}
                      -minute slots
                    </p>
                  </Card>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
