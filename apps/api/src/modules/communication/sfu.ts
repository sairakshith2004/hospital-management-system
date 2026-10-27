/**
 * The LiveKit media server ("SFU": each browser sends its video once and the server forwards
 * it), used for video meetings when configured. The API stays in charge of who may join:
 * it hands out a short-lived pass only after its own join checks pass, and closes the room
 * when the host ends the meeting.
 */
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

export interface Sfu {
  /** The address browsers connect to (ws:// or wss://). */
  url: string;
  /** A pass for one person to join one meeting's room, valid for a few minutes. */
  token(room: string, identity: string, name: string): Promise<string>;
  /** Disconnects everyone and closes the room (best effort). */
  closeRoom(room: string): Promise<void>;
}

/** How long a pass can be used to connect (the call itself can last longer). */
const PASS_TTL = '5m';

export function createLiveKitSfu(cfg: { url: string; apiKey: string; apiSecret: string }): Sfu {
  const rooms = new RoomServiceClient(cfg.url.replace(/^ws/, 'http'), cfg.apiKey, cfg.apiSecret);
  return {
    url: cfg.url,
    async token(room, identity, name) {
      const at = new AccessToken(cfg.apiKey, cfg.apiSecret, { identity, name, ttl: PASS_TTL });
      at.addGrant({
        room,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,
        roomCreate: false,
        roomAdmin: false,
      });
      return at.toJwt();
    },
    async closeRoom(room) {
      await rooms.deleteRoom(room).catch(() => undefined);
    },
  };
}
