/**
 * A meeting invitation that rings. Emergency meetings take over the whole screen and keep
 * ringing until the person joins or dismisses; normal meetings show a card and chime once.
 */
import { useEffect } from 'react';
import { formatDateTime, formatTime } from '../../lib/format';
import { playChime, type Meeting } from './comm-api';

export function MeetingInvite({
  meeting,
  onJoin,
  onDismiss,
}: {
  meeting: Meeting;
  onJoin(): void;
  onDismiss(): void;
}) {
  const emergency = meeting.kind === 'emergency';
  useEffect(() => {
    playChime();
    if (!emergency) return;
    const ring = setInterval(playChime, 2500);
    return () => clearInterval(ring);
  }, [emergency, meeting.id]);

  const inCall = meeting.participants.filter((p) => p.present).length;

  if (emergency)
    return (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="meeting-invite-title"
        className="fixed inset-0 z-[70] flex items-center justify-center bg-red-950/90 p-4 text-white"
      >
        <div className="w-full max-w-md space-y-5 text-center">
          <p className="text-6xl motion-safe:animate-bounce" aria-hidden="true">
            🚨
          </p>
          <p className="text-sm font-semibold tracking-widest text-red-200 uppercase">
            Emergency meeting
          </p>
          <h2 id="meeting-invite-title" className="text-3xl font-bold">
            {meeting.title}
          </h2>
          <p className="text-red-100">
            Called by {meeting.hostName} at {formatTime(meeting.createdAt)} · {inCall} already in
            the call
          </p>
          <div className="flex justify-center gap-3">
            <button
              type="button"
              autoFocus
              onClick={onJoin}
              className="rounded-full bg-white px-8 py-3 text-lg font-bold text-red-700 shadow-lg hover:bg-red-50"
            >
              Join now
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-full border border-red-300 px-6 py-3 text-red-100 hover:bg-red-900"
            >
              Dismiss
            </button>
          </div>
          <p className="text-xs text-red-200">
            You can still join later from the chat button → Meetings.
          </p>
        </div>
      </div>
    );

  return (
    <div
      role="alertdialog"
      aria-labelledby="meeting-invite-title"
      className="fixed bottom-4 left-4 z-[70] w-[min(360px,calc(100vw-2rem))] space-y-3 rounded-xl border border-sky-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
    >
      <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase dark:text-brand-300">
        {meeting.status === 'scheduled' ? '⏰ Meeting starting soon' : '📹 Meeting invitation'}
      </p>
      <h2 id="meeting-invite-title" className="font-semibold">
        {meeting.title}
      </h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {meeting.status === 'scheduled' && meeting.scheduledFor
          ? `${meeting.hostName} booked it for ${formatDateTime(meeting.scheduledFor)}`
          : `${meeting.hostName} invited you · ${inCall} in the call`}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onJoin}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Join
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
