import type { Patient } from '@hospitalos/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, fakeApi, json, makeUser, renderApp, session } from '../../test-utils';

// Synthetic data only.
const receptionist = () =>
  json(
    200,
    session(
      makeUser({
        roles: ['REC'],
        permissions: ['patient:read_demographics', 'patient:create', 'patient:update_demographics'],
      }),
    ),
  );
const doctor = () =>
  json(
    200,
    session(
      makeUser({
        fullName: 'Dr. Test',
        roles: ['DOC'],
        permissions: ['patient:read_demographics'],
      }),
    ),
  );

const PATIENT: Patient = {
  id: '00000000-0000-4000-8000-0000000000aa',
  mrn: 'MRN000042',
  firstName: 'Zz Test',
  lastName: 'Patient',
  dob: '1990-05-17',
  sex: 'female',
  phone: '9000000042',
  email: null,
  address: '1 Test Lane',
  bloodGroup: 'O+',
  version: 1,
  createdAt: '2026-10-17T00:00:00.000Z',
  updatedAt: '2026-10-17T00:00:00.000Z',
};

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } });

async function fillForm() {
  await screen.findByRole('heading', { name: 'Register patient' });
  type('First name', 'Zz Test');
  type('Last name', 'Patient');
  type('Date of birth', '1990-05-17');
  fireEvent.change(screen.getByLabelText('Sex', { exact: false }), { target: { value: 'female' } });
  type('Phone', '90000 00042');
}

describe('patient search', () => {
  it('searches after 2 characters and links each result to its record', async () => {
    const api = fakeApi({
      'GET /api/auth/me': receptionist,
      'GET /api/patients?q=zz': () => json(200, { patients: [PATIENT] }),
    });
    renderApp('/patients');
    const box = await screen.findByLabelText('Search by name, phone number or MRN');
    expect(screen.getByText('Type at least 2 characters to search.')).toBeTruthy();
    fireEvent.change(box, { target: { value: 'zz' } });
    const link = await screen.findByRole('link', { name: 'Zz Test Patient' });
    expect(link.getAttribute('href')).toBe(`/patients/${PATIENT.id}`);
    expect(screen.getByText('MRN000042')).toBeTruthy();
    expect(api.calls.filter((c) => c.key.startsWith('GET /api/patients'))).toHaveLength(1);
  });

  it('says so when nothing matches', async () => {
    fakeApi({
      'GET /api/auth/me': receptionist,
      'GET /api/patients?q=nobody': () => json(200, { patients: [] }),
    });
    renderApp('/patients?q=nobody');
    expect(await screen.findByText('No patients match “nobody”.')).toBeTruthy();
  });

  it('shows "Register patient" only to users who may register', async () => {
    fakeApi({ 'GET /api/auth/me': doctor });
    renderApp('/patients');
    await screen.findByLabelText('Search by name, phone number or MRN');
    expect(screen.queryByRole('link', { name: 'Register patient' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Patients' })).toBeTruthy(); // in the navigation
    expect(screen.queryByRole('link', { name: 'Doctors' })).toBeNull(); // no schedule:read
  });
});

describe('patient registration', () => {
  it('shows field errors from the shared schema before calling the API', async () => {
    const api = fakeApi({ 'GET /api/auth/me': receptionist });
    renderApp('/patients/new');
    await screen.findByRole('heading', { name: 'Register patient' });
    type('Phone', '123');
    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    expect(await screen.findByText('Phone must be 7–15 digits')).toBeTruthy();
    expect(screen.getByText('First name is required')).toBeTruthy();
    expect(api.calls.some((c) => c.key === 'POST /api/patients')).toBe(false);
  });

  it('registers with normalised values and opens the new record', async () => {
    const api = fakeApi({
      'GET /api/auth/me': receptionist,
      'POST /api/patients': () => json(201, { patient: PATIENT }),
      [`GET /api/patients/${PATIENT.id}`]: () => json(200, { patient: PATIENT }),
    });
    const { router } = renderApp('/patients/new');
    await fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    expect(await screen.findByRole('heading', { name: 'Zz Test Patient' })).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/patients/${PATIENT.id}`);
    const sent = JSON.parse(
      String(api.calls.find((c) => c.key === 'POST /api/patients')!.init.body),
    );
    expect(sent).toMatchObject({ firstName: 'Zz Test', phone: '9000000042', email: null });
  });

  it('warns about a possible duplicate and registers anyway only when asked', async () => {
    let attempt = 0;
    const api = fakeApi({
      'GET /api/auth/me': receptionist,
      'POST /api/patients': () => {
        attempt += 1;
        return attempt === 1
          ? json(409, {
              error: {
                code: 'DUPLICATE_SUSPECTED',
                message: 'Possible duplicate',
                requestId: 'r',
                data: {
                  candidates: [
                    { id: PATIENT.id, mrn: PATIENT.mrn, firstName: 'Zz Test', lastName: 'Patient' },
                  ],
                },
              },
            })
          : json(201, { patient: PATIENT });
      },
      [`GET /api/patients/${PATIENT.id}`]: () => json(200, { patient: PATIENT }),
    });
    renderApp('/patients/new');
    await fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    expect(await screen.findByRole('link', { name: 'Zz Test Patient (MRN000042)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Register anyway' }));
    await screen.findByRole('heading', { name: 'Zz Test Patient' });
    const bodies = api.calls
      .filter((c) => c.key === 'POST /api/patients')
      .map((c) => JSON.parse(String(c.init.body)).confirmDuplicate);
    expect(bodies).toEqual([false, true]);
  });

  it('shows the API’s field errors (422) on the matching fields', async () => {
    fakeApi({
      'GET /api/auth/me': receptionist,
      'POST /api/patients': () =>
        json(422, {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'The request is not valid',
            requestId: 'r',
            details: [{ path: 'dob', message: 'Date of birth cannot be in the future' }],
          },
        }),
    });
    renderApp('/patients/new');
    await fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    expect(await screen.findByText('Date of birth cannot be in the future')).toBeTruthy();
  });
});

describe('patient detail and edit', () => {
  it('shows demographics; Edit only with permission', async () => {
    fakeApi({
      'GET /api/auth/me': doctor,
      [`GET /api/patients/${PATIENT.id}`]: () => json(200, { patient: PATIENT }),
    });
    renderApp(`/patients/${PATIENT.id}`);
    expect(await screen.findByText('1 Test Lane')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
  });

  it('shows the 404 page for an unknown patient', async () => {
    fakeApi({
      'GET /api/auth/me': receptionist,
      'GET /api/patients/missing': () => apiError(404, 'NOT_FOUND', 'Patient not found'),
    });
    renderApp('/patients/missing');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
  });

  it('sends the version being edited and explains a stale-version conflict', async () => {
    const api = fakeApi({
      'GET /api/auth/me': receptionist,
      [`GET /api/patients/${PATIENT.id}`]: () => json(200, { patient: PATIENT }),
      [`PATCH /api/patients/${PATIENT.id}`]: () =>
        apiError(409, 'STALE_VERSION', 'This patient was changed by someone else.'),
    });
    renderApp(`/patients/${PATIENT.id}/edit`);
    await screen.findByRole('heading', { name: 'Edit Zz Test Patient' });
    type('Address', '2 Test Lane');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/Someone else changed this patient/)).toBeTruthy();
    const sent = JSON.parse(String(api.calls.find((c) => c.key.startsWith('PATCH'))!.init.body));
    expect(sent).toMatchObject({ version: 1, address: '2 Test Lane' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reload latest' })).toBeTruthy());
  });

  it('shows the forbidden page to a user without edit permission', async () => {
    fakeApi({ 'GET /api/auth/me': doctor });
    renderApp(`/patients/${PATIENT.id}/edit`);
    expect(await screen.findByRole('heading', { name: /don't have access/ })).toBeTruthy();
  });
});
