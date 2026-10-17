import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

/** Retries once on a network error only; 4xx answers are final. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failures, error) => error instanceof ApiError && error.status === 0 && failures < 1,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}
