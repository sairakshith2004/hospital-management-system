/**
 * Test helpers: a fake API behind `fetch` (no network), and the real app rendered on a
 * memory router. Synthetic data only.
 */
import type { AuthResponse, SessionUser } from '@hospitalos/shared';
import { render } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { App, routes } from './App';
import { setCsrfToken } from './lib/api';
import { createQueryClient } from './lib/query-client';

export const CSRF = 'test-csrf-token-0123456789abcdefghijklmnopq';

export function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'zz_reception',
    fullName: 'Test Receptionist',
    roles: ['REC'],
    permissions: ['patient:create', 'appointment:book'],
    ...overrides,
  };
}

export const session = (user = makeUser()): AuthResponse => ({ user, csrfToken: CSRF });

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const apiError = (status: number, code: string, message: string) =>
  json(status, { error: { code, message, requestId: '11111111-1111-4111-8111-111111111111' } });

type Handler = (init: RequestInit) => Response | Promise<Response>;

/** Routes "METHOD /path" to handlers; records every call. Unknown routes fail the test. */
export function fakeApi(handlers: Record<string, Handler>) {
  const calls: { key: string; init: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    calls.push({ key, init });
    if (url === '/api/health') return json(200, { status: 'ok' });
    const handler = handlers[key];
    if (!handler) throw new Error(`Unexpected request in test: ${key}`);
    return handler(init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    fetchMock,
    headersOf: (key: string) =>
      calls.filter((c) => c.key === key).map((c) => new Headers(c.init.headers)),
  };
}

export function renderApp(path = '/') {
  setCsrfToken(null);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(<App router={router} queryClient={createQueryClient()} />);
  return { ...utils, router };
}
