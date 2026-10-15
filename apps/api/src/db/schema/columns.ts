import { sql, type SQL } from 'drizzle-orm';
import { customType, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

/** Case-insensitive text. The citext extension is installed by the Docker init script. */
export const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/**
 * created_at / updated_at / created_by / updated_by for every mutable table (ERD §2).
 * The actor columns are nullable: seed and bootstrap rows have no acting user.
 * updated_at is maintained by the set_updated_at trigger (migration 0001).
 */
export function auditColumns(userId: () => AnyPgColumn) {
  return {
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(userId, { onDelete: 'restrict' }),
    updatedBy: uuid('updated_by').references(userId, { onDelete: 'restrict' }),
  };
}

/** `column IN ('a', 'b')` for a CHECK constraint. Values are code constants, never input. */
export function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} IN (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`;
}
