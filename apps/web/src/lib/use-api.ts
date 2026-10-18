/**
 * Data hooks shared by every module. Reads are cached by their API path; after a change,
 * every cached path starting with one of `invalidate` is reloaded, so all screens that
 * show the same records (e.g. stock in pharmacy and inventory) stay in step.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch, ApiError } from './api';

export function useApi<T>(
  path: string | null,
  options: Omit<UseQueryOptions<T, Error, T, (string | null)[]>, 'queryKey' | 'queryFn'> = {},
) {
  return useQuery({
    queryKey: [path],
    queryFn: ({ signal }) => apiFetch<T>(path!, { signal }),
    enabled: path !== null,
    ...options,
  });
}

export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
}

/** The API's error code, for flows that react to a specific refusal (e.g. ALLERGY_CONFLICT). */
export function errorCode(err: unknown): string | null {
  return err instanceof ApiError ? err.code : null;
}

export function useInvalidate() {
  const qc = useQueryClient();
  return (...prefixes: string[]) =>
    qc.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey[0];
        return (
          (typeof k === 'string' && prefixes.some((p) => k.startsWith(p))) ||
          (k === 'scheduling' && prefixes.includes('scheduling'))
        );
      },
    });
}

/**
 * A write: POST/PATCH `path` with a body. Keeps a human-readable error and the API error
 * code; reloads the given path prefixes on success.
 */
export function useAction<TBody extends object | undefined, TRes = unknown>(
  method: 'POST' | 'PATCH',
  path: string | ((body: TBody) => string),
  {
    invalidate = [],
    onSuccess,
  }: { invalidate?: string[]; onSuccess?: (res: TRes, body: TBody) => void } = {},
) {
  const reload = useInvalidate();
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (body: TBody) =>
      apiFetch<TRes>(typeof path === 'function' ? path(body) : path, { method, body: body ?? {} }),
    onMutate: () => {
      setError(null);
      setCode(null);
    },
    onSuccess: (res, body) => {
      void reload(...invalidate);
      onSuccess?.(res, body);
    },
    onError: (err) => {
      setError(errorMessage(err));
      setCode(errorCode(err));
    },
  });
  return {
    run: mutation.mutate,
    runAsync: mutation.mutateAsync,
    pending: mutation.isPending,
    error,
    code,
    reset: () => {
      setError(null);
      setCode(null);
      mutation.reset();
    },
  };
}

export const newKey = () => crypto.randomUUID();
