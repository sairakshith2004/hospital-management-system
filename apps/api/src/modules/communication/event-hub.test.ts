import { describe, expect, it } from 'vitest';
import { EventHub, format, MAX_STREAMS_PER_USER } from './event-hub.js';

function sink() {
  const chunks: string[] = [];
  let ended = false;
  return {
    chunks,
    ended: () => ended,
    write: (c: string) => chunks.push(c),
    end: () => {
      ended = true;
    },
  };
}

describe('EventHub', () => {
  it('sends only to the named users, once per stream even if a user is named twice', () => {
    const hub = new EventHub();
    const a = sink();
    const a2 = sink();
    const b = sink();
    hub.add('a', a);
    hub.add('a', a2);
    hub.add('b', b);
    hub.send(['a', 'a'], { type: 'message', id: 'c1' });
    expect(a.chunks).toEqual([format({ type: 'message', id: 'c1' })]);
    expect(a2.chunks).toHaveLength(1);
    expect(b.chunks).toEqual([]);
  });

  it('broadcasts to everyone and stops sending after removal', () => {
    const hub = new EventHub();
    const a = sink();
    const b = sink();
    const removeA = hub.add('a', a);
    hub.add('b', b);
    hub.broadcast({ type: 'notice' });
    removeA();
    hub.broadcast({ type: 'notice' });
    expect(a.chunks).toHaveLength(1);
    expect(b.chunks).toHaveLength(2);
    expect(hub.connectedUsers()).toBe(1);
  });

  it('caps streams per user by ending the oldest', () => {
    const hub = new EventHub();
    const sinks = Array.from({ length: MAX_STREAMS_PER_USER + 1 }, sink);
    for (const s of sinks) hub.add('a', s);
    expect(sinks[0]!.ended()).toBe(true);
    hub.send(['a'], { type: 'call' });
    expect(sinks[0]!.chunks).toEqual([]);
    expect(sinks.slice(1).every((s) => s.chunks.length === 1)).toBe(true);
  });

  it('formats events with IDs only and ends every stream on closeAll', () => {
    expect(format({ type: 'call', id: 'x' })).toBe('event: call\ndata: {"id":"x"}\n\n');
    expect(format({ type: 'availability' })).toBe('event: availability\ndata: {}\n\n');
    const hub = new EventHub();
    const a = sink();
    hub.add('a', a);
    hub.closeAll();
    expect(a.ended()).toBe(true);
    expect(hub.connectedUsers()).toBe(0);
  });
});
