import { ATTENDANCE_STATUSES, hospitalToday } from '@hospitalos/shared';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Select } from '../../components/ui/select';
import { Spinner } from '../../components/ui/spinner';
import { Table, Td, Th } from '../../components/ui/table';
import { useAction, useApi } from '../../lib/use-api';
import { useAuth } from '../auth/auth-context';

interface Row {
  employeeId: string;
  employeeNo: string;
  fullName: string;
  department: string;
  id: string | null;
  status: string | null;
  checkIn: string | null;
  checkOut: string | null;
  onLeave: boolean;
}

export function AttendancePage() {
  const { can } = useAuth();
  const [date, setDate] = useState(hospitalToday());
  const q = useApi<{ rows: Row[] }>(`/api/hr/attendance?date=${date}`);
  const [edit, setEdit] = useState<
    Record<string, { status: string; checkIn: string; checkOut: string }>
  >({});
  const save = useAction<{
    employeeId: string;
    workDate: string;
    status: string;
    checkIn: string | null;
    checkOut: string | null;
  }>('POST', '/api/hr/attendance', {
    invalidate: ['/api/hr/attendance'],
    onSuccess: (_r, b) =>
      setEdit((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== b.employeeId))),
  });
  const marked = q.data?.rows.filter((r) => r.status).length ?? 0;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Attendance"
        description={q.data ? `${marked} of ${q.data.rows.length} staff marked` : undefined}
      />
      <div className="max-w-xs">
        <FormField id="att-date" label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
      </div>
      {save.error && <Alert tone="error">{save.error}</Alert>}
      {q.isPending && <Spinner />}
      {q.data && (
        <Table aria-label="Attendance">
          <thead>
            <tr>
              <Th>Staff</Th>
              <Th>Department</Th>
              <Th>Status</Th>
              <Th>In</Th>
              <Th>Out</Th>
              {can('attendance:manage') && <Th></Th>}
            </tr>
          </thead>
          <tbody>
            {q.data.rows.map((r) => {
              const e = edit[r.employeeId] ?? {
                status: r.status ?? (r.onLeave ? 'leave' : 'present'),
                checkIn: r.checkIn ?? '',
                checkOut: r.checkOut ?? '',
              };
              const set = (patch: Partial<typeof e>) =>
                setEdit({ ...edit, [r.employeeId]: { ...e, ...patch } });
              return (
                <tr key={r.employeeId}>
                  <Td>
                    {r.fullName}
                    <span className="block text-xs text-slate-500">{r.employeeNo}</span>
                    {r.onLeave && <Badge tone="info">Approved leave</Badge>}
                  </Td>
                  <Td>{r.department}</Td>
                  <Td>
                    {can('attendance:manage') ? (
                      <Select
                        aria-label={`Status of ${r.fullName}`}
                        className="h-8"
                        value={e.status}
                        onChange={(ev) => set({ status: ev.target.value })}
                      >
                        {ATTENDANCE_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s.replace('_', ' ')}
                          </option>
                        ))}
                      </Select>
                    ) : r.status ? (
                      <Badge>{r.status}</Badge>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>
                    {can('attendance:manage') ? (
                      <Input
                        aria-label="In"
                        type="time"
                        className="h-8"
                        value={e.checkIn}
                        onChange={(ev) => set({ checkIn: ev.target.value })}
                      />
                    ) : (
                      (r.checkIn ?? '—')
                    )}
                  </Td>
                  <Td>
                    {can('attendance:manage') ? (
                      <Input
                        aria-label="Out"
                        type="time"
                        className="h-8"
                        value={e.checkOut}
                        onChange={(ev) => set({ checkOut: ev.target.value })}
                      />
                    ) : (
                      (r.checkOut ?? '—')
                    )}
                  </Td>
                  {can('attendance:manage') && (
                    <Td>
                      <Button
                        size="sm"
                        variant={r.status ? 'ghost' : 'secondary'}
                        disabled={save.pending}
                        onClick={() =>
                          save.run({
                            employeeId: r.employeeId,
                            workDate: date,
                            status: e.status,
                            checkIn: e.checkIn || null,
                            checkOut: e.checkOut || null,
                          })
                        }
                      >
                        {r.status ? 'Update' : 'Mark'}
                      </Button>
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
