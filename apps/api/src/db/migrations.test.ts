import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIR = fileURLToPath(new URL('./migrations/', import.meta.url));
const read = (name: string) => readFileSync(`${DIR}${name}`, 'utf8');

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const journal = JSON.parse(read('meta/_journal.json')) as {
  entries: { idx: number; tag: string; when: number }[];
};
const checksums = JSON.parse(read('checksums.json')) as Record<string, string>;

/** Operations no migration may contain. Corrections are new, additive migrations. */
const FORBIDDEN: [string, RegExp][] = [
  ['DROP', /\bDROP\b/i],
  ['TRUNCATE statement', /(^|;)\s*TRUNCATE\b/im],
  ['DELETE FROM', /\bDELETE\s+FROM\b/i],
  ['RENAME', /\bRENAME\b/i],
  ['REVOKE', /\bREVOKE\b/i],
  ['grant to PUBLIC', /\bTO\s+PUBLIC\b/i],
  ['ALTER DEFAULT PRIVILEGES', /\bALTER\s+DEFAULT\s+PRIVILEGES\b/i],
  ['SECURITY DEFINER', /\bSECURITY\s+DEFINER\b/i],
  ['DISABLE TRIGGER', /\bDISABLE\s+TRIGGER\b/i],
  ['session_replication_role', /\bsession_replication_role\b/i],
];

/**
 * The one allowed DROP: replacing a CHECK constraint to widen it (for example a new status
 * value), which needs DROP CONSTRAINT then ADD CONSTRAINT with the same name on the same
 * table, in the same file (owner decision 2026-10-27). A drop that isn't re-added still fails.
 */
function withoutReplacedConstraints(code: string): string {
  return code.replace(
    /ALTER\s+TABLE\s+("?\w+"?)\s+DROP\s+CONSTRAINT\s+("?\w+"?)\s*;/gi,
    (stmt, table: string, name: string) => {
      const readded = new RegExp(
        `ALTER\\s+TABLE\\s+${table.replace(/"/g, '"?')}\\s+ADD\\s+CONSTRAINT\\s+${name.replace(/"/g, '"?')}\\s+CHECK\\b`,
        'i',
      );
      return readded.test(code) ? '' : stmt;
    },
  );
}

/** The labels of every forbidden operation in `sql`, ignoring -- comments. */
function violations(sql: string): string[] {
  const code = withoutReplacedConstraints(sql.replace(/--.*$/gm, ''));
  return FORBIDDEN.filter(([, pattern]) => pattern.test(code)).map(([label]) => label);
}

describe('migrations', () => {
  it('match the Drizzle journal exactly, in order', () => {
    expect(files).toEqual(journal.entries.map((e) => `${e.tag}.sql`));
    expect(journal.entries.map((e) => e.idx)).toEqual(files.map((_, i) => i));
    const times = journal.entries.map((e) => e.when);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);
  });

  it('are never edited after being added (checksums.json)', () => {
    const actual = Object.fromEntries(
      files.map((f) => [f, createHash('sha256').update(read(f)).digest('hex')]),
    );
    // A new migration fails here until its hash is added to checksums.json.
    expect(actual).toEqual(checksums);
  });

  it.each(files)('%s contains no destructive or privilege-widening SQL', (file) => {
    expect(violations(read(file))).toEqual([]);
  });
});

describe('migration guard', () => {
  it.each([
    ['DROP', 'DROP TABLE users;'],
    ['TRUNCATE statement', 'TRUNCATE audit_logs;'],
    ['DELETE FROM', 'DELETE FROM audit_logs;'],
    ['RENAME', 'ALTER TABLE users RENAME TO people;'],
    ['REVOKE', 'REVOKE SELECT ON users FROM hms_app;'],
    ['grant to PUBLIC', 'GRANT SELECT ON users TO PUBLIC;'],
    ['ALTER DEFAULT PRIVILEGES', 'ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO hms_app;'],
    ['SECURITY DEFINER', 'CREATE FUNCTION f() RETURNS void SECURITY DEFINER AS $$ $$;'],
    ['DISABLE TRIGGER', 'ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update_delete;'],
    ['DISABLE TRIGGER', 'ALTER TABLE audit_logs DISABLE TRIGGER ALL;'],
    ['session_replication_role', "SET session_replication_role = 'replica';"],
    ['session_replication_role', "SELECT set_config('session_replication_role', 'replica', true);"],
    ['DROP', 'ALTER TABLE "meetings" DROP CONSTRAINT "meetings_status_check";'],
    [
      'DROP',
      'ALTER TABLE "a" DROP CONSTRAINT "x_check"; ALTER TABLE "b" ADD CONSTRAINT "x_check" CHECK (true);',
    ],
    [
      'DROP',
      'ALTER TABLE "a" DROP CONSTRAINT "x_fk"; ALTER TABLE "a" ADD CONSTRAINT "x_fk" FOREIGN KEY ("b") REFERENCES "c"("id");',
    ],
  ])('rejects %s: %s', (label, sql) => {
    expect(violations(sql)).toContain(label);
  });

  it('allows widening a CHECK constraint by replacing it under the same name', () => {
    expect(
      violations(
        `ALTER TABLE "meetings" DROP CONSTRAINT "meetings_status_check";
         ALTER TABLE "meetings" ADD CONSTRAINT "meetings_status_check" CHECK ("meetings"."status" IN ('a', 'b'));`,
      ),
    ).toEqual([]);
  });

  it('allows the trigger definitions used by migration 0001', () => {
    expect(
      violations(
        'CREATE TRIGGER t BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION f();\n' +
          'CREATE TRIGGER u BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION f();',
      ),
    ).toEqual([]);
  });

  it('ignores forbidden words inside -- comments only', () => {
    expect(violations('-- never DROP anything\nSELECT 1;')).toEqual([]);
    expect(violations('SELECT 1; DROP TABLE users; -- comment')).toEqual(['DROP']);
  });
});
