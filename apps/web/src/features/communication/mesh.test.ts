import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeshCall } from './mesh';

/** Just enough of RTCPeerConnection to follow the offer/answer state machine. */
class FakePC {
  static all: FakePC[] = [];
  signalingState: RTCSignalingState = 'stable';
  localDescription: { type: string; sdp: string; toJSON(): object } | null = null;
  remoteDescription: object | null = null;
  connectionState = 'new';
  ontrack: ((e: unknown) => void) | null = null;
  onicecandidate: ((e: unknown) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  added: string[] = [];
  closed = false;
  candidates: object[] = [];
  constructor() {
    FakePC.all.push(this);
  }
  addTrack(track: { kind: string }) {
    this.added.push(`track:${track.kind}`);
  }
  addTransceiver(kind: string) {
    this.added.push(`transceiver:${kind}`);
  }
  async createOffer() {
    return { type: 'offer', sdp: 'o' };
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'a' };
  }
  async setLocalDescription(d?: { type: string; sdp: string }) {
    const desc = d ?? { type: 'answer', sdp: 'a' };
    this.localDescription = { ...desc, toJSON: () => ({ type: desc.type, sdp: desc.sdp }) };
    this.signalingState = desc.type === 'offer' ? 'have-local-offer' : 'stable';
  }
  async setRemoteDescription(d: { type: string }) {
    this.remoteDescription = d;
    this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable';
  }
  async addIceCandidate(c: object) {
    this.candidates.push(c);
  }
  getTransceivers() {
    return [];
  }
  close() {
    this.closed = true;
  }
}

beforeEach(() => {
  FakePC.all = [];
  vi.stubGlobal('RTCPeerConnection', FakePC);
  vi.stubGlobal(
    'MediaStream',
    class {
      constructor(readonly tracks: unknown[] = []) {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

function call(me: string) {
  const sent: { to: string; kind: string }[] = [];
  const remote: Record<string, unknown> = {};
  const mesh = new MeshCall({
    me,
    local: null,
    send: async (to, kind) => {
      sent.push({ to, kind });
    },
    onRemote: (id, s) => {
      remote[id] = s;
    },
  });
  return { mesh, sent, remote };
}

describe('MeshCall', () => {
  it('sends an offer to people already in the meeting, with audio and video slots even without a camera', async () => {
    const a = call('a');
    await a.mesh.connectTo('b');
    expect(a.sent).toEqual([{ to: 'b', kind: 'offer' }]);
    expect(FakePC.all[0]!.added).toEqual(['transceiver:audio', 'transceiver:video']);
  });

  it('answers an offer, holding early ICE candidates until the offer arrives', async () => {
    const b = call('b');
    await b.mesh.handle('a', 'ice', { candidate: 'c1' });
    expect(FakePC.all[0]!.candidates).toEqual([]);
    await b.mesh.handle('a', 'offer', { type: 'offer', sdp: 'o' });
    expect(b.sent).toEqual([{ to: 'a', kind: 'answer' }]);
    expect(FakePC.all[0]!.candidates).toEqual([{ candidate: 'c1' }]);
  });

  it('settles offers sent both ways at once: the larger ID gives way', async () => {
    const small = call('a');
    await small.mesh.connectTo('b');
    await small.mesh.handle('b', 'offer', { type: 'offer', sdp: 'o' });
    // 'a' is impolite: it ignores b's offer and waits for b to answer its own.
    expect(small.sent).toEqual([{ to: 'b', kind: 'offer' }]);

    FakePC.all = [];
    const large = call('b');
    await large.mesh.connectTo('a');
    await large.mesh.handle('a', 'offer', { type: 'offer', sdp: 'o' });
    // 'b' is polite: it accepts a's offer and answers it.
    expect(large.sent.map((s) => s.kind)).toEqual(['offer', 'answer']);
  });

  it('closes the connection when someone leaves, and ignores stale answers', async () => {
    const a = call('a');
    await a.mesh.connectTo('b');
    await a.mesh.handle('b', 'leave');
    expect(FakePC.all[0]!.closed).toBe(true);
    expect(a.remote.b).toBeNull();
    expect(a.mesh.peerIds()).toEqual([]);
    await a.mesh.handle('c', 'answer', { type: 'answer', sdp: 'a' });
    expect(a.mesh.peerIds()).toEqual([]);
  });
});
