import { useEffect, useRef, useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Spinner } from '../../components/ui/spinner';
import { Textarea } from '../../components/ui/textarea';
import { formatDateTime, formatTime } from '../../lib/format';
import { useAction, useApi } from '../../lib/use-api';
import { cn } from '../../lib/utils';
import {
  COMM,
  conversationName,
  type Conversation,
  type Message,
  type StaffMember,
} from './comm-api';
import { StaffPicker } from './StaffPicker';

export function MessagesTab({
  openId,
  onOpen,
  onJoinMeeting,
}: {
  openId: string | null;
  onOpen(id: string | null): void;
  onJoinMeeting(meetingId: string): void;
}) {
  const [composing, setComposing] = useState(false);
  if (composing)
    return (
      <NewConversation
        onCancel={() => setComposing(false)}
        onCreated={(id) => {
          setComposing(false);
          onOpen(id);
        }}
      />
    );
  if (openId)
    return <Thread id={openId} onBack={() => onOpen(null)} onJoinMeeting={onJoinMeeting} />;
  return <ConversationList onOpen={onOpen} onNew={() => setComposing(true)} />;
}

function ConversationList({ onOpen, onNew }: { onOpen(id: string): void; onNew(): void }) {
  const { data, isLoading, error } = useApi<{ conversations: Conversation[] }>(
    `${COMM}/conversations`,
  );
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <p className="text-sm text-slate-500">Staff conversations</p>
        <Button size="sm" onClick={onNew}>
          New chat
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading && <Spinner className="m-4" />}
        {error && <Alert tone="error">Couldn't load conversations.</Alert>}
        {data?.conversations.length === 0 && (
          <p className="p-4 text-sm text-slate-500">
            No conversations yet. Start one with <strong>New chat</strong>.
          </p>
        )}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {data?.conversations.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onOpen(c.id)}
                className="flex w-full items-start justify-between gap-2 px-3 py-2.5 text-left hover:bg-sky-50 dark:hover:bg-slate-800"
              >
                <span className="min-w-0">
                  <span className={cn('block truncate text-sm', c.unread > 0 && 'font-semibold')}>
                    {c.kind === 'group' && '👥 '}
                    {conversationName(c)}
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    {c.lastMessage
                      ? `${c.lastFromMe ? 'You: ' : ''}${c.lastMessage}`
                      : 'No messages yet'}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {c.lastMessageAt && (
                    <span className="text-[0.7rem] text-slate-400">
                      {formatTime(c.lastMessageAt)}
                    </span>
                  )}
                  {c.unread > 0 && <Badge tone="info">{c.unread}</Badge>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * One conversation's messages and the reply box. Without `onBack` (inside a meeting room)
 * the header with the name, back and video-call buttons is left out.
 */
export function Thread({
  id,
  onBack,
  onJoinMeeting,
}: {
  id: string;
  onBack?(): void;
  onJoinMeeting?(meetingId: string): void;
}) {
  const list = useApi<{ conversations: Conversation[] }>(`${COMM}/conversations`);
  const conv = list.data?.conversations.find((c) => c.id === id);
  const { data, isLoading, error } = useApi<{ messages: Message[] }>(
    `${COMM}/conversations/${id}/messages`,
  );
  const markRead = useAction('POST', `${COMM}/conversations/${id}/read`, {
    invalidate: [`${COMM}/conversations`, `${COMM}/summary`],
  });
  const send = useAction<{ body: string }>('POST', `${COMM}/conversations/${id}/messages`, {
    invalidate: [`${COMM}/conversations`, `${COMM}/summary`],
  });
  const call = useAction<undefined, { id: string }>('POST', `${COMM}/conversations/${id}/meeting`, {
    invalidate: [`${COMM}/meetings`],
    onSuccess: (res) => onJoinMeeting?.(res.id),
  });
  const [body, setBody] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const count = data?.messages.length ?? 0;
  const unread = conv?.unread ?? 0;

  // Mark read when opened with unread messages, and whenever new ones arrive while open.
  const { run: markReadRun, pending: marking } = markRead;
  useEffect(() => {
    if (unread > 0 && !marking) markReadRun(undefined);
  }, [id, unread, marking, markReadRun]);
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [count]);

  function onSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    send.run({ body: text }, { onSuccess: () => setBody('') });
  }

  return (
    <div className="flex h-full flex-col">
      {onBack && (
        <div className="flex items-center gap-2 border-b border-slate-100 px-2 py-2 dark:border-slate-800">
          <Button variant="ghost" size="sm" onClick={onBack} aria-label="Back to conversations">
            ←
          </Button>
          <p className="min-w-0 flex-1 truncate text-sm font-medium">
            {conv ? conversationName(conv) : '…'}
          </p>
          {onJoinMeeting && (
            <Button
              size="sm"
              variant="secondary"
              disabled={call.pending}
              onClick={() => call.run(undefined)}
              title="Start or join a video call with everyone in this chat"
            >
              📹 Video call
            </Button>
          )}
        </div>
      )}
      {call.error && <Alert tone="error">{call.error}</Alert>}
      <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50/60 px-3 py-3 dark:bg-slate-950/40">
        {isLoading && <Spinner />}
        {error && <Alert tone="error">Couldn't load messages.</Alert>}
        {count === 0 && !isLoading && (
          <p className="text-center text-xs text-slate-500">Say hello 👋</p>
        )}
        {data?.messages.map((m) => (
          <div key={m.id} className={cn('flex', m.mine ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[80%] rounded-lg px-3 py-1.5 text-sm shadow-sm',
                m.mine
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-100',
              )}
            >
              {!m.mine && conv?.kind === 'group' && (
                <p className="text-[0.7rem] font-semibold text-brand-700 dark:text-brand-300">
                  {m.senderName}
                </p>
              )}
              <p className="break-words whitespace-pre-wrap">{m.body}</p>
              <p
                className={cn(
                  'text-right text-[0.65rem]',
                  m.mine ? 'text-sky-100' : 'text-slate-400',
                )}
                title={formatDateTime(m.createdAt)}
              >
                {formatTime(m.createdAt)}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form
        onSubmit={onSubmit}
        className="space-y-1 border-t border-slate-100 p-2 dark:border-slate-800"
      >
        {send.error && <Alert tone="error">{send.error}</Alert>}
        <div className="flex items-end gap-2">
          <Textarea
            aria-label="Message"
            rows={2}
            maxLength={2000}
            value={body}
            placeholder="Type a message… (Enter to send, Shift+Enter for a new line)"
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) onSubmit(e);
            }}
            className="min-h-0 flex-1 resize-none"
          />
          <Button type="submit" disabled={send.pending || !body.trim()}>
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}

function NewConversation({
  onCancel,
  onCreated,
}: {
  onCancel(): void;
  onCreated(id: string): void;
}) {
  const [group, setGroup] = useState(false);
  const [title, setTitle] = useState('');
  const [members, setMembers] = useState<StaffMember[]>([]);
  const create = useAction<object, { id: string }>('POST', `${COMM}/conversations`, {
    invalidate: [`${COMM}/conversations`],
    onSuccess: (res) => onCreated(res.id),
  });

  function pick(s: StaffMember) {
    if (!group) {
      create.run({ kind: 'direct', userId: s.id });
      return;
    }
    setMembers((m) => (m.some((x) => x.id === s.id) ? m.filter((x) => x.id !== s.id) : [...m, s]));
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{group ? 'New group' : 'New chat'}</p>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <div className="flex gap-2 text-sm">
        <Button size="sm" variant={group ? 'secondary' : 'primary'} onClick={() => setGroup(false)}>
          One person
        </Button>
        <Button size="sm" variant={group ? 'primary' : 'secondary'} onClick={() => setGroup(true)}>
          Group
        </Button>
      </div>
      {group && (
        <Input
          aria-label="Group name"
          placeholder="Group name, e.g. Ward 3 case review"
          maxLength={80}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      )}
      <StaffPicker onPick={pick} selected={members.map((m) => m.id)} />
      {create.error && <Alert tone="error">{create.error}</Alert>}
      {group && (
        <Button
          disabled={create.pending || members.length === 0 || !title.trim()}
          onClick={() =>
            create.run({ kind: 'group', title: title.trim(), memberIds: members.map((m) => m.id) })
          }
        >
          Create group ({members.length + 1} people)
        </Button>
      )}
      {!group && (
        <p className="text-xs text-slate-500">Pick someone to open your chat with them.</p>
      )}
    </div>
  );
}
