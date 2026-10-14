import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiStatus } from './ApiStatus';

const healthy = { ok: true, json: async () => ({ status: 'ok' }) };

describe('ApiStatus', () => {
  it('shows a loading state, then "API online"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(healthy));
    render(<ApiStatus />);
    expect(screen.getByRole('status').textContent).toContain('Checking API…');
    expect(await screen.findByText('API online')).toBeTruthy();
  });

  it('shows "API unreachable" when the API is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<ApiStatus />);
    expect(await screen.findByText('API unreachable')).toBeTruthy();
  });

  it('"Check again" retries and can recover to "API online"', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(healthy);
    vi.stubGlobal('fetch', fetchMock);
    render(<ApiStatus />);
    expect(await screen.findByText('API unreachable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('API online')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
