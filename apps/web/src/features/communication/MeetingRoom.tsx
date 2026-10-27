/**
 * The full-screen meeting room: a grid of video tiles, mic/camera/screen-share controls,
 * the meeting's chat, and who is invited. Leaving happens only through the Leave button or
 * closing the tab (React may mount this twice in development, which must not leave).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge } from '../../components/ui/badge';
import { initials } from '../../components/ui/logo';
import { apiFetch } from '../../lib/api';
import { errorCode, errorMessage, useApi, useInvalidate } from '../../lib/use-api';
import { cn } from '../../lib/utils';
import { useAuth } from '../auth/auth-context';
import { COMM, onSignal, type Meeting } from './comm-api';
import { MeshCall } from './mesh';
import { SfuCall } from './sfu';
import { Thread } from './MessagesTab';

const HEARTBEAT_MS = 15_000;

type Phase = 'connecting' | 'live' | 'ended' | 'error';

export function MeetingRoom({ meetingId, onClose }: { meetingId: string; onClose(): void }) {
  const { user } = useAuth();
  const me = user!.id;
  const reload = useInvalidate();
  const { data: meeting } = useApi<Meeting>(`${COMM}/meetings/${meetingId}`, {
    refetchInterval: 10_000,
  });
  const [rawPhase, setPhase] = useState<Phase>('connecting');
  // The host ended it, or everyone else left and the server closed it.
  const phase: Phase = meeting?.status === 'ended' && rawPhase === 'live' ? 'ended' : rawPhase;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [screen, setScreen] = useState<MediaStream | null>(null);
  const [remotes, setRemotes] = useState<Record<string, MediaStream>>({});
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const mesh = useRef<MeshCall | SfuCall | null>(null);
  const screenRef = useRef<MediaStream | null>(null);

  const base = `${COMM}/meetings/${meetingId}`;

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let unsubscribe: (() => void) | undefined;

    async function start() {
      stream = await getMedia().catch(() => null);
      if (cancelled) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      if (!stream)
        setNotice('No camera or microphone found or allowed: others can’t see or hear you.');
      else if (stream.getVideoTracks().length === 0)
        setNotice('No camera found: joining with audio only.');
      setLocal(stream);
      setCamOn(!!stream?.getVideoTracks().length);
      setMicOn(!!stream?.getAudioTracks().length);

      const onRemote = (id: string, s: MediaStream | null) =>
        setRemotes((r) => {
          const next = { ...r };
          if (s) next[id] = s;
          else delete next[id];
          return next;
        });
      const call = new MeshCall({
        me,
        local: stream,
        send: (to, kind, data) =>
          apiFetch(`${base}/signal`, { method: 'POST', body: { to, kind, data } }).then(
            () => undefined,
            () => undefined,
          ),
        onRemote,
      });
      mesh.current = call;
      // Listen before joining, so an offer sent the moment we join isn't missed.
      unsubscribe = onSignal((sig) => {
        if (sig.id === meetingId)
          void call.handle(sig.from, sig.kind, sig.data).catch(() => undefined);
      });
      const joined = await apiFetch<{ peers: string[]; sfu?: { url: string; token: string } }>(
        `${base}/join`,
        { method: 'POST', body: {} },
      );
      if (cancelled) return;
      if (joined.sfu) {
        // The media server carries the call: no browser-to-browser connections.
        call.close();
        unsubscribe();
        unsubscribe = undefined;
        const sfu = new SfuCall({
          local: stream,
          onRemote,
          onDisconnected: () =>
            setNotice('Lost the connection to the video server. Rejoin to continue.'),
        });
        mesh.current = sfu;
        await sfu.connect(joined.sfu.url, joined.sfu.token);
        if (cancelled) return;
      }
      void reload(`${COMM}/meetings`, `${COMM}/summary`);
      setPhase('live');
      if (!joined.sfu) for (const p of joined.peers) void call.connectTo(p).catch(() => undefined);
      heartbeat = setInterval(() => {
        apiFetch(`${base}/heartbeat`, { method: 'POST', body: {} }).catch((err: unknown) => {
          if (errorCode(err) === 'NOT_IN_MEETING') setPhase('ended');
        });
      }, HEARTBEAT_MS);
    }

    start().catch((err: unknown) => {
      if (cancelled) return;
      setError(errorMessage(err));
      setPhase(errorCode(err) === 'MEETING_ENDED' ? 'ended' : 'error');
    });

    // Closing the tab leaves the meeting (best effort; otherwise the heartbeat times out).
    const onPageHide = () => {
      void apiFetch(`${base}/leave`, { method: 'POST', body: {} }).catch(() => undefined);
    };
    window.addEventListener('pagehide', onPageHide);

    return () => {
      cancelled = true;
      window.removeEventListener('pagehide', onPageHide);
      clearInterval(heartbeat);
      unsubscribe?.();
      mesh.current?.close();
      mesh.current = null;
      stream?.getTracks().forEach((t) => t.stop());
      screenRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [base, me, meetingId, reload]);

  function toggleMic() {
    const track = local?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  }

  function toggleCam() {
    const track = local?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCamOn(track.enabled);
  }

  async function toggleShare() {
    if (screen) {
      stopShare();
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = display.getVideoTracks()[0]!;
      track.onended = () => stopShare();
      screenRef.current = display;
      setScreen(display);
      await mesh.current?.replaceVideo(track);
    } catch {
      // The person cancelled the screen picker.
    }
  }

  function stopShare() {
    screenRef.current?.getTracks().forEach((t) => t.stop());
    screenRef.current = null;
    setScreen(null);
    void mesh.current?.replaceVideo(local?.getVideoTracks()[0] ?? null);
  }

  async function leave(endForAll = false) {
    try {
      if (endForAll) await apiFetch(`${base}/end`, { method: 'POST', body: {} });
      else await apiFetch(`${base}/leave`, { method: 'POST', body: {} });
    } catch {
      // Leaving locally anyway; the heartbeat stops, so the server notices within a minute.
    }
    void reload(`${COMM}/meetings`, `${COMM}/summary`);
    onClose();
  }

  const names = new Map(meeting?.participants.map((p) => [p.id, p.fullName]));
  const remoteIds = Object.keys(remotes);
  const tiles = 1 + remoteIds.length;
  const waiting = meeting?.participants.filter((p) => p.id !== me && !p.present) ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Meeting: ${meeting?.title ?? ''}`}
      className="fixed inset-0 z-[60] flex flex-col bg-slate-950 text-white"
    >
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {meeting?.kind === 'emergency' && <Badge tone="danger">🚨 Emergency</Badge>}
          <h2 className="truncate font-semibold">{meeting?.title ?? 'Meeting'}</h2>
          <span className="hidden text-sm text-slate-400 sm:inline">
            · {tiles} in call · host {meeting?.hostName}
          </span>
        </div>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs',
            phase === 'live'
              ? 'bg-emerald-600'
              : phase === 'connecting'
                ? 'bg-amber-600'
                : 'bg-slate-600',
          )}
        >
          {phase === 'live' ? 'Live' : phase === 'connecting' ? 'Connecting…' : 'Not connected'}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col gap-3 p-3">
          {notice && (
            <p className="rounded bg-amber-500/20 px-3 py-1.5 text-sm text-amber-100">{notice}</p>
          )}
          {phase === 'ended' && (
            <div className="m-auto space-y-3 text-center">
              <p className="text-lg">This meeting has ended.</p>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-white px-4 py-2 text-slate-900"
              >
                Close
              </button>
            </div>
          )}
          {phase === 'error' && (
            <div className="m-auto space-y-3 text-center">
              <p className="text-lg">Couldn’t join the meeting.</p>
              <p className="text-sm text-slate-400">{error}</p>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-white px-4 py-2 text-slate-900"
              >
                Close
              </button>
            </div>
          )}
          {(phase === 'live' || phase === 'connecting') && (
            <div
              className={cn(
                'grid min-h-0 flex-1 auto-rows-fr gap-3',
                tiles === 1
                  ? 'grid-cols-1'
                  : tiles <= 4
                    ? 'grid-cols-1 sm:grid-cols-2'
                    : 'grid-cols-2 lg:grid-cols-3',
              )}
            >
              <VideoTile
                stream={screen ?? local}
                name={`${user?.fullName ?? 'You'} (you)${screen ? ' · sharing screen' : ''}`}
                muted
                mirrored={!screen}
                videoOff={!screen && !camOn}
                micOff={!micOn}
              />
              {remoteIds.map((id) => (
                <VideoTile key={id} stream={remotes[id]!} name={names.get(id) ?? 'Participant'} />
              ))}
            </div>
          )}
          {phase === 'live' && remoteIds.length === 0 && (
            <p className="text-center text-sm text-slate-400">
              Waiting for others to join… Everyone invited has been notified.
            </p>
          )}
        </main>

        {chatOpen && meeting && (
          <aside className="hidden w-80 shrink-0 flex-col border-l border-white/10 bg-white text-slate-900 md:flex dark:bg-slate-900 dark:text-slate-100">
            <p className="border-b border-slate-200 px-3 py-2 text-sm font-semibold dark:border-slate-700">
              Meeting chat
            </p>
            <div className="min-h-0 flex-1">
              <Thread id={meeting.conversationId} />
            </div>
            {waiting.length > 0 && (
              <div className="border-t border-slate-200 p-3 text-xs dark:border-slate-700">
                <p className="mb-1 font-semibold">Invited, not in the call ({waiting.length})</p>
                <p className="text-slate-500">{waiting.map((w) => w.fullName).join(', ')}</p>
              </div>
            )}
          </aside>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-center gap-2 border-t border-white/10 px-4 py-3">
        <ControlButton
          onClick={toggleMic}
          active={micOn}
          disabled={!local?.getAudioTracks().length}
        >
          {micOn ? '🎙️ Mute' : '🔇 Unmute'}
        </ControlButton>
        <ControlButton
          onClick={toggleCam}
          active={camOn}
          disabled={!local?.getVideoTracks().length}
        >
          {camOn ? '📷 Stop video' : '📷 Start video'}
        </ControlButton>
        <ControlButton
          onClick={() => void toggleShare()}
          active={!screen}
          disabled={phase !== 'live' || !navigator.mediaDevices?.getDisplayMedia}
        >
          {screen ? '🖥️ Stop sharing' : '🖥️ Share screen'}
        </ControlButton>
        <ControlButton onClick={() => setChatOpen((o) => !o)} active={!chatOpen}>
          💬 Chat
        </ControlButton>
        <button
          type="button"
          onClick={() => void leave()}
          className="rounded-full bg-red-600 px-5 py-2 text-sm font-semibold hover:bg-red-700"
        >
          Leave
        </button>
        {meeting?.isHost && meeting.status === 'active' && (
          <button
            type="button"
            onClick={() => void leave(true)}
            className="rounded-full border border-red-400 px-4 py-2 text-sm text-red-200 hover:bg-red-950"
          >
            End for everyone
          </button>
        )}
      </footer>
    </div>
  );
}

async function getMedia(): Promise<MediaStream | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null;
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  } catch {
    return navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
  }
}

function ControlButton({
  onClick,
  active,
  disabled,
  children,
}: {
  onClick(): void;
  active: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={!active}
      className={cn(
        'rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40',
        active ? 'bg-white/10 hover:bg-white/20' : 'bg-amber-500 text-slate-950 hover:bg-amber-400',
      )}
    >
      {children}
    </button>
  );
}

function VideoTile({
  stream,
  name,
  muted = false,
  mirrored = false,
  videoOff = false,
  micOff = false,
}: {
  stream: MediaStream | null;
  name: string;
  muted?: boolean;
  mirrored?: boolean;
  videoOff?: boolean;
  micOff?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  const showVideo = !!stream?.getVideoTracks().length && !videoOff;
  return (
    <div className="relative flex min-h-32 items-center justify-center overflow-hidden rounded-xl bg-slate-800">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={cn(
          'h-full w-full object-cover',
          mirrored && '-scale-x-100',
          !showVideo && 'invisible absolute',
        )}
      />
      {!showVideo && (
        <span className="flex size-20 items-center justify-center rounded-full bg-brand-700 text-2xl font-semibold">
          {initials(name)}
        </span>
      )}
      <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs">
        {micOff && '🔇 '}
        {name}
      </span>
    </div>
  );
}
