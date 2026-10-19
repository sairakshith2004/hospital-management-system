import type { AppointmentKind, AppointmentStatus } from '@hospitalos/shared';
import { Badge, type BadgeTone } from '../../components/ui/badge';

const STATUS: Record<AppointmentStatus, [string, BadgeTone]> = {
  booked: ['Booked', 'info'],
  checked_in: ['Checked in', 'accent'],
  in_consultation: ['In consultation', 'warning'],
  completed: ['Completed', 'success'],
  cancelled: ['Cancelled', 'neutral'],
  no_show: ['No-show', 'danger'],
  rescheduled: ['Rescheduled', 'neutral'],
};

export const STATUS_LABELS = Object.fromEntries(
  Object.entries(STATUS).map(([k, [label]]) => [k, label]),
) as Record<AppointmentStatus, string>;

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const [label, tone] = STATUS[status];
  return <Badge tone={tone}>{label}</Badge>;
}

const KIND: Record<AppointmentKind, string> = {
  scheduled: 'Appointment',
  walk_in: 'Walk-in',
  follow_up: 'Follow-up',
};

export const kindLabel = (kind: AppointmentKind) => KIND[kind];
