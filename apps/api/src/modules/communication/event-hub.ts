/**
 * Live updates for the communication hub over Server-Sent Events (GET /api/comm/events).
 *
 * Each signed-in browser tab keeps one stream open. Events carry only a type and record IDs,
 * never message text or patient data; the browser reloads what changed through the normal,
 * permission-checked API. The one exception is 'signal': WebRTC connection details (session
 * descriptions and network candidates) relayed between two people in the same meeting. Streams close after STREAM_LIFETIME_MS and the browser reconnects,
 * so a signed-out or disabled account stops receiving events within that time.
 *
 * In-memory, so it works for one API process (the MVP). Several processes would need a
 * shared channel such as PostgreSQL LISTEN/NOTIFY.
 */
import type { CommEventType } from '@hospitalos/shared';

export interface EventSink {
  write(chunk: string): unknown;
  end(): unknown;
}

export interface CommEvent {
  type: CommEventType;
  id?: string;
  /** 'signal' only: the sender, the signal kind and its WebRTC payload. */
  from?: string;
  kind?: string;
  data?: unknown;
}

export const STREAM_LIFETIME_MS = 5 * 60 * 1000;
export const HEARTBEAT_MS = 25 * 1000;
/** Per user, so one person with many tabs can't hold unlimited connections. */
export const MAX_STREAMS_PER_USER = 10;

export class EventHub {
  private readonly streams = new Map<string, Set<EventSink>>();

  /** Registers a stream; returns a function that removes it. Drops the oldest beyond the cap. */
  add(userId: string, sink: EventSink): () => void {
    let set = this.streams.get(userId);
    if (!set) {
      set = new Set();
      this.streams.set(userId, set);
    }
    if (set.size >= MAX_STREAMS_PER_USER) {
      const oldest = set.values().next().value!;
      set.delete(oldest);
      oldest.end();
    }
    set.add(sink);
    return () => {
      set.delete(sink);
      if (set.size === 0 && this.streams.get(userId) === set) this.streams.delete(userId);
    };
  }

  /** Sends an event to every open stream of the given users. */
  send(userIds: Iterable<string>, event: CommEvent): void {
    const chunk = format(event);
    for (const userId of new Set(userIds)) {
      for (const sink of this.streams.get(userId) ?? []) sink.write(chunk);
    }
  }

  /** Sends an event to everyone connected (the server re-checks who may see what). */
  broadcast(event: CommEvent): void {
    this.send(this.streams.keys(), event);
  }

  /** Ends every stream (on shutdown, so open streams don't hold the server open). */
  closeAll(): void {
    for (const set of this.streams.values()) for (const sink of set) sink.end();
    this.streams.clear();
  }

  connectedUsers(): number {
    return this.streams.size;
  }
}

export function format({ type, ...rest }: CommEvent): string {
  return `event: ${type}\ndata: ${JSON.stringify(rest)}\n\n`;
}
