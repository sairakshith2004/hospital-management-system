import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { oneOf } from './columns.js';
import { users } from './identity.js';

export const ACTOR_TYPES = ['user', 'system'] as const;

/**
 * Append-only (trigger in migration 0001); hms_app has SELECT and INSERT only.
 * patient_id and break_glass_grant_id get their foreign keys once patients (Day 6)
 * and break_glass_grants (Day 11) exist. `changes` holds field names, never
 * sensitive values (ERD §3.1).
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorType: text('actor_type').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    patientId: uuid('patient_id'),
    breakGlassGrantId: uuid('break_glass_grant_id'),
    requestId: text('request_id'),
    ip: inet('ip'),
    changes: jsonb('changes'),
    reason: text('reason'),
  },
  (t) => [
    check('audit_logs_actor_type_check', oneOf(t.actorType, ACTOR_TYPES)),
    check(
      'audit_logs_actor_matches_type',
      sql`(${t.actorType} = 'system') = (${t.actorUserId} IS NULL)`,
    ),
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    index('audit_logs_patient_idx').on(t.patientId, t.occurredAt),
    index('audit_logs_actor_idx').on(t.actorUserId, t.occurredAt),
    index('audit_logs_action_idx').on(t.action, t.occurredAt),
  ],
);
