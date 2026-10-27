import { AVAILABILITY_LABELS, ROLE_NAMES, type RoleCode } from '@hospitalos/shared';
import { useState } from 'react';
import { Badge, type BadgeTone } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Spinner } from '../../components/ui/spinner';
import { useApi } from '../../lib/use-api';
import { cn } from '../../lib/utils';
import { COMM, type StaffMember } from './comm-api';

export const AVAILABILITY_TONES: Record<string, BadgeTone> = {
  available: 'success',
  busy: 'warning',
  off_duty: 'neutral',
};

/** Search active staff and pick one (or several). Doctors are listed first. */
export function StaffPicker({
  onPick,
  selected = [],
  doctorsOnly = false,
  label = 'Search staff',
}: {
  onPick(member: StaffMember): void;
  selected?: string[];
  doctorsOnly?: boolean;
  label?: string;
}) {
  const [q, setQ] = useState('');
  const path = `${COMM}/staff${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`;
  const { data, isLoading } = useApi<{ staff: StaffMember[] }>(path);
  const staff = (data?.staff ?? []).filter((s) => !doctorsOnly || s.isDoctor);
  return (
    <div className="space-y-2">
      <Input
        aria-label={label}
        placeholder={doctorsOnly ? 'Search doctors or specialty…' : 'Search by name or department…'}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
        {isLoading && (
          <li className="p-3">
            <Spinner />
          </li>
        )}
        {!isLoading && staff.length === 0 && (
          <li className="p-3 text-sm text-slate-500">No one matches.</li>
        )}
        {staff.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onPick(s)}
              className={cn(
                'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-sky-50 dark:hover:bg-slate-800',
                selected.includes(s.id) && 'bg-sky-50 dark:bg-slate-800',
              )}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {s.isDoctor ? 'Dr. ' : ''}
                  {s.fullName}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  {s.specialty ??
                    (s.roles.map((r) => ROLE_NAMES[r as RoleCode] ?? r).join(', ') ||
                      s.designation)}{' '}
                  · {s.department}
                </span>
              </span>
              {selected.includes(s.id) ? (
                <Badge tone="accent">Added</Badge>
              ) : (
                s.availability && (
                  <Badge tone={AVAILABILITY_TONES[s.availability]}>
                    {AVAILABILITY_LABELS[s.availability]}
                  </Badge>
                )
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
