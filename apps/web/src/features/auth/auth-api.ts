import type { AuthResponse, LoginRequest } from '@hospitalos/shared';
import { apiFetch } from '../../lib/api';

/** The current session, or null when signed out (401). Other failures throw. */
export async function fetchSession(): Promise<AuthResponse | null> {
  try {
    return await apiFetch<AuthResponse>('/api/auth/me', { ignoreUnauthorized: true });
  } catch (err) {
    if ((err as { status?: number }).status === 401) return null;
    throw err;
  }
}

export function postLogin(credentials: LoginRequest): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: credentials,
    ignoreUnauthorized: true,
  });
}

export function postLogout(): Promise<void> {
  return apiFetch<void>('/api/auth/logout', { method: 'POST', ignoreUnauthorized: true });
}
