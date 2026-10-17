import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiFetch,
  checkApiHealth,
  hasCsrfToken,
  onSessionExpired,
  setCsrfToken,
} from './api';

const respond = (ok: boolean, body: unknown) =>
  vi.fn().mockResolvedValue({ ok, json: async () => body });

describe('checkApiHealth', () => {
  it('returns online for 200 {"status":"ok"} and calls /api/health', async () => {
    const fetchMock = respond(true, { status: 'ok' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(checkApiHealth()).resolves.toBe('online');
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.any(Object));
  });

  it('returns offline for a non-2xx response', async () => {
    vi.stubGlobal('fetch', respond(false, { status: 'ok' }));
    await expect(checkApiHealth()).resolves.toBe('offline');
  });

  it('returns offline for an unexpected body', async () => {
    vi.stubGlobal('fetch', respond(true, { status: 'down' }));
    await expect(checkApiHealth()).resolves.toBe('offline');
  });

  it('returns offline when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(checkApiHealth()).resolves.toBe('offline');
  });

  it('returns offline when the request times out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      ),
    );
    await expect(checkApiHealth(20)).resolves.toBe('offline');
  });
});

describe('apiFetch', () => {
  const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    'sends the CSRF token on %s, same-origin, with JSON',
    async (method) => {
      setCsrfToken('token-abc');
      const fetchMock = vi.fn().mockResolvedValue(ok());
      vi.stubGlobal('fetch', fetchMock);
      await apiFetch('/api/x', { method, body: { a: 1 } });
      const init = fetchMock.mock.calls[0]![1] as RequestInit;
      const headers = new Headers(init.headers);
      expect(headers.get('X-CSRF-Token')).toBe('token-abc');
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(init.credentials).toBe('same-origin');
      expect(init.body).toBe('{"a":1}');
      setCsrfToken(null);
    },
  );

  it('never sends the CSRF token on GET', async () => {
    setCsrfToken('token-abc');
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('/api/x');
    expect(
      new Headers((fetchMock.mock.calls[0]![1] as RequestInit).headers).get('X-CSRF-Token'),
    ).toBeNull();
    setCsrfToken(null);
  });

  it('turns the API error shape into an ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { code: 'FORBIDDEN', message: 'No', requestId: 'req-1' } }),
            { status: 403 },
          ),
        ),
    );
    await expect(apiFetch('/api/x')).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      code: 'FORBIDDEN',
      message: 'No',
      requestId: 'req-1',
    });
  });

  it('reports a network failure as status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(apiFetch('/api/x')).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it('signals an expired session on a 401 while signed in, and forgets the token', async () => {
    const expired = vi.fn();
    const stop = onSessionExpired(expired);
    setCsrfToken('token-abc');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    await expect(apiFetch('/api/x')).rejects.toBeInstanceOf(ApiError);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(hasCsrfToken()).toBe(false);
    stop();
  });

  it('does not signal expiry for auth calls that handle their own 401, or when signed out', async () => {
    const expired = vi.fn();
    const stop = onSessionExpired(expired);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    setCsrfToken('token-abc');
    await expect(
      apiFetch('/api/auth/login', { method: 'POST', ignoreUnauthorized: true }),
    ).rejects.toThrow();
    setCsrfToken(null);
    await expect(apiFetch('/api/x')).rejects.toThrow();
    expect(expired).not.toHaveBeenCalled();
    stop();
  });

  it('returns undefined for 204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(apiFetch('/api/x', { method: 'POST' })).resolves.toBeUndefined();
  });
});
