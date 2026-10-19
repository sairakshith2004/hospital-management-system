import {
  WEEKDAYS,
  type DoctorListItem,
  type DoctorSchedule,
  type StaffAccount,
} from '@hospitalos/shared';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { EmptyState } from '../../components/ui/empty-state';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { MoneyInput } from '../../components/ui/money-input';
import { PageHeader } from '../../components/ui/page-header';
import { Select } from '../../components/ui/select';
import { Table, Td, Th } from '../../components/ui/table';
import { formatDateTime, formatRupees } from '../../lib/format';
import { useAction, useApi } from '../../lib/use-api';
import { useAuth } from '../auth/auth-context';
import { hospitalToday } from '@hospitalos/shared';

const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Doctor profiles, weekly sessions, leave and fees. */
export function DoctorsAdminPage() {
  const { can } = useAuth();
  const doctors = useApi<{ doctors: DoctorListItem[] }>('/api/doctors');
  const [doctorId, setDoctorId] = useState('');
  const [adding, setAdding] = useState(false);
  const current = doctors.data?.doctors.find(
    (d) => d.id === (doctorId || doctors.data?.doctors[0]?.id),
  );
  return (
    <div className="space-y-4">
      <PageHeader
        title="Doctors and schedules"
        actions={
          can('schedule:manage') &&
          !adding && <Button onClick={() => setAdding(true)}>Add doctor profile</Button>
        }
      />
      {adding && <NewDoctor onClose={() => setAdding(false)} />}
      <div className="max-w-md">
        <FormField id="adm-doc" label="Doctor">
          <Select value={current?.id ?? ''} onChange={(e) => setDoctorId(e.target.value)}>
            {doctors.data?.doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fullName} — {d.departmentName}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      {doctors.data?.doctors.length === 0 && <EmptyState title="No doctors yet" />}
      {current && <DoctorDetail key={current.id} doctor={current} />}
    </div>
  );
}

function NewDoctor({ onClose }: { onClose(): void }) {
  const staff = useApi<{ staff: StaffAccount[] }>('/api/admin/staff');
  const [f, setF] = useState({
    employeeId: '',
    specialty: '',
    registrationNo: '',
    defaultSlotMinutes: '15',
  });
  const [fee, setFee] = useState<number | null>(null);
  const save = useAction('POST', '/api/admin/doctors', {
    invalidate: ['/api/doctors', 'doctors', '/api/admin/staff'],
    onSuccess: onClose,
  });
  const eligible =
    staff.data?.staff.filter((s) => !s.doctorProfileId && s.employmentStatus === 'active') ?? [];
  return (
    <Card className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-5">
        <FormField id="nd-emp" label="Employee" required hint="Must be in a clinical department">
          <Select value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>
            <option value="">Choose…</option>
            {eligible.map((s) => (
              <option key={s.employeeId} value={s.employeeId}>
                {s.fullName} ({s.department.name})
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="nd-spec" label="Specialty" required>
          <Input value={f.specialty} onChange={(e) => setF({ ...f, specialty: e.target.value })} />
        </FormField>
        <FormField id="nd-reg" label="Registration no." required>
          <Input
            value={f.registrationNo}
            onChange={(e) => setF({ ...f, registrationNo: e.target.value })}
          />
        </FormField>
        <FormField id="nd-slot" label="Slot minutes">
          <Input
            inputMode="numeric"
            value={f.defaultSlotMinutes}
            onChange={(e) => setF({ ...f, defaultSlotMinutes: e.target.value })}
          />
        </FormField>
        <FormField id="nd-fee" label="Consultation fee" required>
          <MoneyInput valuePaise={fee} onChange={setFee} />
        </FormField>
      </div>
      {save.error && <Alert tone="error">{save.error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={
            !f.employeeId || !f.specialty || !f.registrationNo || fee === null || save.pending
          }
          onClick={() =>
            save.run({
              ...f,
              defaultSlotMinutes: Number(f.defaultSlotMinutes),
              consultationFeePaise: fee,
            })
          }
        >
          Save
        </Button>
      </div>
    </Card>
  );
}

function DoctorDetail({ doctor }: { doctor: DoctorListItem }) {
  const { can } = useAuth();
  const schedules = useApi<{ schedules: DoctorSchedule[] }>(`/api/doctors/${doctor.id}/schedules`);
  const exceptions = useApi<{
    exceptions: {
      id: string;
      kind: string;
      startsAt: string;
      endsAt: string;
      reason: string | null;
    }[];
  }>(`/api/doctors/${doctor.id}/exceptions`);
  const [s, setS] = useState({
    weekday: '1',
    startTime: '09:00',
    endTime: '13:00',
    slotMinutes: String(doctor.defaultSlotMinutes),
    validFrom: hospitalToday(),
  });
  const [x, setX] = useState({ kind: 'leave', from: '', to: '', reason: '' });
  const [fee, setFee] = useState<number | null>(doctor.consultationFeePaise);
  const [feeOpen, setFeeOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const reload = [`/api/doctors/${doctor.id}`, '/api/doctors', 'scheduling'];
  const addSession = useAction('POST', `/api/doctors/${doctor.id}/schedules`, {
    invalidate: reload,
  });
  const endSession = useAction<{ id: string }>(
    'PATCH',
    (b) => `/api/doctors/${doctor.id}/schedules/${b.id}`,
    { invalidate: reload },
  );
  const addLeave = useAction<object, { affectedBookings: number }>(
    'POST',
    `/api/doctors/${doctor.id}/exceptions`,
    {
      invalidate: reload,
      onSuccess: (r) =>
        setNotice(
          r.affectedBookings
            ? `Saved. ${r.affectedBookings} existing booking(s) fall in this period: please contact those patients.`
            : 'Saved.',
        ),
    },
  );
  const removeLeave = useAction<{ id: string }>(
    'POST',
    (b) => `/api/schedule-exceptions/${b.id}/remove`,
    { invalidate: reload },
  );
  const changeFee = useAction<{ consultationFeePaise: number | null; reason: string }>(
    'POST',
    `/api/admin/doctors/${doctor.id}/fee`,
    {
      invalidate: ['/api/doctors', 'doctors'],
      onSuccess: () => setFeeOpen(false),
    },
  );
  const toIso = (local: string) => `${local}:00+05:30`;
  const err = addSession.error ?? endSession.error ?? addLeave.error ?? removeLeave.error;
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          {doctor.specialty} · {doctor.defaultSlotMinutes}-minute slots · fee{' '}
          {formatRupees(doctor.consultationFeePaise)}
        </p>
        {can('fee:manage') && (
          <Button variant="secondary" size="sm" onClick={() => setFeeOpen(true)}>
            Change fee
          </Button>
        )}
      </Card>
      {notice && <Alert tone="success">{notice}</Alert>}
      {err && <Alert tone="error">{err}</Alert>}
      <Card className="space-y-3">
        <h2 className="font-semibold">Weekly sessions</h2>
        {schedules.data && schedules.data.schedules.length === 0 && (
          <EmptyState title="No sessions: this doctor can't be booked yet" />
        )}
        {schedules.data && schedules.data.schedules.length > 0 && (
          <Table aria-label="Sessions">
            <thead>
              <tr>
                <Th>Day</Th>
                <Th>Time</Th>
                <Th>Slot</Th>
                <Th>Valid</Th>
                <Th>Status</Th>
                {can('schedule:manage') && <Th></Th>}
              </tr>
            </thead>
            <tbody>
              {schedules.data.schedules.map((x2) => (
                <tr key={x2.id}>
                  <Td>{DAY[x2.weekday]}</Td>
                  <Td>
                    {x2.startTime}–{x2.endTime}
                  </Td>
                  <Td>{x2.slotMinutes} min</Td>
                  <Td className="text-xs">
                    {x2.validFrom} → {x2.validTo ?? 'open'}
                  </Td>
                  <Td>
                    <Badge tone={x2.active ? 'success' : 'neutral'}>
                      {x2.active ? 'Active' : 'Ended'}
                    </Badge>
                  </Td>
                  {can('schedule:manage') && (
                    <Td>
                      {x2.active && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => endSession.run({ id: x2.id })}
                        >
                          End
                        </Button>
                      )}
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {can('schedule:manage') && (
          <form
            className="grid gap-2 sm:grid-cols-6 sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              addSession.run({
                weekday: Number(s.weekday),
                startTime: s.startTime,
                endTime: s.endTime,
                slotMinutes: Number(s.slotMinutes),
                validFrom: s.validFrom,
              });
            }}
          >
            <FormField id="ss-day" label="Day">
              <Select value={s.weekday} onChange={(e) => setS({ ...s, weekday: e.target.value })}>
                {WEEKDAYS.map((w) => (
                  <option key={w} value={w}>
                    {DAY[w]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="ss-start" label="From">
              <Input
                type="time"
                value={s.startTime}
                onChange={(e) => setS({ ...s, startTime: e.target.value })}
              />
            </FormField>
            <FormField id="ss-end" label="To">
              <Input
                type="time"
                value={s.endTime}
                onChange={(e) => setS({ ...s, endTime: e.target.value })}
              />
            </FormField>
            <FormField id="ss-slot" label="Slot min">
              <Input
                inputMode="numeric"
                value={s.slotMinutes}
                onChange={(e) => setS({ ...s, slotMinutes: e.target.value })}
              />
            </FormField>
            <FormField id="ss-from" label="Valid from">
              <Input
                type="date"
                value={s.validFrom}
                onChange={(e) => setS({ ...s, validFrom: e.target.value })}
              />
            </FormField>
            <Button type="submit" disabled={addSession.pending}>
              Add session
            </Button>
          </form>
        )}
      </Card>
      <Card className="space-y-3">
        <h2 className="font-semibold">Leave and blocked time</h2>
        {exceptions.data && exceptions.data.exceptions.length === 0 && (
          <p className="text-sm text-slate-600">None upcoming.</p>
        )}
        <ul className="space-y-1 text-sm">
          {exceptions.data?.exceptions.map((e) => (
            <li key={e.id} className="flex items-center gap-2">
              <Badge tone="warning">{e.kind}</Badge> {formatDateTime(e.startsAt)} →{' '}
              {formatDateTime(e.endsAt)} {e.reason && `· ${e.reason}`}
              {can('schedule:manage') && (
                <Button size="sm" variant="ghost" onClick={() => removeLeave.run({ id: e.id })}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
        {can('schedule:manage') && (
          <form
            className="grid gap-2 sm:grid-cols-5 sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              addLeave.run({
                kind: x.kind,
                startsAt: toIso(x.from),
                endsAt: toIso(x.to),
                reason: x.reason,
              });
            }}
          >
            <FormField id="ex-kind" label="Type">
              <Select value={x.kind} onChange={(e) => setX({ ...x, kind: e.target.value })}>
                <option value="leave">Leave</option>
                <option value="blocked">Blocked</option>
              </Select>
            </FormField>
            <FormField id="ex-from" label="From">
              <Input
                type="datetime-local"
                value={x.from}
                onChange={(e) => setX({ ...x, from: e.target.value })}
              />
            </FormField>
            <FormField id="ex-to" label="To">
              <Input
                type="datetime-local"
                value={x.to}
                onChange={(e) => setX({ ...x, to: e.target.value })}
              />
            </FormField>
            <FormField id="ex-reason" label="Reason">
              <Input value={x.reason} onChange={(e) => setX({ ...x, reason: e.target.value })} />
            </FormField>
            <Button type="submit" disabled={!x.from || !x.to || addLeave.pending}>
              Add
            </Button>
          </form>
        )}
      </Card>
      <ConfirmDialog
        open={feeOpen}
        onOpenChange={setFeeOpen}
        title="Change consultation fee"
        description="Applies to future check-ins; existing invoices keep their fee."
        confirmLabel="Save fee"
        reasonLabel="Reason"
        pending={changeFee.pending}
        error={changeFee.error}
        onConfirm={(reason) => changeFee.run({ consultationFeePaise: fee, reason })}
      >
        <MoneyInput valuePaise={fee} onChange={setFee} />
      </ConfirmDialog>
    </div>
  );
}
