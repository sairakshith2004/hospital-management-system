/** Role codes, as defined in docs/permissions.md section 1. */
export const ROLE_CODES = [
  'SA',
  'ADM',
  'REC',
  'DOC',
  'NUR',
  'PHA',
  'LAB',
  'FIN',
  'HR',
  'INV',
  'MKT',
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

export * from './permissions.js';
export * from './auth.js';
export * from './schemas/patients.js';
export * from './schemas/doctors.js';
export * from './schemas/appointments.js';
export * from './schemas/inventory.js';
export * from './schemas/reports.js';
export * from './schemas/clinical.js';
export * from './schemas/lab.js';
export * from './schemas/billing.js';
export * from './schemas/operations.js';
export * from './schemas/admin.js';
export * from './schemas/account.js';
export * from './schemas/communication.js';
