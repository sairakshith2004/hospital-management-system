import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the landing screen with the synthetic-data notice and API status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) }),
    );
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'HospitalOS' })).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('Synthetic data only');
    expect(screen.getByRole('status')).toBeTruthy();
    expect(await screen.findByText('API online')).toBeTruthy();
  });
});
