import type { PermissionCode } from '@hospitalos/shared';

export interface NavItem {
  label: string;
  path: string;
  /** Sidebar group heading. */
  section: NavSection;
  /**
   * Shown when the user holds at least one of these; null = every signed-in user.
   * Display only: the API enforces access on every request.
   */
  anyOf: PermissionCode[] | null;
}

export const NAV_SECTIONS = [
  'Overview',
  'Front desk',
  'Clinical',
  'Pharmacy',
  'Laboratory',
  'Billing',
  'Inventory',
  'People',
  'Finance',
  'Facilities',
  'Outreach',
  'Administration',
] as const;
export type NavSection = (typeof NAV_SECTIONS)[number];

/** Every page in the app. Modules add their entries here when the page exists. */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/', section: 'Overview', anyOf: null },
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
  {
    label: 'Book appointment',
    path: '/appointments/new',
    section: 'Front desk',
    anyOf: ['appointment:book'],
  },
  { label: 'Queue', path: '/queue', section: 'Front desk', anyOf: ['queue:read'] },
  {
    label: 'Patients per doctor',
    path: '/reports/doctors',
    section: 'Front desk',
    anyOf: ['appointment:read_all'],
  },
  { label: 'Follow-ups', path: '/follow-ups', section: 'Front desk', anyOf: ['followup:schedule'] },
  { label: 'Doctors', path: '/doctors', section: 'Front desk', anyOf: ['schedule:read'] },
  // Doctors only (encounter:write): the API limits these to their own appointments and fees.
  {
    label: 'My appointments',
    path: '/appointments',
    section: 'Clinical',
    anyOf: ['encounter:write'],
  },
  {
    label: 'My earnings',
    path: '/reports/doctor-earnings',
    section: 'Clinical',
    anyOf: ['encounter:write'],
  },
  { label: 'Medicines', path: '/medicines', section: 'Clinical', anyOf: ['medicine:search'] },
  {
    label: 'Prescriptions',
    path: '/pharmacy',
    section: 'Pharmacy',
    anyOf: ['prescription:dispense', 'prescription:close'],
  },
  {
    label: 'Stock',
    path: '/inventory/stock',
    section: 'Inventory',
    anyOf: [
      'medicine:catalog_manage',
      'stock:adjust_pharmacy',
      'stock:adjust_store',
      'goods_receipt:create',
    ],
  },
  {
    label: 'Goods receipts',
    path: '/inventory/receipts',
    section: 'Inventory',
    anyOf: ['goods_receipt:create', 'supplier:manage'],
  },
  {
    label: 'Transfers',
    path: '/inventory/transfers',
    section: 'Inventory',
    anyOf: [
      'stock_transfer:dispatch_pharmacy',
      'stock_transfer:dispatch_store',
      'stock_transfer:receive_pharmacy',
      'stock_transfer:receive_store',
    ],
  },
  {
    label: 'Suppliers',
    path: '/inventory/suppliers',
    section: 'Inventory',
    anyOf: ['supplier:manage'],
  },
  {
    label: 'Catalogue',
    path: '/inventory/catalogue',
    section: 'Inventory',
    anyOf: ['medicine:catalog_manage'],
  },
  {
    label: 'Lab worklist',
    path: '/lab',
    section: 'Laboratory',
    anyOf: ['lab:process', 'lab_result:enter', 'lab_result:verify'],
  },
  {
    label: 'Lab tests',
    path: '/lab/tests',
    section: 'Laboratory',
    anyOf: ['lab:process', 'price:manage'],
  },
  { label: 'Invoices', path: '/billing', section: 'Billing', anyOf: ['invoice:read'] },
  {
    label: 'Price list',
    path: '/billing/services',
    section: 'Billing',
    anyOf: ['price:manage', 'invoice:issue'],
  },
  {
    label: 'Staff',
    path: '/admin/staff',
    section: 'People',
    anyOf: ['user:manage', 'user_role:assign', 'employee:read'],
  },
  { label: 'Attendance', path: '/hr/attendance', section: 'People', anyOf: ['attendance:manage'] },
  {
    label: 'Leave',
    path: '/hr/leave',
    section: 'People',
    anyOf: ['leave:request', 'leave:approve'],
  },
  {
    label: 'Expenses',
    path: '/finance/expenses',
    section: 'Finance',
    anyOf: ['expense:create', 'expense:approve'],
  },
  {
    label: 'Finance summary',
    path: '/finance/summary',
    section: 'Finance',
    anyOf: ['report:finance'],
  },
  {
    label: 'Doctor earnings',
    path: '/reports/doctor-earnings',
    section: 'Finance',
    anyOf: ['report:finance'],
  },
  {
    label: 'Equipment',
    path: '/equipment',
    section: 'Facilities',
    anyOf: ['equipment:manage', 'maintenance:log'],
  },
  { label: 'Enquiries', path: '/enquiries', section: 'Outreach', anyOf: ['enquiry:manage'] },
  {
    label: 'Campaigns',
    path: '/campaigns',
    section: 'Outreach',
    anyOf: ['campaign:manage', 'report:marketing'],
  },
  {
    label: 'Doctors and schedules',
    path: '/admin/doctors',
    section: 'Administration',
    anyOf: ['schedule:manage', 'fee:manage'],
  },
  {
    label: 'Departments and locations',
    path: '/admin/organisation',
    section: 'Administration',
    anyOf: ['department:manage'],
  },
  {
    label: 'Settings',
    path: '/admin/settings',
    section: 'Administration',
    anyOf: ['system_settings:manage', 'security_settings:manage', 'operational_settings:manage'],
  },
  { label: 'Audit log', path: '/admin/audit', section: 'Administration', anyOf: ['audit:read'] },
];

export function visibleNavItems(
  can: (permission: PermissionCode) => boolean,
  items: NavItem[] = NAV_ITEMS,
): NavItem[] {
  return items.filter((item) => item.anyOf === null || item.anyOf.some((p) => can(p)));
}

/** Visible items grouped by section, in section order; empty sections are dropped. */
export function navSections(
  can: (permission: PermissionCode) => boolean,
  items: NavItem[] = NAV_ITEMS,
): { section: NavSection; items: NavItem[] }[] {
  const visible = visibleNavItems(can, items);
  return NAV_SECTIONS.map((section) => ({
    section,
    items: visible.filter((i) => i.section === section),
  })).filter((g) => g.items.length > 0);
}
