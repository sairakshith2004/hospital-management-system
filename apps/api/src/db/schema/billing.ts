/**
 * Service prices, the laboratory and billing (ERD §3.6–3.7, MVP). Lab and billing share a
 * file because invoice lines reference lab orders and lab tests reference prices.
 * Invoice totals are recomputed by the billing service under a row lock and checked by
 * CHECK constraints; payments are append-only (triggers and grants are hand-written).
 */
import {
  ABNORMAL_FLAGS,
  INVOICE_SOURCE_TYPES,
  INVOICE_STATUSES,
  LAB_ORDER_STATUSES,
  LAB_PRIORITIES,
  PAYMENT_METHODS,
  SERVICE_KINDS,
} from '@hospitalos/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { dispensingLines, encounters } from './clinical.js';
import { auditColumns, oneOf } from './columns.js';
import { departments, users } from './identity.js';
import { patients } from './patients.js';
import { appointments } from './scheduling.js';

const userId = () => users.id;

export const serviceCatalogue = pgTable(
  'service_catalogue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique('service_catalogue_code_key'),
    name: text('name').notNull(),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    pricePaise: bigint('price_paise', { mode: 'number' }).notNull(),
    active: boolean('active').notNull().default(true),
    ...auditColumns(userId),
  },
  (t) => [
    check('service_catalogue_kind_check', oneOf(t.kind, SERVICE_KINDS)),
    check('service_catalogue_price_non_negative', sql`${t.pricePaise} >= 0`),
  ],
);

export const labTests = pgTable(
  'lab_tests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique('lab_tests_code_key'),
    name: text('name').notNull(),
    sampleType: text('sample_type').notNull(),
    serviceId: uuid('service_id')
      .notNull()
      .unique('lab_tests_service_id_key')
      .references(() => serviceCatalogue.id, { onDelete: 'restrict' }),
    turnaroundHours: integer('turnaround_hours').notNull(),
    active: boolean('active').notNull().default(true),
    ...auditColumns(userId),
  },
  (t) => [check('lab_tests_turnaround', sql`${t.turnaroundHours} BETWEEN 1 AND 720`)],
);

export const labTestParameters = pgTable(
  'lab_test_parameters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    testId: uuid('test_id')
      .notNull()
      .references(() => labTests.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    unit: text('unit'),
    refLow: numeric('ref_low', { precision: 12, scale: 4 }),
    refHigh: numeric('ref_high', { precision: 12, scale: 4 }),
    refText: text('ref_text'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    unique('lab_test_parameters_test_name_key').on(t.testId, t.name),
    unique('lab_test_parameters_id_test_key').on(t.id, t.testId),
    check(
      'lab_test_parameters_ref_order',
      sql`${t.refLow} IS NULL OR ${t.refHigh} IS NULL OR ${t.refLow} <= ${t.refHigh}`,
    ),
  ],
);

export const labOrderNoSeq = pgSequence('lab_order_no_seq', {
  startWith: 1,
  increment: 1,
  minValue: 1,
  maxValue: 9_999_999,
  cycle: false,
});

export const labOrders = pgTable(
  'lab_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderNo: text('order_no')
      .notNull()
      .unique('lab_orders_order_no_key')
      .default(sql`('LAB' || lpad(nextval('lab_order_no_seq')::text, 7, '0'))`),
    encounterId: uuid('encounter_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    testId: uuid('test_id')
      .notNull()
      .references(() => labTests.id, { onDelete: 'restrict' }),
    orderedBy: uuid('ordered_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    priority: text('priority').notNull().default('routine'),
    status: text('status').notNull().default('ordered'),
    clinicalNotes: text('clinical_notes'),
    sampleBarcode: text('sample_barcode').unique('lab_orders_sample_barcode_key'),
    collectedBy: uuid('collected_by').references(() => users.id, { onDelete: 'restrict' }),
    collectedAt: timestamp('collected_at', { withTimezone: true }),
    resultedBy: uuid('resulted_by').references(() => users.id, { onDelete: 'restrict' }),
    resultedAt: timestamp('resulted_at', { withTimezone: true }),
    verifiedBy: uuid('verified_by').references(() => users.id, { onDelete: 'restrict' }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by').references(() => users.id, { onDelete: 'restrict' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    ...auditColumns(userId),
  },
  (t) => [
    unique('lab_orders_id_test_key').on(t.id, t.testId),
    foreignKey({
      name: 'lab_orders_encounter_fk',
      columns: [t.encounterId, t.patientId],
      foreignColumns: [encounters.id, encounters.patientId],
    }).onDelete('restrict'),
    index('lab_orders_status_idx').on(t.status, t.createdAt),
    index('lab_orders_patient_idx').on(t.patientId),
    check('lab_orders_status_check', oneOf(t.status, LAB_ORDER_STATUSES)),
    check('lab_orders_priority_check', oneOf(t.priority, LAB_PRIORITIES)),
    check(
      'lab_orders_verifier_not_enterer',
      sql`${t.verifiedBy} IS NULL OR ${t.verifiedBy} <> ${t.resultedBy}`,
    ),
    check(
      'lab_orders_fields_match_status',
      sql`(${t.status} IN ('collected', 'resulted', 'verified')) <= (${t.collectedAt} IS NOT NULL)
        AND (${t.status} IN ('resulted', 'verified')) <= (${t.resultedAt} IS NOT NULL)
        AND (${t.status} = 'verified') = (${t.verifiedAt} IS NOT NULL)
        AND (${t.status} = 'cancelled') = (${t.cancelledAt} IS NOT NULL)
        AND (${t.status} <> 'cancelled' OR length(trim(coalesce(${t.cancelReason}, ''))) > 0)`,
    ),
  ],
);

/** A corrected value supersedes the old one; old values are kept (is_current = false). */
export const labResults = pgTable(
  'lab_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').notNull(),
    testId: uuid('test_id').notNull(),
    parameterId: uuid('parameter_id').notNull(),
    valueNum: numeric('value_num', { precision: 14, scale: 4 }),
    valueText: text('value_text'),
    unit: text('unit'),
    refLow: numeric('ref_low', { precision: 12, scale: 4 }),
    refHigh: numeric('ref_high', { precision: 12, scale: 4 }),
    refText: text('ref_text'),
    abnormalFlag: text('abnormal_flag'),
    enteredBy: uuid('entered_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    enteredAt: timestamp('entered_at', { withTimezone: true }).notNull().defaultNow(),
    isCurrent: boolean('is_current').notNull().default(true),
  },
  (t) => [
    foreignKey({
      name: 'lab_results_order_fk',
      columns: [t.orderId, t.testId],
      foreignColumns: [labOrders.id, labOrders.testId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'lab_results_parameter_fk',
      columns: [t.parameterId, t.testId],
      foreignColumns: [labTestParameters.id, labTestParameters.testId],
    }).onDelete('restrict'),
    uniqueIndex('lab_results_current_key')
      .on(t.orderId, t.parameterId)
      .where(sql`${t.isCurrent}`),
    check(
      'lab_results_has_value',
      sql`${t.valueNum} IS NOT NULL OR length(trim(coalesce(${t.valueText}, ''))) > 0`,
    ),
    check(
      'lab_results_flag_check',
      sql`${t.abnormalFlag} IS NULL OR ${oneOf(t.abnormalFlag, ABNORMAL_FLAGS)}`,
    ),
  ],
);

/** Gapless, per-year document numbers (invoices, receipts), allocated under a row lock. */
export const documentCounters = pgTable(
  'document_counters',
  {
    docType: text('doc_type').notNull(),
    fiscalYear: integer('fiscal_year').notNull(),
    nextValue: integer('next_value').notNull().default(1),
  },
  (t) => [
    primaryKey({ name: 'document_counters_pkey', columns: [t.docType, t.fiscalYear] }),
    check('document_counters_next_positive', sql`${t.nextValue} >= 1`),
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Assigned when the invoice is issued (gapless per year), e.g. INV-2026-000001. */
    invoiceNo: text('invoice_no').unique('invoices_invoice_no_key'),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    appointmentId: uuid('appointment_id'),
    status: text('status').notNull().default('draft'),
    subtotalPaise: bigint('subtotal_paise', { mode: 'number' }).notNull().default(0),
    discountPaise: bigint('discount_paise', { mode: 'number' }).notNull().default(0),
    taxPaise: bigint('tax_paise', { mode: 'number' }).notNull().default(0),
    totalPaise: bigint('total_paise', { mode: 'number' }).notNull().default(0),
    paidPaise: bigint('paid_paise', { mode: 'number' }).notNull().default(0),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    issuedBy: uuid('issued_by').references(() => users.id, { onDelete: 'restrict' }),
    voidReason: text('void_reason'),
    version: integer('version').notNull().default(1),
    ...auditColumns(userId),
  },
  (t) => [
    unique('invoices_id_patient_key').on(t.id, t.patientId),
    foreignKey({
      name: 'invoices_appointment_fk',
      columns: [t.appointmentId, t.patientId],
      foreignColumns: [appointments.id, appointments.patientId],
    }).onDelete('restrict'),
    uniqueIndex('invoices_one_draft_per_visit_key')
      .on(t.appointmentId)
      .where(sql`${t.status} = 'draft'`),
    index('invoices_status_idx').on(t.status, t.createdAt),
    index('invoices_patient_idx').on(t.patientId),
    check('invoices_status_check', oneOf(t.status, INVOICE_STATUSES)),
    check(
      'invoices_total_arithmetic',
      sql`${t.totalPaise} = ${t.subtotalPaise} - ${t.discountPaise} + ${t.taxPaise}`,
    ),
    check(
      'invoices_amounts_non_negative',
      sql`${t.subtotalPaise} >= 0 AND ${t.discountPaise} >= 0 AND ${t.taxPaise} >= 0 AND ${t.totalPaise} >= 0`,
    ),
    check('invoices_paid_range', sql`${t.paidPaise} BETWEEN 0 AND ${t.totalPaise}`),
    check('invoices_number_when_issued', sql`(${t.status} = 'draft') = (${t.invoiceNo} IS NULL)`),
    check('invoices_issued_fields', sql`(${t.status} = 'draft') = (${t.issuedAt} IS NULL)`),
    check(
      'invoices_paid_matches_status',
      sql`${t.status} NOT IN ('draft', 'void') OR ${t.paidPaise} = 0`,
    ),
    check(
      'invoices_void_reason',
      sql`${t.status} <> 'void' OR length(trim(coalesce(${t.voidReason}, ''))) > 0`,
    ),
  ],
);

export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    serviceId: uuid('service_id').references(() => serviceCatalogue.id, { onDelete: 'restrict' }),
    description: text('description').notNull(),
    sourceType: text('source_type').notNull(),
    consultationAppointmentId: uuid('consultation_appointment_id').references(
      () => appointments.id,
      {
        onDelete: 'restrict',
      },
    ),
    dispensingLineId: uuid('dispensing_line_id').references(() => dispensingLines.id, {
      onDelete: 'restrict',
    }),
    labOrderId: uuid('lab_order_id').references(() => labOrders.id, { onDelete: 'restrict' }),
    qty: integer('qty').notNull(),
    /** Copied from the price list when the line is added; later price changes don't alter it. */
    unitPricePaise: bigint('unit_price_paise', { mode: 'number' }).notNull(),
    lineTotalPaise: bigint('line_total_paise', { mode: 'number' }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    unique('invoice_items_id_invoice_key').on(t.id, t.invoiceId),
    index('invoice_items_invoice_idx').on(t.invoiceId),
    uniqueIndex('invoice_items_consultation_active_key')
      .on(t.consultationAppointmentId)
      .where(sql`${t.isActive} AND ${t.consultationAppointmentId} IS NOT NULL`),
    uniqueIndex('invoice_items_dispensing_active_key')
      .on(t.dispensingLineId)
      .where(sql`${t.isActive} AND ${t.dispensingLineId} IS NOT NULL`),
    uniqueIndex('invoice_items_lab_active_key')
      .on(t.labOrderId)
      .where(sql`${t.isActive} AND ${t.labOrderId} IS NOT NULL`),
    check('invoice_items_source_check', oneOf(t.sourceType, INVOICE_SOURCE_TYPES)),
    check('invoice_items_qty_positive', sql`${t.qty} > 0`),
    check('invoice_items_price_non_negative', sql`${t.unitPricePaise} >= 0`),
    check(
      'invoice_items_line_arithmetic',
      sql`${t.lineTotalPaise} = ${t.qty} * ${t.unitPricePaise}`,
    ),
    check(
      'invoice_items_typed_source',
      sql`CASE ${t.sourceType}
        WHEN 'consultation' THEN ${t.consultationAppointmentId} IS NOT NULL AND ${t.dispensingLineId} IS NULL AND ${t.labOrderId} IS NULL
        WHEN 'dispensing' THEN ${t.dispensingLineId} IS NOT NULL AND ${t.consultationAppointmentId} IS NULL AND ${t.labOrderId} IS NULL
        WHEN 'lab' THEN ${t.labOrderId} IS NOT NULL AND ${t.consultationAppointmentId} IS NULL AND ${t.dispensingLineId} IS NULL
        ELSE ${t.labOrderId} IS NULL AND ${t.consultationAppointmentId} IS NULL AND ${t.dispensingLineId} IS NULL
      END`,
    ),
  ],
);

/** Append-only. */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    receiptNo: text('receipt_no').notNull().unique('payments_receipt_no_key'),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    method: text('method').notNull(),
    reference: text('reference'),
    idempotencyKey: text('idempotency_key').notNull().unique('payments_idempotency_key_key'),
    receivedBy: uuid('received_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('payments_invoice_idx').on(t.invoiceId),
    index('payments_received_idx').on(t.receivedAt),
    check('payments_amount_positive', sql`${t.amountPaise} > 0`),
    check('payments_method_check', oneOf(t.method, PAYMENT_METHODS)),
  ],
);
