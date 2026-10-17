import { describe, expect, it } from 'vitest';
import { visibleNavItems, type NavItem } from './navigation';

const items: NavItem[] = [
  { label: 'Home', path: '/', permission: null },
  { label: 'Patients', path: '/patients', permission: 'patient:read_demographics' },
  { label: 'Audit log', path: '/audit', permission: 'audit:read' },
];

describe('visibleNavItems', () => {
  it('shows only items the user may open, plus items open to everyone', () => {
    const can = (p: string) => p === 'patient:read_demographics';
    expect(visibleNavItems(can, items).map((i) => i.label)).toEqual(['Home', 'Patients']);
  });

  it('shows only the open items to an account without permissions', () => {
    expect(visibleNavItems(() => false, items).map((i) => i.label)).toEqual(['Home']);
  });
});
