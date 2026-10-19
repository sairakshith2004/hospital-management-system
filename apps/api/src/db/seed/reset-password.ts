/**
 * Resets one staff account's password from the command line, for when nobody can sign in
 * to reset it in the app (for example the only administrator). Runs inside the caller's
 * transaction, as hms_app, whose existing grants cover it: the same update the admin
 * screen makes (new hash, lockout cleared), every session of that account ended, and a
 * user.password_reset audit row by the system actor.
 */
import type { Queryable } from '../client.js';
import { SYSTEM, recordAudit } from '../../lib/audit.js';
import { USERNAME_PATTERN } from './bootstrap-admin.js';

export class ResetPasswordError extends Error {
  override name = 'ResetPasswordError';
}

export interface ResetPasswordInput {
  username: string;
  /** Already hashed; the plain password never reaches this function. */
  passwordHash: string;
}

export async function resetPasswordByUsername(
  db: Queryable,
  { username, passwordHash }: ResetPasswordInput,
): Promise<{ userId: string; sessionsEnded: number }> {
  if (!USERNAME_PATTERN.test(username)) {
    throw new ResetPasswordError('That is not a valid username. Nothing was changed.');
  }
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM users WHERE username = $1 FOR UPDATE',
    [username],
  );
  const userId = rows[0]?.id;
  if (!userId)
    throw new ResetPasswordError(`No account "${username}" exists. Nothing was changed.`);

  await db.query(
    'UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL, updated_by = NULL WHERE id = $1',
    [userId, passwordHash],
  );
  const ended = await db.query("DELETE FROM sessions WHERE sess->>'userId' = $1", [userId]);
  await recordAudit(
    db,
    {
      actor: SYSTEM,
      action: 'user.password_reset',
      entityType: 'user',
      entityId: userId,
      reason: 'Reset from the command line (db:reset-password)',
    },
    { requestId: null, ip: null },
  );
  return { userId, sessionsEnded: ended.rowCount ?? 0 };
}
