import type { LoginRequest, PermissionCode, SessionUser } from '@hospitalos/shared';
import { createContext, useContext } from 'react';

export type AuthStatus = 'loading' | 'signedIn' | 'signedOut' | 'unreachable';

export interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  /**
   * Why the last session ended: 'expired' when the server ended it (idle or absolute
   * expiry, deactivation), 'signedOut' after the user signed out. Null otherwise.
   */
  endReason: 'expired' | 'signedOut' | null;
  login(credentials: LoginRequest): Promise<void>;
  logout(): Promise<void>;
  /** Display only: the server checks every permission again. */
  can(permission: PermissionCode): boolean;
  retry(): void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
