import { describe, expect, it } from 'vitest';
import {
  MANAGED_DATABASES,
  MANAGED_ROLES,
  ROLE_ATTRIBUTES,
  allRoleStatements,
  databaseAccessSql,
  ensureRoleSql,
} from './roles-sql.js';

const ALLOWED_REVOKE = /^REVOKE CONNECT, TEMPORARY ON DATABASE (hms_dev|hms_test) FROM PUBLIC$/;

describe('db:roles SQL', () => {
  const statements = allRoleStatements();

  it('contains nothing destructive', () => {
    const forbidden =
      /\b(DROP|TRUNCATE|DELETE|CREATE\s+DATABASE|ALTER\s+DATABASE|ALTER\s+SYSTEM)\b/i;
    for (const sql of statements) expect(sql).not.toMatch(forbidden);
  });

  it('allows only the PUBLIC CONNECT/TEMPORARY revoke, once per managed database', () => {
    const revokes = statements.filter((sql) => /\bREVOKE\b/i.test(sql));
    for (const sql of revokes) expect(sql).toMatch(ALLOWED_REVOKE);
    expect(revokes.map((sql) => ALLOWED_REVOKE.exec(sql)?.[1])).toEqual([...MANAGED_DATABASES]);
  });

  it('gives both roles explicit CONNECT after removing PUBLIC access', () => {
    for (const db of MANAGED_DATABASES) {
      expect(databaseAccessSql(db)).toEqual([
        `REVOKE CONNECT, TEMPORARY ON DATABASE ${db} FROM PUBLIC`,
        `GRANT CONNECT, CREATE ON DATABASE ${db} TO hms_owner`,
        `GRANT CONNECT ON DATABASE ${db} TO hms_app`,
      ]);
    }
  });

  it('never grants TEMPORARY or ALL', () => {
    for (const sql of statements.filter((s) => /^GRANT\b/.test(s))) {
      expect(sql).not.toMatch(/\b(TEMPORARY|TEMP|ALL)\b/);
    }
  });

  it('creates only least-privilege login roles', () => {
    for (const attribute of ['NOSUPERUSER', 'NOCREATEDB', 'NOCREATEROLE', 'NOBYPASSRLS']) {
      expect(ROLE_ATTRIBUTES).toContain(attribute);
    }
  });

  it('touches only the local development and test databases', () => {
    expect(MANAGED_DATABASES).toEqual(['hms_dev', 'hms_test']);
    const named = statements.flatMap((sql) =>
      [...sql.matchAll(/ON DATABASE (\w+)/g)].map((m) => m[1]),
    );
    expect(new Set(named)).toEqual(new Set(MANAGED_DATABASES));
  });

  it('never embeds a password in the SQL text', () => {
    for (const sql of statements) expect(sql).not.toMatch(/PASSWORD\s+'/i);
  });

  it('replaces role-setup errors with one that cannot quote the password', () => {
    for (const role of MANAGED_ROLES) {
      const sql = ensureRoleSql(role);
      expect(sql).toMatch(
        new RegExp(
          `EXCEPTION WHEN OTHERS THEN\\s+RAISE EXCEPTION 'Setting up role ${role} failed \\(SQLSTATE %\\)\\.', SQLSTATE;\\s+END\\s+\\$\\$$`,
        ),
      );
      expect(sql).not.toMatch(/SQLERRM|GET\s+STACKED\s+DIAGNOSTICS/i);
    }
  });
});
