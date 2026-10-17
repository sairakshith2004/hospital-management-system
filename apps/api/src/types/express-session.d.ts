import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId: string;
    /** Epoch milliseconds of the login; the 12-hour absolute limit counts from here. */
    createdAt: number;
    csrfToken: string;
  }
}
