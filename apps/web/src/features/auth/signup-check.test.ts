import { describe, expect, it } from 'vitest';
import { checkSignup } from './SignupPage';

const ok = {
  fullName: 'Zz Nurse',
  username: 'zz.nurse',
  departmentId: '00000000-0000-4000-8000-000000000001',
  designation: 'Staff Nurse',
  password: 'long-enough-pass',
  confirm: 'long-enough-pass',
};

describe('checkSignup', () => {
  it('accepts a complete form', () => {
    expect(checkSignup(ok)).toEqual({});
  });

  it('explains each problem', () => {
    expect(
      checkSignup({
        ...ok,
        username: 'Zz Nurse',
        password: 'short',
        confirm: 'other',
        departmentId: '',
      }),
    ).toEqual({
      username: '3–50 lowercase letters, digits, . _ or -, starting with a letter',
      departmentId: 'Choose your department',
      password: 'At least 12 characters',
      confirm: 'The passwords do not match',
    });
  });
});
