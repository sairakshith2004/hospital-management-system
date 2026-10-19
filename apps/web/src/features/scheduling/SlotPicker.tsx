import type { AvailabilitySlot } from '@hospitalos/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert } from '../../components/ui/alert';
import { EmptyState } from '../../components/ui/empty-state';
import { Spinner } from '../../components/ui/spinner';
import { formatTime } from '../../lib/format';
import { cn } from '../../lib/utils';
import { getAvailability, schedulingKeys } from './scheduling-api';

/** The doctor's slots on one day, from the API; only available slots can be chosen. */
export function SlotPicker({
  doctorId,
  date,
  value,
  onChange,
  ignoreSlotStart,
}: {
  doctorId: string;
  date: string;
  value: string | null;
  onChange(slot: AvailabilitySlot): void;
  /** Shown as "current" (the appointment being moved). */
  ignoreSlotStart?: string | null;
}) {
  const slots = useQuery({
    queryKey: schedulingKeys.availability(doctorId, date),
    queryFn: ({ signal }) => getAvailability(doctorId, date, signal),
    enabled: !!doctorId && !!date,
  });
  if (!doctorId || !date) return null;
  if (slots.isPending) return <Spinner label="Loading slots…" />;
  if (slots.isError)
    return <Alert tone="error">Couldn&apos;t load slots: {slots.error.message}</Alert>;
  if (slots.data.length === 0) {
    return (
      <EmptyState title="No sessions on this day">
        The doctor has no schedule for this date. Choose another day.
      </EmptyState>
    );
  }
  const free = slots.data.filter((s) => s.available).length;
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {free} of {slots.data.length} slots available
      </p>
      <div role="radiogroup" aria-label="Available slots" className="flex flex-wrap gap-2">
        {slots.data.map((s) => {
          const selected = value === s.slotStart;
          const current = ignoreSlotStart === s.slotStart;
          return (
            <button
              key={s.slotStart}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!s.available}
              onClick={() => onChange(s)}
              title={current ? 'Current slot' : s.available ? 'Available' : 'Not available'}
              className={cn(
                'h-9 min-w-16 rounded-md border px-2 text-sm tabular-nums',
                selected
                  ? 'border-brand-700 bg-brand-700 text-white'
                  : 'border-slate-300 bg-white hover:border-brand-500 dark:border-slate-600 dark:bg-slate-900',
                'disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:line-through',
                'dark:disabled:border-slate-800 dark:disabled:bg-slate-800',
                current && 'ring-2 ring-amber-400',
              )}
            >
              {formatTime(s.slotStart)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
