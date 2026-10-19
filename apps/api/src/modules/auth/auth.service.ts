/**
 * Credential checks. Every failure looks the same to the caller (one generic 401); the
 * real reason is recorded only in the audit log. For unknown usernames not even the
 * attempted name is stored, because people sometimes type a password there.
 */
import { withTransaction, type Database } from '../../db/client.js';
import { SYSTEM, recordAudit, type AuditContext } from '../../lib/audit.js';
import { dummyHash, verifyPassword } from '../../lib/password.js';
import { clearFailedLogins, findLoginCandidate, recordFailedLogin } from './auth.repo.js';
import type { LoginBody } from './auth.schemas.js';

export type FailureReason = 'unknown_user' | 'inactive' | 'locked' | 'bad_password' | 'pending';

export type AuthenticateResult =
  { ok: true; userId: string } | { ok: false; reason: FailureReason };

export async function authenticate(
  db: Database,
  { username, password }: LoginBody,
  context: AuditContext,
): Promise<AuthenticateResult> {
  const candidate = await findLoginCandidate(db, username);

  let reason: FailureReason | undefined;
  if (!candidate) reason = 'unknown_user';
  else if (candidate.status !== 'active' && !candidate.pendingApproval) reason = 'inactive';
  else if (candidate.locked) reason = 'locked';

  if (reason || !candidate) {
    // Same work as a real check, so timing doesn't reveal which accounts exist.
    await verifyPassword(await dummyHash(), password);
    await recordAudit(
      db,
      {
        actor: SYSTEM,
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: candidate?.id ?? null,
        reason: reason ?? 'unknown_user',
      },
      context,
    );
    return { ok: false, reason: reason ?? 'unknown_user' };
  }

  if (!(await verifyPassword(candidate.passwordHash, password))) {
    await withTransaction(db, async (tx) => {
      const locked = await recordFailedLogin(tx, candidate.id);
      const base = { actor: SYSTEM, entityType: 'user', entityId: candidate.id };
      await recordAudit(
        tx,
        { ...base, action: 'auth.login_failed', reason: 'bad_password' },
        context,
      );
      if (locked) await recordAudit(tx, { ...base, action: 'auth.locked' }, context);
    });
    return { ok: false, reason: 'bad_password' };
  }

  if (candidate.pendingApproval) {
    // The password is right, so it is safe to say why they can't sign in yet.
    await recordAudit(
      db,
      {
        actor: SYSTEM,
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: candidate.id,
        reason: 'pending',
      },
      context,
    );
    return { ok: false, reason: 'pending' };
  }

  await clearFailedLogins(db, candidate.id);
  return { ok: true, userId: candidate.id };
}
