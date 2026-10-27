/**
 * Staff managing their own password (docs/permissions.md note 1, 2026-10-27):
 *   - change it while signed in, by giving the current one;
 *   - reset a forgotten one through a one-time link emailed to the work email HR has on
 *     file. The link's secret is random (256 bits); only its SHA-256 fingerprint is stored.
 *     It works for PASSWORD_RESET_MINUTES, once, and asking again replaces earlier links.
 * "Forgot password" never says whether an account or email exists: the answer is the same
 * either way, and the email is sent in the background so timing reveals nothing either.
 * Setting a new password clears any lockout, ends the account's other sessions and is audited.
 */
import { createHash, randomBytes } from 'node:crypto';
import { PASSWORD_RESET_MINUTES } from '@hospitalos/shared';
import type { Logger } from 'pino';
import { withTransaction, type Database, type Queryable } from '../../db/client.js';
import { recordAudit, type AuditContext } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import type { Mailer } from '../../lib/mailer.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';

/** At most this many reset emails per account per hour (stops inbox flooding). */
const MAX_LINKS_PER_HOUR = 3;

const fingerprint = (token: string) => createHash('sha256').update(token).digest('hex');

const invalidLink = () =>
  new AppError(
    400,
    'INVALID_RESET_LINK',
    'This reset link is invalid, already used or expired. Ask for a new one.',
  );

export interface ResetMailOptions {
  mailer: Mailer | undefined;
  appUrl: string;
  logger: Logger;
}

/** Ends every session of the user except `keepSid` (the one changing the password). */
async function endSessions(tx: Queryable, userId: string, keepSid?: string) {
  await tx.query(
    `DELETE FROM sessions WHERE sess->>'userId' = $1 AND ($2::text IS NULL OR sid <> $2)`,
    [userId, keepSid ?? null],
  );
}

async function setPassword(tx: Queryable, userId: string, hash: string) {
  await tx.query(
    `UPDATE users SET password_hash = $2, must_change_password = false, failed_logins = 0,
            locked_until = NULL, updated_by = $1 WHERE id = $1`,
    [userId, hash],
  );
}

/**
 * Forgot password. `identifier` is a username or work email. Returns nothing whatever
 * happens; when an active account with an email matches, a link is emailed.
 */
export async function requestPasswordReset(
  db: Database,
  identifier: string,
  context: AuditContext,
  { mailer, appUrl, logger }: ResetMailOptions,
): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const sent = await withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ id: string; email: string; fullName: string }>(
      `SELECT u.id, e.email::text AS email, e.full_name AS "fullName"
         FROM users u JOIN employees e ON e.id = u.employee_id
        WHERE (u.username = $1 OR e.email = $1)
          AND u.status = 'active' AND NOT u.pending_approval
          AND e.email IS NOT NULL AND e.employment_status <> 'exited'
        FOR UPDATE OF u`,
      [identifier],
    );
    const user = rows[0];
    if (!user) return null;
    const { rows: recent } = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM password_reset_tokens
        WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
      [user.id],
    );
    if (recent[0]!.n >= MAX_LINKS_PER_HOUR) return null;
    // Asking again replaces any earlier link that hasn't been used.
    await tx.query(
      `UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
      [user.id],
    );
    await tx.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + make_interval(mins => $3))`,
      [user.id, fingerprint(token), PASSWORD_RESET_MINUTES],
    );
    await recordAudit(
      tx,
      {
        actor: { type: 'user', userId: user.id },
        action: 'user.password_reset_requested',
        entityType: 'user',
        entityId: user.id,
        changes: { emailConfigured: !!mailer },
      },
      context,
    );
    return user;
  });
  if (!sent) return;
  if (!mailer) {
    logger.warn('Password reset requested, but email (SMTP_URL) is not configured');
    return;
  }
  const link = `${appUrl.replace(/\/$/, '')}/reset-password?token=${token}`;
  // In the background, so the answer takes the same time whether or not an email goes out.
  void mailer
    .send({
      to: sent.email,
      subject: 'Reset your HospitalOS password',
      text: [
        `Hello ${sent.fullName},`,
        '',
        'Someone (hopefully you) asked to reset your HospitalOS password.',
        `Open this link within ${PASSWORD_RESET_MINUTES} minutes to choose a new one:`,
        '',
        link,
        '',
        'The link works once. If you did not ask for this, ignore this email: your password',
        'stays the same. Never share this link.',
      ].join('\n'),
    })
    .catch((err: unknown) => logger.error({ err }, 'Could not send the password-reset email'));
}

/** Sets a new password from a reset link. */
export async function resetPasswordWithLink(
  db: Database,
  token: string,
  password: string,
  context: AuditContext,
): Promise<void> {
  const hash = await hashPassword(password);
  await withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ id: string; userId: string }>(
      `SELECT t.id, t.user_id AS "userId"
         FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now()
          AND u.status = 'active' AND NOT u.pending_approval
        FOR UPDATE OF t, u`,
      [fingerprint(token)],
    );
    const link = rows[0];
    if (!link) throw invalidLink();
    await tx.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [link.id]);
    await setPassword(tx, link.userId, hash);
    await endSessions(tx, link.userId);
    await recordAudit(
      tx,
      {
        actor: { type: 'user', userId: link.userId },
        action: 'user.password_reset_by_link',
        entityType: 'user',
        entityId: link.userId,
      },
      context,
    );
  });
}

/** Signed in: replaces the password after checking the current one. */
export async function changeOwnPassword(
  db: Database,
  userId: string,
  sessionId: string,
  input: { currentPassword: string; newPassword: string },
  context: AuditContext,
): Promise<void> {
  const { rows } = await db.query<{ hash: string }>(
    'SELECT password_hash AS hash FROM users WHERE id = $1',
    [userId],
  );
  if (!rows[0] || !(await verifyPassword(rows[0].hash, input.currentPassword)))
    throw new AppError(400, 'WRONG_PASSWORD', 'Your current password is not correct.');
  const hash = await hashPassword(input.newPassword);
  await withTransaction(db, async (tx) => {
    await setPassword(tx, userId, hash);
    await endSessions(tx, userId, sessionId);
    await recordAudit(
      tx,
      {
        actor: { type: 'user', userId },
        action: 'user.password_changed',
        entityType: 'user',
        entityId: userId,
      },
      context,
    );
  });
}
