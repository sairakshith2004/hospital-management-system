import {
  MAX_IN_MEETING,
  MEETING_INVITE_ROLES,
  ROLE_NAMES,
  type MeetingKind,
} from '@hospitalos/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Spinner } from '../../components/ui/spinner';
import { formatDateTime, formatTime } from '../../lib/format';
import { useAction, useApi } from '../../lib/use-api';
import { cn } from '../../lib/utils';
import { useAuth } from '../auth/auth-context';
import { COMM, type Meeting, type StaffMember } from './comm-api';
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
  const { data, isLoading } = useApi<{ meetings: Meeting[] }>(`${COMM}/meetings`);

  if (starting)
    return <StartMeeting kind={starting} onCancel={() => setStarting(null)} onStarted={onJoin} />;

  const active = data?.meetings.filter((m) => m.status === 'active') ?? [];
  const ended = data?.meetings.filter((m) => m.status === 'ended') ?? [];
  return (
    <div className="h-full space-y-4 overflow-y-auto p-3">
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
        Started by {m.hostName} at {formatTime(m.createdAt)}
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

function StartMeeting({
  kind,
  onCancel,
  onStarted,
}: {
  kind: MeetingKind;
  onCancel(): void;
  onStarted(id: string): void;
}) {
  const [title, setTitle] = useState(kind === 'emergency' ? 'Emergency case discussion' : '');
  const [roles, setRoles] = useState<string[]>(kind === 'emergency' ? ['DOC'] : []);
  const [people, setPeople] = useState<StaffMember[]>([]);
  const start = useAction<object, { id: string }>('POST', `${COMM}/meetings`, {
    invalidate: [`${COMM}/meetings`],
    onSuccess: (res) => onStarted(res.id),
  });

  function togglePerson(s: StaffMember) {
    setPeople((p) => (p.some((x) => x.id === s.id) ? p.filter((x) => x.id !== s.id) : [...p, s]));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    start.run({ title, kind, inviteRoles: roles, inviteeIds: people.map((p) => p.id) });
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
      <p className="text-xs text-slate-500">
        Up to {MAX_IN_MEETING} people can be in the call at once; everyone invited can see who is in
        it.
      </p>
      {start.error && <Alert tone="error">{start.error}</Alert>}
      <Button
        type="submit"
        disabled={start.pending || !title.trim() || (roles.length === 0 && people.length === 0)}
        className={cn(emergency && 'bg-red-600 hover:bg-red-700')}
      >
        {start.pending ? 'Starting…' : emergency ? 'Start emergency meeting now' : 'Start meeting'}
      </Button>
    </form>
  );
}
