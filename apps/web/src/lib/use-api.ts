/**
 * Data hooks shared by every module. Reads are cached by their API path; after a change,
 * every cached path starting with one of `invalidate` is reloaded, so all screens that
 * show the same records (e.g. stock in pharmacy and inventory) stay in step.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
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
  if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.';
  // A validation refusal lists what to fix, e.g. "Pulse must be between 20 and 250 /min".
  const fixes = [...new Set((err.details ?? []).map((d) => d.message))];
  return fixes.length > 0 ? `Please check: ${fixes.join('; ')}.` : err.message;
}

/** The API's error code, for flows that react to a specific refusal (e.g. ALLERGY_CONFLICT). */
export function errorCode(err: unknown): string | null {
  return err instanceof ApiError ? err.code : null;
}

/**
 * Reloads every cached read whose path starts with one of the prefixes. The returned
 * function is stable across renders, so effects can depend on it without restarting
 * (an unstable one made the meeting room rejoin on every render: camera flicker).
 */
export function useInvalidate() {
  const qc = useQueryClient();
  return useCallback(
    (...prefixes: string[]) =>
      qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return (
            (typeof k === 'string' && prefixes.some((p) => k.startsWith(p))) ||
            (k === 'scheduling' && prefixes.includes('scheduling'))
          );
        },
      }),
    [qc],
  );
}

/**
 * The JSON sent for an action. When the path is built from the body, the record's `id` is
 * already in the URL (for example /api/hr/leave/:id/decide), so it is left out of the body:
 * the API's strict schemas reject any field they don't expect.
 */
export function requestBody(body: object | undefined, idInPath: boolean): object {
  if (!body) return {};
  if (!idInPath || !('id' in body)) return body;
  const rest: Record<string, unknown> = { ...body };
  delete rest.id;
  return rest;
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
      apiFetch<TRes>(typeof path === 'function' ? path(body) : path, {
        method,
        body: requestBody(body, typeof path === 'function'),
      }),
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
