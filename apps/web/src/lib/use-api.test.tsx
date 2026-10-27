import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { createQueryClient } from './query-client';
import { requestBody, useInvalidate } from './use-api';

describe('requestBody', () => {
  it('leaves the id out when it is already in the path', () => {
    expect(requestBody({ id: 'x', decision: 'approved' }, true)).toEqual({ decision: 'approved' });
    expect(requestBody({ id: 'x' }, true)).toEqual({});
  });

  it('sends the body unchanged for a fixed path, and {} for no body', () => {
    expect(requestBody({ id: 'x', name: 'n' }, false)).toEqual({ id: 'x', name: 'n' });
    expect(requestBody({ decision: 'approved' }, true)).toEqual({ decision: 'approved' });
    expect(requestBody(undefined, true)).toEqual({});
  });
});

describe('useInvalidate', () => {
  it('returns the same function on every render, so effects that use it never restart', () => {
    const qc = createQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(() => useInvalidate(), { wrapper });
    const first = result.current;
    rerender();
    rerender();
    expect(result.current).toBe(first);
  });
});
