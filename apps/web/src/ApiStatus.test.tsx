import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiStatus, RECHECK_MS } from './ApiStatus';

const healthy = { ok: true, json: async () => ({ status: 'ok' }) };
const dot = () => screen.getByRole('status');

describe('ApiStatus', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is a green dot once the API answers, with the status in words', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(healthy));
    render(<ApiStatus />);
    expect(dot().textContent).toBe('Checking connection to the server');
    expect(await screen.findByText('Connected to the server')).toBeTruthy();
    expect(dot().getAttribute('title')).toBe('Connected to the server');
    expect(dot().querySelector('.bg-emerald-500')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull(); // no "Check again" link any more
  });

  it('is a red dot when the API is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<ApiStatus />);
    expect(await screen.findByText('Not connected to the server')).toBeTruthy();
    expect(dot().querySelector('.bg-red-600')).toBeTruthy();
  });

  it('rechecks by itself and turns green when the API comes back', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(healthy);
    vi.stubGlobal('fetch', fetchMock);
    render(<ApiStatus />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(dot().textContent).toBe('Not connected to the server');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECHECK_MS);
    });
    expect(dot().textContent).toBe('Connected to the server');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
