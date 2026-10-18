import type { PermissionCode } from '@hospitalos/shared';
import { describe, expect, it } from 'vitest';
import { navSections, visibleNavItems, type NavItem } from './navigation';

const items: NavItem[] = [
  { label: 'Home', path: '/', section: 'Overview', anyOf: null },
  {
    label: 'Patients',
    path: '/patients',
    section: 'Front desk',
    anyOf: ['patient:read_demographics'],
  },
  {
    label: 'Appointments',
    path: '/appointments',
    section: 'Front desk',
    anyOf: ['appointment:read_all', 'appointment:book'],
  },
  { label: 'Audit log', path: '/audit', section: 'Administration', anyOf: ['audit:read'] },
];
const holding =
  (...granted: PermissionCode[]) =>
  (p: PermissionCode) =>
    granted.includes(p);

describe('visibleNavItems', () => {
  it('shows only items the user may open, plus items open to everyone', () => {
    expect(
      visibleNavItems(holding('patient:read_demographics'), items).map((i) => i.label),
    ).toEqual(['Home', 'Patients']);
  });

  it('shows an item when the user holds any one of its permissions', () => {
    expect(visibleNavItems(holding('appointment:book'), items).map((i) => i.label)).toEqual([
      'Home',
      'Appointments',
    ]);
  });

  it('shows only the open items to an account without permissions', () => {
    expect(visibleNavItems(() => false, items).map((i) => i.label)).toEqual(['Home']);
  });
});

describe('navSections', () => {
  it('groups visible items in section order and drops empty sections', () => {
    const sections = navSections(holding('audit:read', 'patient:read_demographics'), items);
    expect(sections.map((s) => [s.section, s.items.map((i) => i.label)])).toEqual([
      ['Overview', ['Home']],
      ['Front desk', ['Patients']],
      ['Administration', ['Audit log']],
    ]);
  });
});
