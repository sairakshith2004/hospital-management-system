import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, smallint, text, time } from 'drizzle-orm/pg-core';
import { auditColumns } from './columns.js';
import { users } from './identity.js';

/** The single settings row (ERD §3.1, "Defaults in hospital_settings"). Seeded in Step 4. */
export const hospitalSettings = pgTable(
  'hospital_settings',
  {
    id: smallint('id').primaryKey().default(1),
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    currency: text('currency').notNull().default('INR'),
    discountLimitBp: integer('discount_limit_bp').notNull().default(1000),
    nearExpiryDays: integer('near_expiry_days').notNull().default(30),
    careWindowBeforeDays: integer('care_window_before_days').notNull().default(7),
    careWindowAfterDays: integer('care_window_after_days').notNull().default(90),
    breakGlassHours: integer('break_glass_hours').notNull().default(4),
    breakGlassAlertThreshold: integer('break_glass_alert_threshold').notNull().default(3),
    followUpGraceDays: integer('follow_up_grace_days').notNull().default(7),
    prescriptionValidityDays: integer('prescription_validity_days').notNull().default(30),
    dayCloseTime: time('day_close_time').notNull().default('23:30'),
    dayCloseEnabled: boolean('day_close_enabled').notNull().default(true),
    returnWindowDays: integer('return_window_days').notNull().default(7),
    coldChainRestockPolicyRef: text('cold_chain_restock_policy_ref'),
    ...auditColumns(() => users.id),
  },
  (t) => [
    check('hospital_settings_single_row', sql`${t.id} = 1`),
    check('hospital_settings_name_not_blank', sql`length(trim(${t.name})) > 0`),
    check('hospital_settings_currency_format', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('hospital_settings_discount_limit_range', sql`${t.discountLimitBp} BETWEEN 0 AND 10000`),
    check(
      'hospital_settings_day_counts_non_negative',
      sql`${t.nearExpiryDays} >= 0 AND ${t.careWindowBeforeDays} >= 0
        AND ${t.careWindowAfterDays} >= 0 AND ${t.followUpGraceDays} >= 0
        AND ${t.prescriptionValidityDays} >= 0 AND ${t.returnWindowDays} >= 0`,
    ),
    check('hospital_settings_break_glass_hours_positive', sql`${t.breakGlassHours} > 0`),
    check('hospital_settings_alert_threshold_positive', sql`${t.breakGlassAlertThreshold} >= 1`),
  ],
);
