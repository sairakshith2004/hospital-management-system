/**
 * The one way the application writes audit_logs (ADR 0011). Rows record who did what to
 * which entity, with reason codes and field names; never values that could be sensitive.
 * Callers pass the transaction that makes the change, so the audit row commits or rolls
 * back with it (fail closed).
 */
import type { Request, Response } from 'express';
import type { Queryable } from '../db/client.js';
import { getRequestId } from '../middleware/request-id.js';

export type Actor = { type: 'user'; userId: string } | { type: 'system' };

export const SYSTEM: Actor = { type: 'system' };

type ChangeValue = string | number | boolean | null | string[];

export interface AuditEntry {
  actor: Actor;
  /** dotted lower-case, e.g. auth.login_failed */
  action: string;
  entityType: string;
  entityId?: string | null;
  patientId?: string | null;
  reason?: string | null;
  /** Field names, reason codes and similar. Never passwords, tokens or patient values. */
  changes?: Record<string, ChangeValue>;
}

export interface AuditContext {
  requestId: string | null;
  ip: string | null;
}

const ACTION = /^[a-z_]+(\.[a-z_]+)+$/;
const FORBIDDEN_KEY = /password|hash|token|secret|cookie|session|sid|csrf/i;

export class AuditEntryError extends Error {
  override name = 'AuditEntryError';
}

/** Rejects entries that could leak secrets. A programming error, so it throws. */
export function validateAuditEntry(entry: AuditEntry): void {
  if (!ACTION.test(entry.action))
    throw new AuditEntryError(`Invalid audit action: ${entry.action}`);
  for (const key of Object.keys(entry.changes ?? {})) {
    if (FORBIDDEN_KEY.test(key)) {
      throw new AuditEntryError(`Audit changes must not include "${key}"`);
    }
  }
}

export function auditContext(req: Request, res: Response): AuditContext {
  return { requestId: getRequestId(res) || null, ip: req.ip ?? null };
}

export async function recordAudit(
  db: Queryable,
  entry: AuditEntry,
  context: AuditContext,
): Promise<void> {
  validateAuditEntry(entry);
  await db.query(
    `INSERT INTO audit_logs
       (actor_type, actor_user_id, action, entity_type, entity_id, patient_id, reason,
        changes, request_id, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      entry.actor.type,
      entry.actor.type === 'user' ? entry.actor.userId : null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.patientId ?? null,
      entry.reason ?? null,
      entry.changes === undefined ? null : JSON.stringify(entry.changes),
      context.requestId,
      context.ip,
    ],
  );
}
