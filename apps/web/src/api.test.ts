import { describe, expect, it, vi } from 'vitest';
import { checkApiHealth } from './api';

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
