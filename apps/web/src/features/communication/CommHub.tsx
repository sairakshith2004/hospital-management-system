/**
 * The communication hub: a floating chat button on every screen that opens a panel with
 * official notices, staff messages, doctor call requests and video meetings (with a ringing
 * screen for meeting invitations, full-screen for emergencies). Live updates come over
 * Server-Sent Events; the summary also refreshes every minute in case the stream drops.
 */
import type { CommSummary } from '@hospitalos/shared';
import { useEffect, useRef, useState } from 'react';
import { Tabs } from '../../components/ui/tabs';
import { useApi } from '../../lib/use-api';
import { cn } from '../../lib/utils';
import { useAuth } from '../auth/auth-context';
import { CallsTab } from './CallsTab';
import { COMM, playChime, useCommEvents, type Meeting } from './comm-api';
import { MeetingInvite } from './MeetingInvite';
import { MeetingRoom } from './MeetingRoom';
import { MeetingsTab } from './MeetingsTab';
import { MessagesTab } from './MessagesTab';
import { NoticesTab } from './NoticesTab';

type Tab = 'notices' | 'messages' | 'calls' | 'meetings';

export function CommHub() {
  const { can } = useAuth();
  const enabled = can('message:send');
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('messages');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const { data: summary } = useApi<CommSummary>(enabled ? `${COMM}/summary` : null, {
    refetchInterval: 60_000,
  });
  const { data: meetingList } = useApi<{ meetings: Meeting[] }>(
    enabled ? `${COMM}/meetings` : null,
    { refetchInterval: 30_000 },
  );
  // Meetings that should ring: live, never joined, not dismissed, not the one we're in.
  const ringing = (meetingList?.meetings ?? []).filter(
    (m) =>
      m.status === 'active' &&
      !m.joinedAt &&
      !m.isHost &&
      m.id !== roomId &&
      !dismissed.includes(m.id),
  );

  useCommEvents(enabled);

  // Chime when a new call request arrives for this doctor.
  const incoming = summary?.incomingCalls ?? 0;
  const lastIncoming = useRef(incoming);
  useEffect(() => {
    if (incoming > lastIncoming.current) playChime();
    lastIncoming.current = incoming;
  }, [incoming]);

  if (!enabled) return null;

  const invites = summary?.meetingInvites ?? 0;
  const unread =
    (summary?.unreadMessages ?? 0) + (summary?.unreadNotices ?? 0) + incoming + invites;

  function joinMeeting(id: string) {
    setRoomId(id);
    setOpen(false);
  }

  function openChat(id: string) {
    setConversationId(id);
    setTab('messages');
    setOpen(true);
  }

  return (
    <>
      {roomId && <MeetingRoom meetingId={roomId} onClose={() => setRoomId(null)} />}
      {!roomId && ringing[0] && (
        <MeetingInvite
          meeting={ringing[0]}
          onJoin={() => joinMeeting(ringing[0]!.id)}
          onDismiss={() => setDismissed((d) => [...d, ringing[0]!.id])}
        />
      )}
      {incoming > 0 && !(open && tab === 'calls') && (
        <button
          type="button"
          onClick={() => {
            setTab('calls');
            setOpen(true);
          }}
          className="fixed right-4 bottom-22 z-40 flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-lg ring-4 ring-red-200 motion-safe:animate-pulse"
        >
          📞 {incoming} call request{incoming > 1 ? 's' : ''} waiting
        </button>
      )}

      {open && (
        <section
          aria-label="Communication hub"
          className="fixed right-4 bottom-22 z-40 flex h-[min(620px,calc(100vh-7rem))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        >
          <header className="flex items-center justify-between bg-gradient-to-r from-brand-600 to-teal-600 px-4 py-2.5 text-white">
            <h2 className="text-sm font-semibold">Communication hub</h2>
            <button
              type="button"
              aria-label="Close communication hub"
              onClick={() => setOpen(false)}
              className="rounded px-2 text-lg leading-none hover:bg-white/20"
            >
              ×
            </button>
          </header>
          <div className="px-2">
            <Tabs
              label="Communication"
              value={tab}
              onChange={setTab}
              tabs={[
                {
                  value: 'messages',
                  label: 'Messages',
                  count: summary?.unreadMessages || undefined,
                },
                { value: 'notices', label: 'Notices', count: summary?.unreadNotices || undefined },
                { value: 'calls', label: 'Calls', count: incoming || undefined },
                { value: 'meetings', label: 'Meetings', count: invites || undefined },
              ]}
            />
          </div>
          <div className="min-h-0 flex-1">
            {tab === 'meetings' && <MeetingsTab onJoin={joinMeeting} />}
            {tab === 'messages' && (
              <MessagesTab
                openId={conversationId}
                onOpen={setConversationId}
                onJoinMeeting={joinMeeting}
              />
            )}
            {tab === 'notices' && <NoticesTab />}
            {tab === 'calls' && <CallsTab summary={summary} onOpenChat={openChat} />}
          </div>
        </section>
      )}

      <button
        type="button"
        aria-label={`${open ? 'Close' : 'Open'} communication hub${unread ? `, ${unread} new` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'fixed right-4 bottom-4 z-40 flex size-14 items-center justify-center rounded-full text-white shadow-lg transition-transform hover:scale-105',
          'bg-gradient-to-br from-brand-600 to-teal-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
        )}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-7"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
        >
          {open ? (
            <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
          ) : (
            <path
              strokeLinejoin="round"
              d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z"
            />
          )}
        </svg>
        {unread > 0 && !open && (
          <span className="absolute -top-1 -right-1 flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-semibold ring-2 ring-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    </>
  );
}
