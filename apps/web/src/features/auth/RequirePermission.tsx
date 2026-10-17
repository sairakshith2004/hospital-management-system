import type { PermissionCode } from '@hospitalos/shared';
import type { ReactNode } from 'react';
import { ForbiddenPage } from '../../app/ForbiddenPage';
import { useAuth } from './auth-context';

/** Display only: hides a page the user can't use. The API refuses the requests anyway. */
export function RequirePermission({
  permission,
  children,
}: {
  permission: PermissionCode;
  children: ReactNode;
}) {
  const { can } = useAuth();
  return can(permission) ? children : <ForbiddenPage />;
}
