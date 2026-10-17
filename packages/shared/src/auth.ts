/** Request and response shapes shared by the API and the web app (types only). */
import type { PermissionCode } from './permissions.js';

/** Sent on every POST, PUT, PATCH and DELETE made with a session. */
export const CSRF_HEADER = 'X-CSRF-Token';

export interface LoginRequest {
  username: string;
  password: string;
}

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  /** Active role codes, e.g. ["REC"]. Empty for an account awaiting role assignment. */
  roles: string[];
  permissions: PermissionCode[];
}

/** Returned by POST /api/auth/login and GET /api/auth/me. */
export interface AuthResponse {
  user: SessionUser;
  csrfToken: string;
}

export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'CSRF_INVALID'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'VALIDATION_FAILED'
  | 'INVALID_JSON'
  | 'PAYLOAD_TOO_LARGE'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DUPLICATE_SUSPECTED'
  | 'STALE_VERSION'
  | 'INTERNAL_ERROR';

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
    details?: { path: string; message: string }[];
    data?: Record<string, unknown>;
  };
}
