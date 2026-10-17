import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fakeApi, json, makeUser, renderApp, session } from '../../test-utils';

const doctors = [
  {
    id: 'd1',
    fullName: 'Dr. Zz One',
    departmentId: 'gm',
    departmentName: 'General Medicine',
    specialty: 'General Physician',
    defaultSlotMinutes: 15,
    consultationFeePaise: 50000,
  },
  {
    id: 'd2',
    fullName: 'Dr. Zz Two',
    departmentId: 'pd',
    departmentName: 'Paediatrics',
    specialty: 'Paediatrician',
    defaultSlotMinutes: 20,
    consultationFeePaise: 60000,
  },
];

describe('doctor directory', () => {
  it('groups doctors by department with fees, and filters by department', async () => {
    fakeApi({
      'GET /api/auth/me': () => json(200, session(makeUser({ permissions: ['schedule:read'] }))),
      'GET /api/doctors': () => json(200, { doctors }),
    });
    renderApp('/doctors');
    expect(await screen.findByRole('heading', { name: 'General Medicine' })).toBeTruthy();
    expect(screen.getByText('Consultation ₹500.00 · 15-minute slots')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'pd' } });
    expect(screen.queryByText('Dr. Zz One')).toBeNull();
    expect(screen.getByText('Dr. Zz Two')).toBeTruthy();
  });

  it('is hidden from users without schedule:read', async () => {
    fakeApi({ 'GET /api/auth/me': () => json(200, session(makeUser({ permissions: [] }))) });
    renderApp('/doctors');
    expect(await screen.findByRole('heading', { name: /don't have access/ })).toBeTruthy();
  });
});
