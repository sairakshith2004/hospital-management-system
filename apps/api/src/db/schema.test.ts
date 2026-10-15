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
const MUTABLE = ['hospital_settings', 'departments', 'employees', 'users', 'roles'];

describe('database schema', () => {
  it('defines exactly the Day 4 tables', () => {
    expect([...configs.keys()].sort()).toEqual([
      'audit_logs',
      'departments',
      'employees',
      'hospital_settings',
      'permissions',
      'role_permissions',
      'roles',
      'user_roles',
      'users',
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
