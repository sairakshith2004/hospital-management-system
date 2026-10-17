import { randomBytes } from 'node:crypto';
import { hash, verify, type Algorithm, type Options } from '@node-rs/argon2';

/** argon2id with OWASP's recommended minimum: 19 MiB memory, 2 passes, 1 lane. */
const OPTIONS: Options = {
  algorithm: 2 as Algorithm, // Algorithm.Argon2id (a const enum, so not importable at runtime)
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/** Rules for passwords that are being set. Login accepts any 1–256 characters. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

/** True only for a matching password. A malformed stored hash counts as a mismatch. */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;

/**
 * A hash of a random value nobody knows. Login verifies against it when there is no
 * usable account, so the response takes as long as a real password check.
 */
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(32).toString('hex'));
  return dummy;
}
