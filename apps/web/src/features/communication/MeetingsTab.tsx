import {
  MAX_IN_MEETING,
  MEETING_INVITE_ROLES,
  MEETING_JOIN_EARLY_MINUTES,
  ROLE_NAMES,
  STAFF_HEAD_ROLES,
  type MeetingKind,
} from '@hospitalos/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Input } from '../../components/ui/input';
import { Spinner } from '../../components/ui/spinner';
import { formatDateTime, formatTime } from '../../lib/format';
import { useAction, useApi } from '../../lib/use-api';
import { cn } from '../../lib/utils';
import { useAuth } from '../auth/auth-context';
import { COMM, type Meeting, type StaffMember } from './comm-api';
import { askForAlerts, canAskForAlerts } from './desktop-alerts';
import { StaffPicker } from './StaffPicker';

const ROLE_GROUP_LABELS: Record<(typeof MEETING_INVITE_ROLES)[number], string> = {
  DOC: 'All doctors',
  NUR: 'All nurses',
  HR: 'HR',
  ADM: 'Administration',
  SA: ROLE_NAMES.SA,
};

export function MeetingsTab({ onJoin }: { onJoin(id: string): void }) {
  const { can } = useAuth();
  const [starting, setStarting] = useState<MeetingKind | null>(null);
  const [booked, setBooked] = useState(false);
  const [askAlerts, setAskAlerts] = useState(canAskForAlerts);
  const { data, isLoading } = useApi<{ meetings: Meeting[]; maxInCall?: number }>(
    `${COMM}/meetings`,
  );

  if (starting)
    return (
      <StartMeeting
        kind={starting}
        maxInCall={data?.maxInCall ?? MAX_IN_MEETING}
        onCancel={() => setStarting(null)}
        onStarted={onJoin}
        onScheduled={() => {
          setStarting(null);
          setBooked(true);
        }}
      />
    );

  const active = data?.meetings.filter((m) => m.status === 'active') ?? [];
  const upcoming = data?.meetings.filter((m) => m.status === 'scheduled') ?? [];
  const ended = data?.meetings.filter((m) => m.status === 'ended') ?? [];
  return (
    <div className="h-full space-y-4 overflow-y-auto p-3">
      {askAlerts && (
        <Alert tone="info" className="space-y-2">
          <p>Get meeting and emergency alerts even when HospitalOS is in a background tab.</p>
          <Button size="sm" onClick={() => void askForAlerts().finally(() => setAskAlerts(false))}>
            Turn on alerts
          </Button>
        </Alert>
      )}
      {can('meeting:create') && (
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => setStarting('standard')}>📹 New meeting</Button>
          <Button
            className="bg-red-600 shadow-red-200 hover:bg-red-700"
            onClick={() => setStarting('emergency')}
          >
            🚨 Emergency meeting
          </Button>
        </div>
      )}
      {booked && (
        <Alert tone="success">
          Meeting booked. Everyone invited sees it under Upcoming and is reminded when it opens.
        </Alert>
      )}
      {upcoming.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Upcoming</h3>
          {upcoming.map((m) => (
            <MeetingCard key={m.id} meeting={m}>
              <UpcomingActions meeting={m} onJoin={onJoin} />
            </MeetingCard>
          ))}
        </section>
      )}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Live now</h3>
        {isLoading && <Spinner />}
        {!isLoading && active.length === 0 && (
          <p className="text-sm text-slate-500">
            No live meetings. You can also video-call from any chat with{' '}
            <strong>📹 Video call</strong>.
          </p>
        )}
        {active.map((m) => (
          <MeetingCard key={m.id} meeting={m}>
            <Button
              size="sm"
              onClick={() => onJoin(m.id)}
              className={cn(m.kind === 'emergency' && 'bg-red-600 hover:bg-red-700')}
            >
              {m.present ? 'Return to meeting' : 'Join'}
            </Button>
          </MeetingCard>
        ))}
      </section>
      {ended.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Earlier today</h3>
          {ended.map((m) => (
            <MeetingCard key={m.id} meeting={m} />
          ))}
        </section>
      )}
    </div>
  );
}

function MeetingCard({ meeting: m, children }: { meeting: Meeting; children?: ReactNode }) {
  const inCall = m.participants.filter((p) => p.present);
  return (
    <div
      className={cn(
        'space-y-1.5 rounded-lg border p-3 text-sm',
        m.kind === 'emergency' && m.status === 'active'
          ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30'
          : 'border-slate-200 dark:border-slate-700',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{m.title}</span>
        {m.kind === 'emergency' && <Badge tone="danger">Emergency</Badge>}
      </div>
      <p className="text-xs text-slate-500">
        {m.status === 'scheduled' && m.scheduledFor
          ? `Booked by ${m.hostName} for ${formatDateTime(m.scheduledFor)} · ${m.participants.length} invited`
          : `${m.scheduledFor ? 'Booked' : 'Started'} by ${m.hostName}${
              m.scheduledFor
                ? ` for ${formatDateTime(m.scheduledFor)}`
                : ` at ${formatTime(m.createdAt)}`
            }`}
        {m.endedAt && ` · ended ${formatDateTime(m.endedAt)}`}
        {m.status === 'active' && ` · ${inCall.length} in call of ${m.participants.length} invited`}
      </p>
      {m.status === 'active' && inCall.length > 0 && (
        <p className="text-xs text-slate-600 dark:text-slate-300">
          In call: {inCall.map((p) => p.fullName).join(', ')}
        </p>
      )}
      {children}
    </div>
  );
}

/** Join (from MEETING_JOIN_EARLY_MINUTES before the time) or, for the host, cancel. */
function UpcomingActions({ meeting: m, onJoin }: { meeting: Meeting; onJoin(id: string): void }) {
  const [confirm, setConfirm] = useState(false);
  const cancel = useAction<object>('POST', `${COMM}/meetings/${m.id}/end`, {
    invalidate: [`${COMM}/meetings`],
    onSuccess: () => setConfirm(false),
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={!m.canJoin} onClick={() => onJoin(m.id)}>
        {m.canJoin ? 'Start / join' : 'Join'}
      </Button>
      {!m.canJoin && (
        <span className="text-xs text-slate-500">
          Opens {MEETING_JOIN_EARLY_MINUTES} min before the start
        </span>
      )}
      {m.isHost && (
        <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
          Cancel meeting
        </Button>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Cancel this meeting?"
        description="Everyone invited will see it as ended."
        confirmLabel="Cancel meeting"
        onConfirm={() => cancel.run({})}
        pending={cancel.pending}
        error={cancel.error}
      />
    </div>
  );
}

/** datetime-local value (the browser's local time) → ISO instant, or null if empty/invalid. */
function toInstant(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function StartMeeting({
  kind,
  maxInCall,
  onCancel,
  onStarted,
  onScheduled,
}: {
  kind: MeetingKind;
  maxInCall: number;
  onCancel(): void;
  onStarted(id: string): void;
  onScheduled(): void;
}) {
  const [title, setTitle] = useState(kind === 'emergency' ? 'Emergency case discussion' : '');
  const [roles, setRoles] = useState<string[]>(kind === 'emergency' ? ['DOC'] : []);
  const [people, setPeople] = useState<StaffMember[]>([]);
  const [later, setLater] = useState(false);
  const [when, setWhen] = useState('');
  const scheduledFor = later ? toInstant(when) : null;
  const start = useAction<object, { id: string }>('POST', `${COMM}/meetings`, {
    invalidate: [`${COMM}/meetings`],
    onSuccess: (res) => (scheduledFor ? onScheduled() : onStarted(res.id)),
  });
  const headsOn = STAFF_HEAD_ROLES.every((r) => roles.includes(r));
  const toggleHeads = () =>
    setRoles((cur) =>
      headsOn
        ? cur.filter((r) => !(STAFF_HEAD_ROLES as readonly string[]).includes(r))
        : [...new Set([...cur, ...STAFF_HEAD_ROLES])],
    );

  function togglePerson(s: StaffMember) {
    setPeople((p) => (p.some((x) => x.id === s.id) ? p.filter((x) => x.id !== s.id) : [...p, s]));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    start.run({
      title,
      kind,
      inviteRoles: roles,
      inviteeIds: people.map((p) => p.id),
      ...(scheduledFor ? { scheduledFor } : {}),
    });
  }

  const emergency = kind === 'emergency';
  return (
    <form onSubmit={onSubmit} className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="flex items-center justify-between">
        <p className={cn('text-sm font-semibold', emergency && 'text-red-700 dark:text-red-300')}>
          {emergency ? '🚨 Emergency meeting' : '📹 New meeting'}
        </p>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {emergency && (
        <Alert tone="error">
          Everyone invited gets a full-screen ringing alert until they join or dismiss it.
        </Alert>
      )}
      <Input
        aria-label="Meeting title"
        placeholder="What is this meeting about?"
        maxLength={120}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium text-slate-600 dark:text-slate-300">
          Invite whole groups
        </legend>
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={headsOn ? 'primary' : 'secondary'}
            aria-pressed={headsOn}
            onClick={toggleHeads}
          >
            Staff heads
          </Button>
          {MEETING_INVITE_ROLES.map((r) => (
            <Button
              key={r}
              size="sm"
              variant={roles.includes(r) ? 'primary' : 'secondary'}
              aria-pressed={roles.includes(r)}
              onClick={() =>
                setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]))
              }
            >
              {ROLE_GROUP_LABELS[r]}
            </Button>
          ))}
        </div>
      </fieldset>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
          …and/or individual people{people.length > 0 && ` (${people.length} added)`}
        </p>
        <StaffPicker
          onPick={togglePerson}
          selected={people.map((p) => p.id)}
          label="Search people to invite"
        />
      </div>
      {!emergency && (
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-slate-600 dark:text-slate-300">When</legend>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant={!later ? 'primary' : 'secondary'}
              aria-pressed={!later}
              onClick={() => setLater(false)}
            >
              Start now
            </Button>
            <Button
              size="sm"
              variant={later ? 'primary' : 'secondary'}
              aria-pressed={later}
              onClick={() => setLater(true)}
            >
              Schedule for later
            </Button>
          </div>
          {later && (
            <Input
              type="datetime-local"
              aria-label="Meeting date and time"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              required
            />
          )}
        </fieldset>
      )}
      <p className="text-xs text-slate-500">
        Up to {maxInCall} people can be in the call at once; everyone invited can see who is in it.
      </p>
      {start.error && <Alert tone="error">{start.error}</Alert>}
      <Button
        type="submit"
        disabled={
          start.pending ||
          !title.trim() ||
          (roles.length === 0 && people.length === 0) ||
          (later && !scheduledFor)
        }
        className={cn(emergency && 'bg-red-600 hover:bg-red-700')}
      >
        {start.pending
          ? 'Saving…'
          : emergency
            ? 'Start emergency meeting now'
            : later
              ? 'Book meeting'
              : 'Start meeting'}
      </Button>
    </form>
  );
}
