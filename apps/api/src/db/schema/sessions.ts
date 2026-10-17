import { index, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * Login sessions (ADR 0004), read and written by connect-pg-simple through hms_app.
 * `sess` holds the user ID, the session start time and the CSRF token; never patient,
 * clinical or financial data. Rows are deleted at logout and once expired.
 */
export const sessions = pgTable(
  'sessions',
  {
    sid: varchar('sid').primaryKey(),
    sess: jsonb('sess').notNull(),
    expire: timestamp('expire', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_expire_idx').on(t.expire)],
);
