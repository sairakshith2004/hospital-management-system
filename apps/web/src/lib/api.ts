/**
 * The web app's only way to call the API. Same-origin requests (the Vite proxy in
 * development), JSON in and out, and the session cookie sent by the browser; the app
 * never reads or writes cookies itself.
 *
 * The CSRF token lives only in this module's memory: never in localStorage,
 * sessionStorage or a readable cookie. It comes from the login and /api/auth/me
 * responses, so a page reload gets it back from /me.
 */
import type { ApiErrorBody } from '@hospitalos/shared';

const CSRF_HEADER = 'X-CSRF-Token';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class ApiError extends Error {
  override name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null,
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function hasCsrfToken(): boolean {
  return csrfToken !== null;
}

type Listener = () => void;
const sessionExpiredListeners = new Set<Listener>();

/** Called when a signed-in request gets 401: the session ended on the server. */
export function onSessionExpired(listener: Listener): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Auth calls handle their own 401s, which must not count as an expired session. */
  ignoreUnauthorized?: boolean;
}

function isErrorBody(body: unknown): body is ApiErrorBody {
  const error = (body as { error?: unknown } | null)?.error as Record<string, unknown> | undefined;
  return typeof error?.code === 'string' && typeof error.message === 'string';
}

export async function apiFetch<T>(
  path: string,
  { method = 'GET', body, signal, ignoreUnauthorized = false }: ApiRequest = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (UNSAFE_METHODS.has(method) && csrfToken) headers[CSRF_HEADER] = csrfToken;

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    });
  } catch {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      "Can't reach the server. Check the connection and try again.",
      null,
    );
  }

  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => undefined);
  if (res.ok) return data as T;

  const error = isErrorBody(data) ? data.error : undefined;
  if (res.status === 401 && !ignoreUnauthorized && csrfToken !== null) {
    csrfToken = null;
    sessionExpiredListeners.forEach((listener) => listener());
  }
  throw new ApiError(
    res.status,
    error?.code ?? 'HTTP_ERROR',
    error?.message ?? 'Something went wrong. Please try again.',
    error?.requestId ?? res.headers.get('X-Request-Id'),
  );
}

export type ApiHealth = 'online' | 'offline';

/** Calls GET /api/health (through the Vite proxy in development). Never throws. */
export async function checkApiHealth(timeoutMs = 5000): Promise<ApiHealth> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('/api/health', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return 'offline';
    const body: unknown = await res.json();
    return isHealthy(body) ? 'online' : 'offline';
  } catch {
    return 'offline'; // network error, timeout or invalid JSON
  } finally {
    clearTimeout(timer);
  }
}

function isHealthy(body: unknown): boolean {
  return (
    typeof body === 'object' && body !== null && (body as { status?: unknown }).status === 'ok'
  );
}
