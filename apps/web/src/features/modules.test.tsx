/**
 * The unified app across roles: the sidebar each role sees, and key flows against a fake
 * API (the API's own tests prove the server side). Synthetic data only.
 */
import { ROLE_PERMISSIONS, type PermissionCode, type RoleCode } from '@hospitalos/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, fakeApi, json, makeUser, renderApp, session } from '../test-utils';

const as = (role: RoleCode, extra: Partial<Parameters<typeof makeUser>[0]> = {}) =>
  json(
    200,
    session(
      makeUser({
        roles: [role],
        permissions: [...ROLE_PERMISSIONS[role]] as PermissionCode[],
        ...extra,
      }),
    ),
  );

async function sidebar() {
  const nav = await screen.findByRole('navigation', { name: 'Main' });
  return within(nav)
    .getAllByRole('link')
    .map((a) => a.textContent);
}

describe('one app, a sidebar per role', () => {
  it.each<[RoleCode, string[], string[]]>([
    [
      'REC',
      ['Patients', 'Book appointment', 'Queue', 'Follow-ups', 'Invoices'],
      ['Prescriptions', 'Lab worklist', 'Audit log', 'Stock'],
    ],
    ['DOC', ['Queue', 'Medicines', 'Patients'], ['Invoices', 'Book appointment', 'Stock', 'Staff']],
    [
      'PHA',
      ['Prescriptions', 'Stock', 'Transfers', 'Invoices'],
      ['Book appointment', 'Lab worklist', 'Audit log'],
    ],
    ['LAB', ['Lab worklist', 'Lab tests'], ['Invoices', 'Queue', 'Stock']],
    [
      'INV',
      ['Stock', 'Goods receipts', 'Transfers', 'Suppliers', 'Catalogue', 'Equipment'],
      ['Patients', 'Invoices'],
    ],
    ['FIN', ['Invoices', 'Price list', 'Expenses', 'Finance summary'], ['Queue', 'Prescriptions']],
    ['HR', ['Staff', 'Attendance', 'Leave'], ['Patients', 'Invoices']],
    ['MKT', ['Enquiries', 'Campaigns', 'Leave'], ['Patients', 'Queue', 'Prescriptions']],
    ['SA', ['Staff', 'Settings', 'Audit log'], ['Patients', 'Invoices']],
  ])('%s sees its own modules only', async (role, shown, hidden) => {
    fakeApi({ 'GET /api/auth/me': () => as(role) });
    renderApp('/forbidden');
    const links = await sidebar();
    for (const l of shown) expect(links, `${role} should see ${l}`).toContain(l);
    for (const l of hidden) expect(links, `${role} should not see ${l}`).not.toContain(l);
  });

  it('shows the forbidden page for a module outside the role, whatever the URL', async () => {
    fakeApi({ 'GET /api/auth/me': () => as('MKT') });
    renderApp('/pharmacy');
    expect(await screen.findByRole('heading', { name: /don't have access/i })).toBeTruthy();
  });
});

const DOCTOR = {
  id: '00000000-0000-4000-8000-0000000000d1',
  fullName: 'Dr. Zz Test',
  departmentId: 'x',
  departmentName: 'General Medicine',
  specialty: 'GP',
  defaultSlotMinutes: 15,
  consultationFeePaise: 50000,
};
const PATIENT = {
  id: '00000000-0000-4000-8000-0000000000aa',
  mrn: 'MRN000042',
  firstName: 'Zz',
  lastName: 'Patient',
  dob: '1990-05-17',
  sex: 'female',
  phone: '9000000042',
};

describe('booking', () => {
  it('books an available slot for a chosen patient and doctor', async () => {
    const api = fakeApi({
      'GET /api/auth/me': () => as('REC'),
      'GET /api/doctors': () => json(200, { doctors: [DOCTOR] }),
      'GET /api/patients?q=zz': () => json(200, { patients: [PATIENT] }),
      'GET /api/doctors/00000000-0000-4000-8000-0000000000d1/availability?date=2030-01-07': () =>
        json(200, {
          date: '2030-01-07',
          slots: [
            {
              scheduleId: 's',
              slotStart: '2030-01-07T03:30:00.000Z',
              slotEnd: '2030-01-07T03:45:00.000Z',
              available: false,
            },
            {
              scheduleId: 's',
              slotStart: '2030-01-07T03:45:00.000Z',
              slotEnd: '2030-01-07T04:00:00.000Z',
              available: true,
            },
          ],
        }),
      'POST /api/appointments': () =>
        json(201, {
          appointment: {
            id: 'a1',
            appointmentNo: 'APT0000001',
            kind: 'scheduled',
            status: 'booked',
            visitDate: '2030-01-07',
            slotStart: '2030-01-07T03:45:00.000Z',
            slotEnd: '2030-01-07T04:00:00.000Z',
            tokenNo: null,
            patient: PATIENT,
            doctor: { id: DOCTOR.id, fullName: DOCTOR.fullName },
          },
        }),
    });
    renderApp('/appointments/new?date=2030-01-07');
    fireEvent.change(await screen.findByLabelText('Patient (name, phone or MRN)'), {
      target: { value: 'zz' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Zz Patient/ }));
    fireEvent.change(screen.getByLabelText('Doctor', { exact: false }), {
      target: { value: DOCTOR.id },
    });
    const taken = await screen.findByRole('radio', { name: '09:00' });
    expect((taken as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: '09:15' }));
    fireEvent.click(screen.getByRole('button', { name: 'Book slot' }));
    expect(await screen.findByText(/APT0000001/)).toBeTruthy();
    const body = JSON.parse(
      String(api.calls.find((c) => c.key === 'POST /api/appointments')!.init.body),
    );
    expect(body).toEqual({
      kind: 'scheduled',
      patientId: PATIENT.id,
      doctorId: DOCTOR.id,
      slotStart: '2030-01-07T03:45:00.000Z',
    });
  });
});

describe('dispensing', () => {
  const RX = {
    id: 'rx1',
    rxNo: 'RX0000001',
    status: 'issued',
    issuedAt: '2030-01-07T05:00:00.000Z',
    notes: null,
    encounterId: 'e1',
    patient: PATIENT,
    doctor: { id: DOCTOR.id, fullName: DOCTOR.fullName },
    items: [
      {
        id: 'i1',
        medicineProductId: 'm1',
        product: 'Zzcalpol 500 mg tablet',
        dose: '500 mg',
        frequency: 'TDS',
        route: 'oral',
        durationDays: 3,
        qtyPrescribed: 9,
        qtyDispensed: 0,
        instructions: null,
      },
    ],
    allergies: [],
    availability: [
      {
        itemId: 'i1',
        batches: [
          {
            id: 'b1',
            batchNo: 'B1',
            expiryDate: '2030-01-20',
            qtyOnHand: 50,
            salePricePaise: 200,
            location: { id: 'ph', name: 'Main Pharmacy' },
          },
        ],
      },
    ],
    dispensings: [],
  };

  it('asks the pharmacist to acknowledge near-expiry stock, then dispenses', async () => {
    let attempts = 0;
    const api = fakeApi({
      'GET /api/auth/me': () => as('PHA'),
      'GET /api/locations': () =>
        json(200, {
          locations: [{ id: 'ph', code: 'PHARM', name: 'Main Pharmacy', kind: 'pharmacy' }],
        }),
      'GET /api/pharmacy/prescriptions/rx1': () => json(200, { prescription: RX }),
      'POST /api/pharmacy/prescriptions/rx1/dispense': () => {
        attempts += 1;
        return attempts === 1
          ? apiError(409, 'NEAR_EXPIRY', 'Near-expiry stock would be used: B1.')
          : json(201, { dispensingId: 'd1', dispenseNo: 'DSP0000001', replayed: false });
      },
    });
    renderApp('/pharmacy/prescriptions/rx1');
    fireEvent.click(await screen.findByRole('button', { name: 'Dispense' }));
    const dialog = await screen.findByRole('dialog', { name: 'Near-expiry stock' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dispense anyway' }));
    expect(await screen.findByText(/DSP0000001/)).toBeTruthy();
    const posts = api.calls
      .filter((c) => c.key === 'POST /api/pharmacy/prescriptions/rx1/dispense')
      .map((c) => JSON.parse(String(c.init.body)));
    expect(posts[0]).toMatchObject({
      nearExpiryAck: false,
      lines: [{ prescriptionItemId: 'i1', qty: 9 }],
    });
    expect(posts[1]).toMatchObject({ nearExpiryAck: true });
    // Same attempt, same idempotency key: a retry can never dispense twice.
    expect(posts[1].idempotencyKey).toBe(posts[0].idempotencyKey);
  });
});

describe('prescribing', () => {
  it('stops at an allergy warning until the doctor acknowledges it', async () => {
    let attempts = 0;
    const ENC = {
      id: 'e1',
      encounterNo: 'ENC0000001',
      status: 'in_progress',
      chiefComplaint: null,
      startedAt: '2030-01-07T05:00:00.000Z',
      completedAt: null,
      appointmentId: 'a1',
      patient: PATIENT,
      doctor: { id: DOCTOR.id, fullName: DOCTOR.fullName },
      notes: [],
      diagnoses: [],
      vitals: [],
      prescriptions: [],
      followUps: [],
    };
    const api = fakeApi({
      'GET /api/auth/me': () => as('DOC'),
      'GET /api/encounters/e1': () => json(200, { encounter: ENC }),
      'GET /api/patients/00000000-0000-4000-8000-0000000000aa/chart': () =>
        json(200, {
          chart: {
            patient: PATIENT,
            allergies: [
              {
                id: 'al',
                substance: 'paracetamol',
                status: 'active',
                severity: 'mild',
                reaction: null,
                ingredientId: null,
                recordedAt: '',
              },
            ],
            encounters: [],
            vitals: [],
            prescriptions: [],
            followUps: [],
            labOrders: [],
            appointments: [],
          },
        }),
      'GET /api/lab/tests': () => json(200, { tests: [] }),
      'GET /api/stock?q=zzcal&kind=medicine': () =>
        json(200, {
          items: [
            {
              id: 'm1',
              sku: 'ZZ',
              kind: 'medicine',
              name: 'Zzcalpol 500 mg tablet',
              baseUnit: 'tablet',
              category: null,
              reorderLevel: 0,
              tracksExpiry: true,
              totalAvailable: 40,
              batches: [],
              medicine: {
                brandName: 'Zzcalpol',
                manufacturer: null,
                dosageForm: 'tablet',
                route: 'oral',
                packSize: null,
                rxOnly: true,
                ingredients: [],
              },
            },
          ],
        }),
      'POST /api/encounters/e1/prescriptions': () => {
        attempts += 1;
        return attempts === 1
          ? apiError(409, 'ALLERGY_CONFLICT', 'The patient has a recorded allergy that matches.')
          : json(201, { prescriptionId: 'rx1' });
      },
    });
    renderApp('/encounters/e1');
    expect(await screen.findByText(/paracetamol/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Find a medicine (brand, ingredient or code)'), {
      target: { value: 'zzcal' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Zzcalpol 500 mg tablet/ }));
    fireEvent.change(screen.getByLabelText('Dose'), { target: { value: '500 mg' } });
    fireEvent.change(screen.getByLabelText('Frequency'), { target: { value: 'TDS' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue prescription' }));
    const dialog = await screen.findByRole('dialog', { name: 'Allergy warning' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Prescribe anyway' }));
    expect(await screen.findByText('Prescription issued to the pharmacy.')).toBeTruthy();
    const posts = api.calls
      .filter((c) => c.key === 'POST /api/encounters/e1/prescriptions')
      .map((c) => JSON.parse(String(c.init.body)));
    expect(posts.map((p) => p.allergyAcknowledged)).toEqual([false, true]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
