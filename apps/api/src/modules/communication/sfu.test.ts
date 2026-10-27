import { TokenVerifier } from 'livekit-server-sdk';
import { describe, expect, it } from 'vitest';
import { createLiveKitSfu } from './sfu.js';

// Synthetic test credentials only.
const cfg = { url: 'ws://127.0.0.1:7880', apiKey: 'zzkey', apiSecret: 'z'.repeat(40) };

describe('LiveKit passes', () => {
  it('lets one person join one room only, without admin rights, for a few minutes', async () => {
    const jwt = await createLiveKitSfu(cfg).token('meeting-1', 'user-1', 'Zz Doctor');
    const claims = await new TokenVerifier(cfg.apiKey, cfg.apiSecret).verify(jwt);
    expect(claims.sub).toBe('user-1');
    expect(claims.name).toBe('Zz Doctor');
    expect(claims.video).toMatchObject({
      room: 'meeting-1',
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      roomAdmin: false,
      roomCreate: false,
    });
    expect(claims.exp! - claims.nbf!).toBeLessThanOrEqual(5 * 60);
  });

  it('is rejected when signed with another secret', async () => {
    const jwt = await createLiveKitSfu(cfg).token('meeting-1', 'user-1', 'Zz');
    await expect(new TokenVerifier(cfg.apiKey, 'y'.repeat(40)).verify(jwt)).rejects.toThrow();
  });
});
