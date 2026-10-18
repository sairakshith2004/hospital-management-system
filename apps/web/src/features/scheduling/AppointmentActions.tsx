import { hospitalToday, type AppointmentSummary } from '@hospitalos/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { ApiError } from '../../lib/api';
import { formatTime } from '../../lib/format';
import { useAuth } from '../auth/auth-context';
import {
  cancelAppointment,
  checkIn,
  markNoShow,
  rescheduleAppointment,
  schedulingKeys,
} from './scheduling-api';
import { SlotPicker } from './SlotPicker';

type Dialogs = 'cancel' | 'noShow' | 'reschedule' | null;

/** The status changes the signed-in user may make on one appointment, right now. */
export function AppointmentActions({
  appointment: a,
  onDone,
  size = 'sm',
}: {
  appointment: AppointmentSummary;
  onDone?(message: string): void;
  size?: 'sm' | 'md';
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState<Dialogs>(null);
  const [reason, setReason] = useState('');
  const [newDate, setNewDate] = useState(a.visitDate);
  const [newSlot, setNewSlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = hospitalToday();

  const mutation = useMutation({
    mutationFn: async (kind: 'checkIn' | 'cancel' | 'noShow' | 'reschedule') => {
      if (kind === 'checkIn') return [kind, await checkIn(a.id)] as const;
      if (kind === 'noShow') return [kind, await markNoShow(a.id)] as const;
      if (kind === 'cancel') return [kind, await cancelAppointment(a.id, reason)] as const;
      return [kind, await rescheduleAppointment(a.id, newSlot!)] as const;
    },
    onSuccess: ([kind, result]) => {
      void qc.invalidateQueries({ queryKey: schedulingKeys.all });
      setOpen(null);
      setError(null);
      const who = `${a.patient.firstName} ${a.patient.lastName}`;
      onDone?.(
        kind === 'checkIn'
          ? `${who} checked in with token ${result.tokenNo}.`
          : kind === 'cancel'
            ? `${who}'s appointment was cancelled.`
            : kind === 'noShow'
              ? `${who} was marked as a no-show.`
              : `${who}'s appointment moved to ${result.visitDate} ${result.slotStart ? formatTime(result.slotStart) : ''}.`,
      );
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Something went wrong.'),
  });

  const canCheckIn = can('appointment:check_in') && a.status === 'booked' && a.visitDate === today;
  const canCancel =
    can('appointment:cancel') && (a.status === 'booked' || a.status === 'checked_in');
  const canNoShow =
    can('appointment:mark_no_show') && a.status === 'booked' && a.visitDate <= today;
  const canReschedule =
    can('appointment:reschedule') && a.status === 'booked' && a.kind !== 'walk_in';
  if (!canCheckIn && !canCancel && !canNoShow && !canReschedule) return null;

  const close = () => {
    setOpen(null);
    setError(null);
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {error && !open && (
        <Alert tone="error" className="w-full py-1">
          {error}
        </Alert>
      )}
      {canCheckIn && (
        <Button
          size={size}
          disabled={mutation.isPending}
          onClick={() => mutation.mutate('checkIn')}
        >
          Check in
        </Button>
      )}
      {canReschedule && (
        <Button size={size} variant="secondary" onClick={() => setOpen('reschedule')}>
          Reschedule
        </Button>
      )}
      {canNoShow && (
        <Button size={size} variant="secondary" onClick={() => setOpen('noShow')}>
          No-show
        </Button>
      )}
      {canCancel && (
        <Button size={size} variant="ghost" onClick={() => setOpen('cancel')}>
          Cancel
        </Button>
      )}

      <Dialog
        open={open === 'cancel'}
        onOpenChange={(o) => !o && close()}
        title="Cancel appointment"
        description={`${a.appointmentNo} · ${a.patient.firstName} ${a.patient.lastName} with ${a.doctor.fullName}`}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate('cancel');
          }}
        >
          <FormField id={`reason-${a.id}`} label="Reason" required hint="Up to 200 characters.">
            <Textarea maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              Keep appointment
            </Button>
            <Button type="submit" disabled={!reason.trim() || mutation.isPending}>
              {mutation.isPending ? 'Cancelling…' : 'Cancel appointment'}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={open === 'noShow'}
        onOpenChange={(o) => !o && close()}
        title="Mark as no-show?"
        description={`${a.patient.firstName} ${a.patient.lastName} did not arrive for ${a.appointmentNo}. This can't be undone.`}
      >
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            Go back
          </Button>
          <Button disabled={mutation.isPending} onClick={() => mutation.mutate('noShow')}>
            Mark no-show
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={open === 'reschedule'}
        onOpenChange={(o) => !o && close()}
        title="Reschedule appointment"
        description={`Choose a new slot with ${a.doctor.fullName}. The current booking stays until the new one is confirmed.`}
        className="max-w-2xl"
      >
        <FormField id={`date-${a.id}`} label="Date">
          <Input
            type="date"
            min={today}
            value={newDate}
            onChange={(e) => {
              setNewDate(e.target.value);
              setNewSlot(null);
            }}
          />
        </FormField>
        <SlotPicker
          doctorId={a.doctor.id}
          date={newDate}
          value={newSlot}
          onChange={(s) => setNewSlot(s.slotStart)}
          ignoreSlotStart={a.slotStart}
        />
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            Go back
          </Button>
          <Button
            disabled={!newSlot || mutation.isPending}
            onClick={() => mutation.mutate('reschedule')}
          >
            {mutation.isPending ? 'Moving…' : 'Confirm new slot'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
