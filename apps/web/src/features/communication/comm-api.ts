/**
 * Communication hub types (the shapes GET /api/comm/* returns) and the live-update hook.
 */
import {
  COMM_EVENTS,
  type AvailabilityStatus,
  type CallStatus,
  type CallUrgency,
  type CommEventType,
  type NoticeAudience,
  type NoticePriority,
} from '@hospitalos/shared';
import { useEffect, useRef } from 'react';
import { useInvalidate } from '../../lib/use-api';

export const COMM = '/api/comm';

export interface StaffMember {
  id: string;
  fullName: string;
  designation: string;
  department: string;
  roles: string[];
  specialty: string | null;
  isDoctor: boolean;
  availability: AvailabilityStatus | null;
  availabilityNote: string | null;
}

export interface Notice {
  id: string;
  title: string;
  body: string;
  priority: NoticePriority;
  audience: NoticeAudience;
  audienceLabel: string;
  author: string;
  createdAt: string;
  mine: boolean;
  read: boolean;
}

export interface Conversation {
  id: string;
  kind: 'direct' | 'group';
  title: string | null;
  others: { id: string; fullName: string }[] | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastFromMe: boolean | null;
  unread: number;
}

export interface Message {
  id: string;
  body: string;
  createdAt: string;
  senderId: string;
  senderName: string;
  mine: boolean;
}

export interface CallRequest {
  id: string;
  reason: string;
  urgency: CallUrgency;
  status: CallStatus;
  responseNote: string | null;
  createdAt: string;
  respondedAt: string | null;
  expiresAt: string;
  conversationId: string | null;
  requesterId: string;
  requesterName: string;
  doctorUserId: string;
  doctorName: string;
}

export function conversationName(c: Conversation): string {
  if (c.kind === 'group') return c.title ?? 'Group';
  return c.others?.map((o) => o.fullName).join(', ') || 'Conversation';
}

export interface MeetingParticipant {
  id: string;
  fullName: string;
  present: boolean;
}

export interface Meeting {
  id: string;
  title: string;
  kind: 'standard' | 'emergency';
  status: 'active' | 'ended';
  createdAt: string;
  endedAt: string | null;
  conversationId: string;
  hostId: string;
  hostName: string;
  isHost: boolean;
  present: boolean;
  joinedAt: string | null;
  participants: MeetingParticipant[];
}

/** A WebRTC signal relayed by the server from another person in the same meeting. */
export interface SignalEvent {
  id: string;
  from: string;
  kind: 'offer' | 'answer' | 'ice' | 'leave';
  data?: Record<string, unknown>;
}

type SignalListener = (signal: SignalEvent) => void;
const signalListeners = new Set<SignalListener>();

/** The meeting room listens here for signals arriving on the shared event stream. */
export function onSignal(listener: SignalListener): () => void {
  signalListeners.add(listener);
  return () => {
    signalListeners.delete(listener);
  };
}

/** Which cached reads each live event makes stale. */
const RELOADS: Record<CommEventType, string[]> = {
  message: [`${COMM}/conversations`, `${COMM}/summary`],
  notice: [`${COMM}/notices`, `${COMM}/summary`],
  call: [`${COMM}/calls`, `${COMM}/summary`],
  availability: [`${COMM}/staff`, `${COMM}/summary`],
  meeting: [`${COMM}/meetings`, `${COMM}/summary`],
  signal: [],
};

/**
 * Keeps one Server-Sent Events stream open while signed in. Each event names what changed;
 * the matching reads reload through the normal API. The browser reconnects by itself when
 * the server ends the stream.
 */
export function useCommEvents(
  enabled: boolean,
  onEvent?: (type: CommEventType, id: string | undefined) => void,
) {
  const reload = useInvalidate();
  const reloadRef = useRef(reload);
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    reloadRef.current = reload;
    onEventRef.current = onEvent;
  });
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const source = new EventSource(`${COMM}/events`);
    for (const type of COMM_EVENTS) {
      source.addEventListener(type, (e) => {
        let payload: { id?: string } = {};
        try {
          payload = JSON.parse((e as MessageEvent<string>).data) as { id?: string };
        } catch {
          return;
        }
        if (type === 'signal') {
          signalListeners.forEach((l) => l(payload as SignalEvent));
          return;
        }
        if (RELOADS[type].length) void reloadRef.current(...RELOADS[type]);
        onEventRef.current?.(type, payload.id);
      });
    }
    return () => source.close();
  }, [enabled]);
}

/** A short two-tone chime for an incoming call request. Silently does nothing if blocked. */
export function playChime(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.25);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.25 + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.25);
      osc.stop(ctx.currentTime + i * 0.25 + 0.25);
    });
    setTimeout(() => void ctx.close(), 1000);
  } catch {
    // Audio is a nicety; the badge and banner still show the request.
  }
}
