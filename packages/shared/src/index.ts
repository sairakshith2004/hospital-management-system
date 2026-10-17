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
