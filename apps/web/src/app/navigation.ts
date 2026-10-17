import type { PermissionCode } from '@hospitalos/shared';

export interface NavItem {
  label: string;
  path: string;
  /** null = every signed-in user. Display only; the API enforces access. */
  permission: PermissionCode | null;
}

/** Modules add their entries here as they are built (patients on Day 2, and so on). */
export const NAV_ITEMS: NavItem[] = [{ label: 'Home', path: '/', permission: null }];

export function visibleNavItems(
  can: (permission: PermissionCode) => boolean,
  items: NavItem[] = NAV_ITEMS,
): NavItem[] {
  return items.filter((item) => item.permission === null || can(item.permission));
}
