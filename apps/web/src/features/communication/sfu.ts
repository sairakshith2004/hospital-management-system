/**
 * Video through the LiveKit media server (used when the API returns a media-server pass on
 * join): each browser sends its camera and microphone once and the server forwards them, so
 * calls can be much larger than browser-to-browser ("mesh") calls. Same surface as MeshCall,
 * so the meeting room works the same either way.
 */
import { Room, RoomEvent, Track, type LocalTrack, type Participant } from 'livekit-client';

export interface SfuOptions {
  local: MediaStream | null;
  /** A person's incoming media changed (null: they are gone). Keyed by user ID. */
  onRemote(userId: string, stream: MediaStream | null): void;
  /** The connection to the media server was lost. */
  onDisconnected?(): void;
}

export class SfuCall {
  private readonly room = new Room({ adaptiveStream: true, dynacast: true });
  private readonly remote = new Map<string, MediaStreamTrack[]>();
  private closed = false;

  constructor(private readonly opts: SfuOptions) {
    const update = (p: Participant) => {
      const tracks = [...p.trackPublications.values()]
        .map((pub) => pub.track?.mediaStreamTrack)
        .filter((t): t is MediaStreamTrack => !!t);
      this.remote.set(p.identity, tracks);
      // A new MediaStream object each time, so React sees the change.
      opts.onRemote(p.identity, new MediaStream(tracks));
    };
    this.room
      .on(RoomEvent.TrackSubscribed, (_t, _pub, p) => update(p))
      .on(RoomEvent.TrackUnsubscribed, (_t, _pub, p) => update(p))
      .on(RoomEvent.ParticipantDisconnected, (p) => {
        this.remote.delete(p.identity);
        opts.onRemote(p.identity, null);
      })
      .on(RoomEvent.Disconnected, () => {
        if (!this.closed) opts.onDisconnected?.();
      });
  }

  async connect(url: string, token: string): Promise<void> {
    await this.room.connect(url, token);
    for (const track of this.opts.local?.getTracks() ?? []) {
      await this.room.localParticipant.publishTrack(track, {
        source: track.kind === 'audio' ? Track.Source.Microphone : Track.Source.Camera,
      });
    }
  }

  /** Switches what others see (camera ↔ screen share); null stops sending video. */
  async replaceVideo(track: MediaStreamTrack | null): Promise<void> {
    const current = this.room.localParticipant.getTrackPublication(Track.Source.Camera)?.track as
      LocalTrack | undefined;
    if (current && track) await current.replaceTrack(track, true);
    else if (current) await this.room.localParticipant.unpublishTrack(current, false);
    else if (track)
      await this.room.localParticipant.publishTrack(track, { source: Track.Source.Camera });
  }

  close(): void {
    this.closed = true;
    // The meeting room stops its own camera and microphone.
    void this.room.disconnect(false);
  }
}
