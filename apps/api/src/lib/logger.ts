import pino, { type DestinationStream, type LevelWithSilent, type Logger } from 'pino';

/**
 * Keys whose values never reach the logs, wherever they appear (at the top level or one
 * object down). This is a backstop: request logs already carry an allowlist of fields,
 * and nothing logs bodies, headers, cookies or query strings.
 */
const SENSITIVE_KEYS = [
  // credentials and sessions
  'password',
  'passwordHash',
  'password_hash',
  'token',
  'accessToken',
  'refreshToken',
  'sessionId',
  'sid',
  'sess',
  'csrfToken',
  'currentPassword',
  'newPassword',
  'authorization',
  'cookie',
  'SESSION_SECRET',
  // connection settings
  'connectionString',
  'DATABASE_URL',
  'TEST_DATABASE_URL',
  'MIGRATION_DATABASE_URL',
  'TEST_MIGRATION_DATABASE_URL',
  'ADMIN_DATABASE_URL',
  'POSTGRES_PASSWORD',
  // patient and staff personal data
  'firstName',
  'first_name',
  'lastName',
  'last_name',
  'fullName',
  'full_name',
  'name',
  'phone',
  'email',
  'address',
  'dob',
  'dateOfBirth',
  'date_of_birth',
];
export const REDACT_PATHS = SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`]);

/**
 * Errors are logged as type, code, message and stack trace. Database errors (they carry a
 * five-character SQLSTATE and a severity) are logged as type, code, table, column and
 * constraint plus the stack frames: their message and their detail, where and parameter
 * fields can contain row values, so those are left out.
 */
export function serializeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { type: typeof err };
  const e = err as Error & Record<string, unknown>;
  const code = typeof e.code === 'string' ? e.code : undefined;
  if (code !== undefined && /^[0-9A-Z]{5}$/.test(code) && 'severity' in e) {
    const frames = (e.stack ?? '').split('\n').filter((line) => line.trimStart().startsWith('at '));
    return {
      type: e.name,
      code,
      table: e.table,
      column: e.column,
      constraint: e.constraint,
      stack: frames.join('\n'),
    };
  }
  return {
    type: e.name,
    ...(code === undefined ? {} : { code }),
    message: e.message,
    stack: e.stack,
  };
}

export interface CreateLoggerOptions {
  level?: LevelWithSilent;
  /** Where log lines go; standard output when omitted. Tests pass a memory stream. */
  destination?: DestinationStream;
}

export function createLogger({ level = 'info', destination }: CreateLoggerOptions = {}): Logger {
  return pino(
    {
      level,
      base: { service: 'hospitalos-api' }, // no hostname or pid
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
      serializers: { err: serializeError },
    },
    destination,
  );
}
