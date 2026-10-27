import { describe, expect, it } from 'vitest';
import {
  createPatientSchema,
  hospitalToday,
  normalizeMrn,
  patientSearchSchema,
  updatePatientSchema,
} from './patients.js';

// Synthetic values only.
const valid = {
  firstName: ' Test ',
  lastName: 'Patient',
  dob: '1990-05-17',
  sex: 'female',
  phone: '+91 90000-00001',
};

describe('createPatientSchema', () => {
  it('trims names, normalises the phone and turns empty optional fields into null', () => {
    expect(
      createPatientSchema.parse({ ...valid, email: '', address: '  ', bloodGroup: '' }),
    ).toEqual({
      firstName: 'Test',
      lastName: 'Patient',
      dob: '1990-05-17',
      sex: 'female',
      phone: '919000000001',
      email: null,
      address: null,
      bloodGroup: null,
    });
  });

  it.each([
    ['firstName', { firstName: '  ' }],
    ['lastName', { lastName: 'x'.repeat(101) }],
    ['dob', { dob: '1990-02-30' }],
    ['dob', { dob: '1899-12-31' }],
    ['dob', { dob: '2999-01-01' }],
    ['sex', { sex: 'f' }],
    ['phone', { phone: '12345' }],
    ['phone', { phone: '90000abc01' }],
    ['email', { email: 'not-an-email' }],
    ['bloodGroup', { bloodGroup: 'C+' }],
  ])('rejects an invalid %s', (field, change) => {
    const result = createPatientSchema.safeParse({ ...valid, ...change });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toContain(field);
  });

  it('accepts a date of birth of today in the hospital time zone', () => {
    expect(createPatientSchema.safeParse({ ...valid, dob: hospitalToday() }).success).toBe(true);
  });

  it('rejects unknown fields, such as an attempt to set the MRN', () => {
    expect(createPatientSchema.safeParse({ ...valid, mrn: 'MRN000001' }).success).toBe(false);
  });
});

describe('updatePatientSchema and patientSearchSchema', () => {
  it('requires the version being edited', () => {
    expect(updatePatientSchema.safeParse(valid).success).toBe(false);
    expect(updatePatientSchema.safeParse({ ...valid, version: 3 }).success).toBe(true);
  });

  it('requires at least 2 search characters', () => {
    expect(patientSearchSchema.safeParse({ q: ' a ' }).success).toBe(false);
    expect(patientSearchSchema.safeParse({ q: 'ab' }).success).toBe(true);
  });

  it('computes "today" in Asia/Kolkata, not UTC', () => {
    // 2026-10-16T20:00Z is already 2026-10-17 01:30 in India.
    expect(hospitalToday(new Date('2026-10-16T20:00:00Z'))).toBe('2026-10-17');
  });
});

describe('normalizeMrn', () => {
  it.each([
    ['MRN000123', 'MRN000123'],
    ['mrn 123', 'MRN000123'],
    ['123', 'MRN000123'],
    ['  000123 ', 'MRN000123'],
    ['MRN1234567', 'MRN1234567'],
  ])('reads %s as %s', (input, mrn) => {
    expect(normalizeMrn(input)).toBe(mrn);
  });
  it.each(['', 'MRN', 'abc', 'MRN12a', '12-34', 'MRN0000000000'])('rejects %j', (input) => {
    expect(normalizeMrn(input)).toBeNull();
  });
});
