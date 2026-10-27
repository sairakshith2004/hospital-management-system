import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from './schema/index.js';

const tables = (Object.values(schema) as unknown[]).filter(
  (v): v is PgTable => v instanceof PgTable,
);
const configs = new Map(tables.map((t) => [getTableConfig(t).name, getTableConfig(t)]));
const columnsOf = (name: string) => configs.get(name)?.columns.map((c) => c.name) ?? [];

const CASCADE = new Set([
  'user_roles.user_id',
  'user_roles.role_id',
  'role_permissions.role_id',
  'role_permissions.permission_id',
]);
const MUTABLE = [
  'hospital_settings',
  'departments',
  'employees',
  'users',
  'roles',
  'patients',
  'doctor_profiles',
  'doctor_schedules',
  'schedule_exceptions',
  'appointments',
  'locations',
  'ingredients',
  'stock_items',
  'medicine_products',
  'stock_batches',
  'suppliers',
  'encounters',
  'allergies',
  'follow_ups',
  'prescriptions',
  'service_catalogue',
  'lab_tests',
  'lab_orders',
  'invoices',
  'attendance',
  'leave_requests',
  'expense_categories',
  'expenses',
  'equipment',
  'referral_sources',
  'campaigns',
  'enquiries',
];

describe('database schema', () => {
  it('defines exactly the expected tables', () => {
    expect([...configs.keys()].sort()).toEqual([
      'allergies',
      'appointments',
      'attendance',
      'audit_logs',
      'call_requests',
      'campaigns',
      'clinical_notes',
      'conversation_members',
      'conversations',
      'departments',
      'diagnoses',
      'dispensing_lines',
      'dispensings',
      'doctor_availability',
      'doctor_profiles',
      'doctor_schedules',
      'document_counters',
      'employees',
      'encounters',
      'enquiries',
      'enquiry_follow_ups',
      'equipment',
      'expense_categories',
      'expenses',
      'follow_ups',
      'goods_receipts',
      'grn_lines',
      'hospital_settings',
      'ingredients',
      'invoice_items',
      'invoices',
      'lab_orders',
      'lab_results',
      'lab_test_parameters',
      'lab_tests',
      'leave_requests',
      'locations',
      'maintenance_logs',
      'medicine_products',
      'meeting_participants',
      'meetings',
      'messages',
      'notice_reads',
      'notices',
      'patients',
      'payments',
      'permissions',
      'prescription_items',
      'prescriptions',
      'product_ingredients',
      'referral_sources',
      'role_permissions',
      'roles',
      'schedule_exceptions',
      'service_catalogue',
      'sessions',
      'stock_batches',
      'stock_items',
      'stock_movements',
      'stock_transfer_lines',
      'stock_transfers',
      'suppliers',
      'user_roles',
      'users',
      'vital_signs',
    ]);
  });

  it('uses ON DELETE RESTRICT everywhere except the four join-table assignment keys', () => {
    let cascades = 0;
    for (const { name, foreignKeys } of configs.values()) {
      for (const fk of foreignKeys) {
        const column = `${name}.${fk.reference().columns[0]?.name}`;
        const expected = CASCADE.has(column) ? 'cascade' : 'restrict';
        if (expected === 'cascade') cascades += 1;
        expect(fk.onDelete, column).toBe(expected);
      }
    }
    expect(cascades).toBe(CASCADE.size);
  });

  it('gives every mutable table the four audit columns', () => {
    for (const name of MUTABLE) {
      expect(columnsOf(name), name).toEqual(
        expect.arrayContaining(['created_at', 'updated_at', 'created_by', 'updated_by']),
      );
    }
  });

  it('keeps audit_logs append-only in shape: no updated_* columns', () => {
    expect(columnsOf('audit_logs')).not.toContain('updated_at');
    expect(columnsOf('audit_logs')).not.toContain('updated_by');
  });
});
