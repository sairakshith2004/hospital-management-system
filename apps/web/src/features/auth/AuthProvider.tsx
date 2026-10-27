/**
 * Session state for the whole app, from the server's point of view:
 *   startup        GET /api/auth/me → signed in (user + CSRF token) or signed out
 *   login          POST /api/auth/login → signed in
 *   logout         POST /api/auth/logout → signed out, all cached data dropped
 *   expiry         any signed-in request answered 401 → signed out, "session expired"
 * Nothing is kept in browser storage; a reload asks the server again.
 */
import type { AuthResponse, LoginRequest, PermissionCode } from '@hospitalos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onSessionExpired, setCsrfToken } from '../../lib/api';
import { fetchSession, postLogin, postLogout } from './auth-api';
import { AuthContext, type AuthContextValue, type AuthStatus } from './auth-context';

export const SESSION_QUERY_KEY = ['auth', 'session'] as const;

/** Every cached response except the session itself (which its observer keeps using). */
const notSession = { predicate: (q: { queryKey: readonly unknown[] }) => q.queryKey[0] !== 'auth' };

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [endReason, setEndReason] = useState<AuthContextValue['endReason']>(null);

  const session = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async () => {
      const result = await fetchSession();
      setCsrfToken(result?.csrfToken ?? null);
      return result;
    },
    staleTime: Infinity,
  });

  const signOutLocally = useCallback(() => {
    setCsrfToken(null);
    // Drop every cached response so nothing from this user stays in memory.
    queryClient.removeQueries(notSession);
    queryClient.setQueryData<AuthResponse | null>(SESSION_QUERY_KEY, null);
  }, [queryClient]);

  useEffect(
    () =>
      onSessionExpired(() => {
        setEndReason('expired');
        signOutLocally();
      }),
    [signOutLocally],
  );

  const login = useCallback(
    async (credentials: LoginRequest) => {
      const result = await postLogin(credentials);
      setCsrfToken(result.csrfToken);
      setEndReason(null);
      queryClient.removeQueries(notSession);
      queryClient.setQueryData<AuthResponse | null>(SESSION_QUERY_KEY, result);
      return result.user;
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await postLogout();
    } catch (err) {
      // Already signed out on the server (401): finish locally. Anything else is shown.
      if ((err as { status?: number }).status !== 401) throw err;
    }
    setEndReason('signedOut');
    signOutLocally();
  }, [signOutLocally]);

  const value = useMemo<AuthContextValue>(() => {
    const user = session.data?.user ?? null;
    let status: AuthStatus;
    if (session.isPending) status = 'loading';
    else if (session.isError) status = 'unreachable';
    else status = user ? 'signedIn' : 'signedOut';
    const granted = new Set<string>(user?.permissions ?? []);
    return {
      status,
      user,
      endReason,
      login,
      logout,
      can: (permission: PermissionCode) => granted.has(permission),
      retry: () => void session.refetch(),
      refresh: async () => {
        await session.refetch();
      },
    };
  }, [session, endReason, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
