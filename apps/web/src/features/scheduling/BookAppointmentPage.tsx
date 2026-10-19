import { hospitalToday, type AppointmentDetail, type PatientSummary } from '@hospitalos/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Select } from '../../components/ui/select';
import { ApiError } from '../../lib/api';
import { formatDate, formatRupees, formatTime } from '../../lib/format';
import { listDoctors } from '../doctors/doctors-api';
import { getPatient, patientKeys } from '../patients/patients-api';
import { PatientPicker, patientName } from '../patients/PatientPicker';
import { createAppointment, schedulingKeys } from './scheduling-api';
import { SlotPicker } from './SlotPicker';

export function BookAppointmentPage() {
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const today = hospitalToday();
  const presetPatientId = params.get('patientId');
  const [patient, setPatient] = useState<PatientSummary | null>(null);
  const [doctorId, setDoctorId] = useState(params.get('doctorId') ?? '');
  const [date, setDate] = useState(params.get('date') ?? today);
  const [slot, setSlot] = useState<string | null>(null);
  const [done, setDone] = useState<AppointmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preset = useQuery({
    queryKey: patientKeys.detail(presetPatientId ?? ''),
    queryFn: ({ signal }) => getPatient(presetPatientId!, signal),
    enabled: !!presetPatientId && !patient,
  });
  const chosen = patient ?? (presetPatientId && preset.data ? preset.data : null);
  const doctors = useQuery({ queryKey: ['doctors'], queryFn: ({ signal }) => listDoctors(signal) });
  const doctor = doctors.data?.find((d) => d.id === doctorId);

  const book = useMutation({
    mutationFn: (kind: 'scheduled' | 'walk_in') =>
      createAppointment(
        kind === 'walk_in'
          ? { kind, patientId: chosen!.id, doctorId }
          : { kind, patientId: chosen!.id, doctorId, slotStart: slot! },
      ),
    onSuccess: (a) => {
      setDone(a);
      setError(null);
      setSlot(null);
      void qc.invalidateQueries({ queryKey: schedulingKeys.all });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Booking failed. Please try again.');
      // A slot taken meanwhile: reload availability so it shows as unavailable.
      void qc.invalidateQueries({ queryKey: schedulingKeys.availability(doctorId, date) });
      setSlot(null);
    },
  });

  if (done) {
    return (
      <Card className="max-w-2xl space-y-4">
        <PageHeader title={done.kind === 'walk_in' ? 'Walk-in registered' : 'Appointment booked'} />
        <Alert tone="success">
          {done.appointmentNo}: {patientName(done.patient)} with {done.doctor.fullName}
          {done.slotStart
            ? ` on ${formatDate(done.visitDate)} at ${formatTime(done.slotStart)}.`
            : `, token ${done.tokenNo} in today's queue.`}
        </Alert>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to={`/appointments/${done.id}`}>Open appointment</Link>
          </Button>
          <Button variant="secondary" onClick={() => setDone(null)}>
            Book another
          </Button>
          <Button asChild variant="ghost">
            <Link to={`/appointments?date=${done.visitDate}`}>Day list</Link>
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="Book appointment"
        crumbs={[{ label: 'Appointments', to: '/appointments' }, { label: 'Book' }]}
      />
      <Card className="space-y-5">
        <section className="space-y-2">
          <h2 className="font-medium">1. Patient</h2>
          <PatientPicker value={chosen} onChange={setPatient} />
          {!chosen && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Not registered yet?{' '}
              <Link className="text-brand-700 underline" to="/patients/new">
                Register the patient
              </Link>{' '}
              first.
            </p>
          )}
        </section>
        <section className="space-y-3">
          <h2 className="font-medium">2. Doctor and day</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="book-doctor" label="Doctor" required>
              <Select
                value={doctorId}
                onChange={(e) => {
                  setDoctorId(e.target.value);
                  setSlot(null);
                }}
              >
                <option value="">Choose a doctor</option>
                {doctors.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.fullName} — {d.departmentName} ({d.specialty})
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="book-date" label="Date" required>
              <Input
                type="date"
                min={today}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setSlot(null);
                }}
              />
            </FormField>
          </div>
          {doctor && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Consultation fee {formatRupees(doctor.consultationFeePaise)} ·{' '}
              {doctor.defaultSlotMinutes}-minute slots
            </p>
          )}
        </section>
        {doctorId && (
          <section className="space-y-2">
            <h2 className="font-medium">3. Slot</h2>
            <SlotPicker
              doctorId={doctorId}
              date={date}
              value={slot}
              onChange={(s) => setSlot(s.slotStart)}
            />
          </section>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
          <Button
            variant="secondary"
            disabled={!chosen || !doctorId || book.isPending}
            onClick={() => book.mutate('walk_in')}
            title="Register the patient for today's queue without a slot"
          >
            Register walk-in (today)
          </Button>
          <Button
            disabled={!chosen || !doctorId || !slot || book.isPending}
            onClick={() => book.mutate('scheduled')}
          >
            {book.isPending ? 'Booking…' : 'Book slot'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
