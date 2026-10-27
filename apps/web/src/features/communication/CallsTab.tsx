import {
  AVAILABILITY_LABELS,
  AVAILABILITY_STATUSES,
  CALL_URGENCIES,
  CALL_URGENCY_LABELS,
  type CallUrgency,
  type CommSummary,
} from '@hospitalos/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert } from '../../components/ui/alert';
import { Badge, type BadgeTone } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { formatTime } from '../../lib/format';
import { useAction, useApi } from '../../lib/use-api';
import { cn } from '../../lib/utils';
import { useAuth } from '../auth/auth-context';
import { COMM, type CallRequest, type StaffMember } from './comm-api';
import { AVAILABILITY_TONES, StaffPicker } from './StaffPicker';

const STATUS_TONES: Record<string, BadgeTone> = {
  pending: 'info',
  accepted: 'success',
  declined: 'danger',
  cancelled: 'neutral',
  expired: 'neutral',
};
const URGENCY_TONES: Record<CallUrgency, BadgeTone> = {
  routine: 'neutral',
  urgent: 'warning',
  emergency: 'danger',
};
const RELOAD = [`${COMM}/calls`, `${COMM}/summary`];

export function CallsTab({
  summary,
  onOpenChat,
}: {
  summary: CommSummary | undefined;
  onOpenChat(conversationId: string): void;
}) {
  const { can } = useAuth();
  const { data } = useApi<{ incoming: CallRequest[]; outgoing: CallRequest[] }>(`${COMM}/calls`);
  const canRequest = can('call_request:create');
  return (
    <div className="h-full space-y-4 overflow-y-auto p-3">
      {summary?.isDoctor && (
        <>
          <Availability current={summary.availability ?? 'available'} />
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Requests to you</h3>
            {data?.incoming.length === 0 && (
              <p className="text-sm text-slate-500">No call requests in the last 24 hours.</p>
            )}
            {data?.incoming.map((c) => (
              <IncomingCall key={c.id} call={c} onOpenChat={onOpenChat} />
            ))}
          </section>
        </>
      )}
      {canRequest && <RequestForm />}
      {canRequest && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Your requests</h3>
          {data?.outgoing.length === 0 && (
            <p className="text-sm text-slate-500">You haven't asked a doctor for a call today.</p>
          )}
          {data?.outgoing.map((c) => (
            <OutgoingCall key={c.id} call={c} onOpenChat={onOpenChat} />
          ))}
        </section>
      )}
      {!summary?.isDoctor && !canRequest && (
        <p className="text-sm text-slate-500">
          Call requests are for doctors and medical staff. Use Messages to contact a colleague.
        </p>
      )}
    </div>
  );
}

function Availability({ current }: { current: string }) {
  const set = useAction<{ status: string }>('POST', `${COMM}/availability`, {
    invalidate: RELOAD,
  });
  return (
    <section className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <h3 className="text-sm font-semibold">Your availability</h3>
      <div className="flex gap-2" role="group" aria-label="Your availability">
        {AVAILABILITY_STATUSES.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={current === s ? 'primary' : 'secondary'}
            aria-pressed={current === s}
            disabled={set.pending}
            onClick={() => set.run({ status: s })}
          >
            {AVAILABILITY_LABELS[s]}
          </Button>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        Staff see this before calling you. Off duty blocks everything except emergencies.
      </p>
      {set.error && <Alert tone="error">{set.error}</Alert>}
    </section>
  );
}

function CallCard({
  call,
  who,
  children,
}: {
  call: CallRequest;
  who: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'space-y-1.5 rounded-lg border p-3 text-sm',
        call.status === 'pending' && call.urgency === 'emergency'
          ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30'
          : 'border-slate-200 dark:border-slate-700',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{who}</span>
        <span className="flex gap-1">
          <Badge tone={URGENCY_TONES[call.urgency]}>{CALL_URGENCY_LABELS[call.urgency]}</Badge>
          <Badge tone={STATUS_TONES[call.status]}>{call.status}</Badge>
        </span>
      </div>
      <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{call.reason}</p>
      <p className="text-xs text-slate-500">
        Sent {formatTime(call.createdAt)}
        {call.status === 'pending' && ` · expires ${formatTime(call.expiresAt)}`}
        {call.responseNote && ` · “${call.responseNote}”`}
      </p>
      {children}
    </div>
  );
}

function IncomingCall({ call, onOpenChat }: { call: CallRequest; onOpenChat(id: string): void }) {
  const [note, setNote] = useState('');
  const respond = useAction<
    { id: string; decision: 'accept' | 'decline'; note?: string },
    { conversationId: string | null }
  >('POST', (b) => `${COMM}/calls/${b.id}/respond`, {
    invalidate: [...RELOAD, `${COMM}/conversations`],
    onSuccess: (res) => res.conversationId && onOpenChat(res.conversationId),
  });
  return (
    <CallCard call={call} who={`From ${call.requesterName}`}>
      {call.status === 'pending' && (
        <div className="space-y-2">
          <Input
            aria-label="Reply note (optional)"
            placeholder="Optional note, e.g. coming in 5 minutes"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={respond.pending}
              onClick={() =>
                respond.run({
                  id: call.id,
                  decision: 'accept',
                  ...(note.trim() && { note: note.trim() }),
                })
              }
            >
              Accept
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={respond.pending}
              onClick={() =>
                respond.run({
                  id: call.id,
                  decision: 'decline',
                  ...(note.trim() && { note: note.trim() }),
                })
              }
            >
              Decline
            </Button>
          </div>
          {respond.error && <Alert tone="error">{respond.error}</Alert>}
        </div>
      )}
      {call.conversationId && (
        <Button size="sm" variant="ghost" onClick={() => onOpenChat(call.conversationId!)}>
          Open chat →
        </Button>
      )}
    </CallCard>
  );
}

function OutgoingCall({ call, onOpenChat }: { call: CallRequest; onOpenChat(id: string): void }) {
  const cancel = useAction<{ id: string }>('POST', (b) => `${COMM}/calls/${b.id}/cancel`, {
    invalidate: RELOAD,
  });
  return (
    <CallCard call={call} who={`To Dr. ${call.doctorName}`}>
      {call.status === 'pending' && (
        <Button
          size="sm"
          variant="secondary"
          disabled={cancel.pending}
          onClick={() => cancel.run({ id: call.id })}
        >
          Cancel request
        </Button>
      )}
      {call.conversationId && (
        <Button size="sm" variant="ghost" onClick={() => onOpenChat(call.conversationId!)}>
          Open chat →
        </Button>
      )}
      {cancel.error && <Alert tone="error">{cancel.error}</Alert>}
    </CallCard>
  );
}

function RequestForm() {
  const [doctor, setDoctor] = useState<StaffMember | null>(null);
  const [reason, setReason] = useState('');
  const [urgency, setUrgency] = useState<CallUrgency>('routine');
  const send = useAction<object>('POST', `${COMM}/calls`, {
    invalidate: RELOAD,
    onSuccess: () => {
      setDoctor(null);
      setReason('');
      setUrgency('routine');
    },
  });
  const offDuty = doctor?.availability === 'off_duty';

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (doctor) send.run({ doctorUserId: doctor.id, reason, urgency });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
    >
      <h3 className="text-sm font-semibold">Ask a doctor for a call</h3>
      {doctor ? (
        <div className="flex items-center justify-between text-sm">
          <span>
            Dr. <strong>{doctor.fullName}</strong>{' '}
            {doctor.availability && (
              <Badge tone={AVAILABILITY_TONES[doctor.availability]}>
                {AVAILABILITY_LABELS[doctor.availability]}
              </Badge>
            )}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setDoctor(null)}>
            Change
          </Button>
        </div>
      ) : (
        <StaffPicker doctorsOnly onPick={setDoctor} label="Search doctors" />
      )}
      {doctor && (
        <>
          <Textarea
            aria-label="Reason"
            placeholder="What is it about? Keep patient details to what the doctor needs."
            rows={3}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
          />
          <Select
            aria-label="Urgency"
            value={urgency}
            onChange={(e) => setUrgency(e.target.value as CallUrgency)}
          >
            {CALL_URGENCIES.map((u) => (
              <option key={u} value={u}>
                {CALL_URGENCY_LABELS[u]}
              </option>
            ))}
          </Select>
          {offDuty && urgency !== 'emergency' && (
            <Alert tone="info">This doctor is off duty. Only emergency requests can be sent.</Alert>
          )}
          {send.error && <Alert tone="error">{send.error}</Alert>}
          <Button
            type="submit"
            disabled={send.pending || !reason.trim() || (offDuty && urgency !== 'emergency')}
          >
            {send.pending ? 'Sending…' : 'Send request'}
          </Button>
        </>
      )}
    </form>
  );
}
