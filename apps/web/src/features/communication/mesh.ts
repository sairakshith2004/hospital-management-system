/**
 * Browser-to-browser video for a meeting: one RTCPeerConnection per other person ("mesh").
 *
 * Who calls whom: the person who joins sends an offer to everyone already in the meeting,
 * and those people answer. If two people happen to send offers to each other at the same
 * moment, the one with the larger user ID is "polite" and gives way (the standard
 * "perfect negotiation" rule), so the connection always settles.
 *
 * Every connection always has one audio and one video sender, even without a camera, so
 * switching between camera and screen share is a track swap with no renegotiation.
 */

export type SignalKind = 'offer' | 'answer' | 'ice';

export interface MeshOptions {
  me: string;
  local: MediaStream | null;
  /** Sends a signal to one person through the API. */
  send(to: string, kind: SignalKind, data: Record<string, unknown>): Promise<void>;
  /** A person's incoming media changed (null: they are gone). */
  onRemote(userId: string, stream: MediaStream | null): void;
  /** STUN/TURN servers. Empty works on one machine or one local network. */
  iceServers?: RTCIceServer[];
}

interface Peer {
  pc: RTCPeerConnection;
  tracks: MediaStreamTrack[];
  pendingIce: RTCIceCandidateInit[];
  makingOffer: boolean;
}

export class MeshCall {
  private readonly peers = new Map<string, Peer>();
  private videoTrack: MediaStreamTrack | null;
  private closed = false;

  constructor(private readonly opts: MeshOptions) {
    this.videoTrack = opts.local?.getVideoTracks()[0] ?? null;
  }

  peerIds(): string[] {
    return [...this.peers.keys()];
  }

  private create(userId: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.opts.iceServers ?? [] });
    const peer: Peer = { pc, tracks: [], pendingIce: [], makingOffer: false };
    const audio = this.opts.local?.getAudioTracks()[0] ?? null;
    const stream = this.opts.local ?? new MediaStream();
    if (audio) pc.addTrack(audio, stream);
    else pc.addTransceiver('audio', { direction: 'sendrecv' });
    if (this.videoTrack) pc.addTrack(this.videoTrack, stream);
    else pc.addTransceiver('video', { direction: 'sendrecv' });

    pc.ontrack = (e) => {
      peer.tracks = [...peer.tracks.filter((t) => t.kind !== e.track.kind), e.track];
      // A new MediaStream object each time, so React sees the change.
      this.opts.onRemote(userId, new MediaStream(peer.tracks));
    };
    pc.onicecandidate = (e) => {
      if (e.candidate)
        void this.opts.send(userId, 'ice', e.candidate.toJSON() as Record<string, unknown>);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.remove(userId);
    };
    this.peers.set(userId, peer);
    return peer;
  }

  /** Called by the person joining, once for everyone already in the meeting. */
  async connectTo(userId: string): Promise<void> {
    if (this.closed || userId === this.opts.me) return;
    const peer = this.peers.get(userId) ?? this.create(userId);
    try {
      peer.makingOffer = true;
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      await this.opts.send(
        userId,
        'offer',
        peer.pc.localDescription!.toJSON() as unknown as Record<string, unknown>,
      );
    } finally {
      peer.makingOffer = false;
    }
  }

  async handle(
    from: string,
    kind: SignalKind | 'leave',
    data?: Record<string, unknown>,
  ): Promise<void> {
    if (this.closed || from === this.opts.me) return;
    if (kind === 'leave') {
      this.remove(from);
      return;
    }
    let peer = this.peers.get(from);
    if (!peer) {
      // An answer for a connection we no longer have is stale; offers and early ICE start one.
      if (kind === 'answer') return;
      peer = this.create(from);
    }
    const { pc } = peer;

    if (kind === 'ice') {
      const candidate = data as RTCIceCandidateInit;
      if (pc.remoteDescription) await pc.addIceCandidate(candidate).catch(() => undefined);
      else peer.pendingIce.push(candidate);
      return;
    }

    const description = data as unknown as RTCSessionDescriptionInit;
    if (kind === 'offer') {
      const collision = peer.makingOffer || pc.signalingState !== 'stable';
      const polite = this.opts.me > from;
      if (collision && !polite) return; // The other side gives way and answers our offer.
      await pc.setRemoteDescription(description); // Rolls back our own offer if needed.
      await this.flushIce(peer);
      await pc.setLocalDescription(await pc.createAnswer());
      await this.opts.send(
        from,
        'answer',
        pc.localDescription!.toJSON() as unknown as Record<string, unknown>,
      );
      return;
    }
    if (pc.signalingState === 'have-local-offer') {
      await pc.setRemoteDescription(description);
      await this.flushIce(peer);
    }
  }

  private async flushIce(peer: Peer): Promise<void> {
    const queued = peer.pendingIce.splice(0);
    for (const c of queued) await peer.pc.addIceCandidate(c).catch(() => undefined);
  }

  /** Swaps what everyone sees from us: the camera, a shared screen, or nothing. */
  async replaceVideo(track: MediaStreamTrack | null): Promise<void> {
    this.videoTrack = track;
    await Promise.all(
      [...this.peers.values()].map((peer) => {
        const t = peer.pc.getTransceivers().find((x) => x.receiver.track.kind === 'video');
        return t?.sender.replaceTrack(track);
      }),
    );
  }

  remove(userId: string): void {
    const peer = this.peers.get(userId);
    if (!peer) return;
    this.peers.delete(userId);
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    this.opts.onRemote(userId, null);
  }

  close(): void {
    this.closed = true;
    for (const id of [...this.peers.keys()]) this.remove(id);
  }
}
