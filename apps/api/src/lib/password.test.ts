import { describe, expect, it } from 'vitest';
import { dummyHash, hashPassword, verifyPassword } from './password.js';

// Synthetic values only.
const PASSWORD = 'Synthetic-Passw0rd-123';

describe('password hashing', () => {
  it('uses argon2id with 19 MiB, 2 passes and 1 lane, salted per hash', async () => {
    const a = await hashPassword(PASSWORD);
    const b = await hashPassword(PASSWORD);
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain(PASSWORD);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await hashPassword(PASSWORD);
    expect(await verifyPassword(stored, PASSWORD)).toBe(true);
    expect(await verifyPassword(stored, `${PASSWORD}x`)).toBe(false);
  });

  it('treats a malformed stored hash as a mismatch instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', PASSWORD)).toBe(false);
  });

  it('has a dummy hash that no guess matches, computed once', async () => {
    expect(dummyHash()).toBe(dummyHash());
    expect(await verifyPassword(await dummyHash(), PASSWORD)).toBe(false);
    expect(await verifyPassword(await dummyHash(), '')).toBe(false);
  });
});
