/**
 * The only SQL that db:roles runs. Kept apart from the script so a test can
 * check it contains nothing destructive (roles-sql.test.ts).
 */
import { APP_ROLE, DATABASES, OWNER_ROLE } from './db-env.js';

export const MANAGED_ROLES = [OWNER_ROLE, APP_ROLE] as const;
export const MANAGED_DATABASES = [DATABASES.dev, DATABASES.test] as const;

export const ROLE_ATTRIBUTES =
  'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS';

/** Name of the transaction-local setting that carries a role's password. */
export const PASSWORD_SETTING = 'hms.role_password';

/**
 * Creates the role if it's missing, then (re)applies its attributes and sets its
 * password from PASSWORD_SETTING, so the password never appears in SQL text.
 *
 * Any error is replaced by one naming only the role and SQLSTATE. Without this, a
 * failing dynamic ALTER ROLE could carry its own text, password included, into the
 * error report and the server log. SQLERRM is deliberately not used: an error
 * message can quote part of the statement.
 */
export function ensureRoleSql(role: (typeof MANAGED_ROLES)[number]): string {
  return `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
    EXECUTE format('CREATE ROLE %I ${ROLE_ATTRIBUTES}', '${role}');
  END IF;
  EXECUTE format('ALTER ROLE %I WITH ${ROLE_ATTRIBUTES} PASSWORD %L',
                 '${role}', current_setting('${PASSWORD_SETTING}'));
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Setting up role ${role} failed (SQLSTATE %).', SQLSTATE;
END
$$`;
}

/**
 * Database access, run once per managed database in a single transaction.
 *
 * PostgreSQL gives every role CONNECT and TEMPORARY on new databases through
 * PUBLIC. That default is removed here, which is the only REVOKE db:roles runs,
 * and the two roles get exactly the access they need instead. Superusers are
 * unaffected.
 */
export function databaseAccessSql(database: (typeof MANAGED_DATABASES)[number]): string[] {
  return [
    `REVOKE CONNECT, TEMPORARY ON DATABASE ${database} FROM PUBLIC`,
    // CREATE on the database lets the owner create its own "drizzle" migration-history schema.
    `GRANT CONNECT, CREATE ON DATABASE ${database} TO ${OWNER_ROLE}`,
    `GRANT CONNECT ON DATABASE ${database} TO ${APP_ROLE}`,
  ];
}

/** Schema grants, run inside each managed database. Table grants come from migrations. */
export const SCHEMA_GRANTS_SQL = [
  `GRANT USAGE, CREATE ON SCHEMA public TO ${OWNER_ROLE}`,
  `GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`,
];

export function allRoleStatements(): string[] {
  return [
    ...MANAGED_ROLES.map(ensureRoleSql),
    ...MANAGED_DATABASES.flatMap(databaseAccessSql),
    ...SCHEMA_GRANTS_SQL,
  ];
}
