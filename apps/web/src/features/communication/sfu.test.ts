import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Just enough of livekit-client's Room to follow what SfuCall asks of it. */
const fake = vi.hoisted(() => ({
  rooms: [] as {
    handlers: Record<string, (...a: unknown[]) => void>;
    connected: [string, string] | null;
    published: [string, string][];
    replaced: string[];
    unpublished: string[];
    disconnected: boolean | null;
    camera: { track: { replaceTrack(t: { id: string }): Promise<void> } } | undefined;
  }[],
}));

vi.mock('livekit-client', () => {
  class Room {
    handlers: Record<string, (...a: unknown[]) => void> = {};
    connected: [string, string] | null = null;
    published: [string, string][] = [];
    replaced: string[] = [];
    unpublished: string[] = [];
    disconnected: boolean | null = null;
    camera: { track: { replaceTrack(t: { id: string }): Promise<void> } } | undefined;
    localParticipant = {
      publishTrack: async (t: { id: string }, o: { source: string }) => {
        this.published.push([t.id, o.source]);
        if (o.source === 'camera')
          this.camera = {
            track: {
              replaceTrack: async (n: { id: string }) => {
                this.replaced.push(n.id);
              },
            },
          };
      },
      unpublishTrack: async () => {
        this.unpublished.push('camera');
        this.camera = undefined;
      },
      getTrackPublication: () => this.camera,
    };
    constructor() {
      fake.rooms.push(this);
    }
    on(event: string, fn: (...a: unknown[]) => void) {
      this.handlers[event] = fn;
      return this;
    }
    async connect(url: string, token: string) {
      this.connected = [url, token];
    }
    async disconnect(stop: boolean) {
      this.disconnected = stop;
    }
  }
  return {
    Room,
    RoomEvent: {
      TrackSubscribed: 'trackSubscribed',
      TrackUnsubscribed: 'trackUnsubscribed',
      ParticipantDisconnected: 'participantDisconnected',
      Disconnected: 'disconnected',
    },
    Track: { Source: { Camera: 'camera', Microphone: 'microphone' } },
  };
});

const { SfuCall } = await import('./sfu');

const track = (id: string, kind: string) => ({ id, kind }) as unknown as MediaStreamTrack;
class FakeStream {
  constructor(readonly tracks: MediaStreamTrack[] = []) {}
  getTracks() {
    return this.tracks;
  }
}

beforeEach(() => {
  fake.rooms.length = 0;
  vi.stubGlobal('MediaStream', FakeStream);
});

describe('SfuCall (LiveKit)', () => {
  it('connects with the pass and sends the microphone and camera once', async () => {
    const call = new SfuCall({
      local: new FakeStream([
        track('mic', 'audio'),
        track('cam', 'video'),
      ]) as unknown as MediaStream,
      onRemote: () => undefined,
    });
    await call.connect('ws://127.0.0.1:7880', 'pass');
    const room = fake.rooms[0]!;
    expect(room.connected).toEqual(['ws://127.0.0.1:7880', 'pass']);
    expect(room.published).toEqual([
      ['mic', 'microphone'],
      ['cam', 'camera'],
    ]);
  });

  it('reports each person’s media by user ID, and when they leave', () => {
    const seen: [string, string[] | null][] = [];
    new SfuCall({
      local: null,
      onRemote: (id, s) =>
        seen.push([id, s ? (s as unknown as FakeStream).tracks.map((t) => t.id) : null]),
    });
    const room = fake.rooms[0]!;
    const doctor = {
      identity: 'user-2',
      trackPublications: new Map([
        ['a', { track: { mediaStreamTrack: track('a2', 'audio') } }],
        ['v', { track: { mediaStreamTrack: track('v2', 'video') } }],
      ]),
    };
    room.handlers.trackSubscribed!(null, null, doctor);
    room.handlers.participantDisconnected!(doctor);
    expect(seen).toEqual([
      ['user-2', ['a2', 'v2']],
      ['user-2', null],
    ]);
  });

  it('swaps camera and screen share without reconnecting, and leaves without stopping the camera', async () => {
    const call = new SfuCall({
      local: new FakeStream([track('cam', 'video')]) as unknown as MediaStream,
      onRemote: () => undefined,
    });
    await call.connect('ws://x', 'p');
    const room = fake.rooms[0]!;
    await call.replaceVideo(track('screen', 'video'));
    expect(room.replaced).toEqual(['screen']);
    await call.replaceVideo(null);
    expect(room.unpublished).toEqual(['camera']);
    await call.replaceVideo(track('cam', 'video'));
    expect(room.published.at(-1)).toEqual(['cam', 'camera']);
    call.close();
    expect(room.disconnected).toBe(false);
  });
});
