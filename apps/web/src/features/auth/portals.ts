import type { RoleCode } from '@hospitalos/shared';

/**
 * Sign-in portals shown on the login page. Choosing one only labels the sign-in form and
 * checks, after sign-in, that the account holds one of the portal's roles; it never grants
 * anything. The server decides every permission from the account's own roles.
 */
export interface Portal {
  key: string;
  label: string;
  /** Two-letter mark for the tile. */
  mark: string;
  description: string;
  /** Null for "Other staff": any account, including one still waiting for a role. */
  roles: RoleCode[] | null;
  /** Tile accent (Tailwind classes for the mark). */
  tone: string;
}

export const PORTALS: Portal[] = [
  {
    key: 'reception',
    label: 'Reception',
    mark: 'Re',
    description: 'Appointments, check-in, queues',
    roles: ['REC'],
    tone: 'bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100',
  },
  {
    key: 'doctor',
    label: 'Doctor',
    mark: 'Dr',
    description: 'Your queue and consultations',
    roles: ['DOC'],
    tone: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-100',
  },
  {
    key: 'nursing',
    label: 'Nursing',
    mark: 'Nu',
    description: 'Ward and patient support',
    roles: ['NUR'],
    tone: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-100',
  },
  {
    key: 'pharmacy',
    label: 'Pharmacy',
    mark: 'Rx',
    description: 'Dispensing and medicine stock',
    roles: ['PHA'],
    tone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100',
  },
  {
    key: 'laboratory',
    label: 'Laboratory',
    mark: 'Lb',
    description: 'Samples, results, verification',
    roles: ['LAB'],
    tone: 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-100',
  },
  {
    key: 'finance',
    label: 'Billing & Finance',
    mark: '₹',
    description: 'Invoices, payments, expenses',
    roles: ['FIN'],
    tone: 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
  },
  {
    key: 'inventory',
    label: 'Inventory',
    mark: 'In',
    description: 'Stores, suppliers, equipment',
    roles: ['INV'],
    tone: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100',
  },
  {
    key: 'hr',
    label: 'Human Resources',
    mark: 'HR',
    description: 'Staff, attendance, leave',
    roles: ['HR'],
    tone: 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-100',
  },
  {
    key: 'marketing',
    label: 'Marketing',
    mark: 'Mk',
    description: 'Enquiries and campaigns',
    roles: ['MKT'],
    tone: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-100',
  },
  {
    key: 'admin',
    label: 'Administration',
    mark: 'Ad',
    description: 'Accounts, settings, audit',
    roles: ['ADM', 'SA'],
    tone: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100',
  },
];

/** Any staff account, for example one still waiting for a role assignment. */
export const OTHER_STAFF: Portal = {
  key: 'staff',
  label: 'Staff',
  mark: 'St',
  description: 'Any staff account',
  roles: null,
  tone: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100',
};

export function findPortal(key: string | null): Portal | null {
  if (!key) return null;
  if (key === OTHER_STAFF.key) return OTHER_STAFF;
  return PORTALS.find((p) => p.key === key) ?? null;
}

/** True when the account may use the portal it signed in through. */
export function accountFitsPortal(portal: Portal, roles: readonly string[]): boolean {
  return portal.roles === null || portal.roles.some((r) => roles.includes(r));
}
