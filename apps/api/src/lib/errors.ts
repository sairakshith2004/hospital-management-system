/**
 * An error whose status, code and message are safe to send to the client exactly as
 * written. Anything else that reaches the error handler becomes a generic 500.
 */
export class AppError extends Error {
  override name = 'AppError';

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Extra fields the client needs, e.g. duplicate candidates. Never secrets. */
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
  }
}
