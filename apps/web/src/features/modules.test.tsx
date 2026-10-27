/**
 * The unified app across roles: the sidebar each role sees, and key flows against a fake
 * API (the API's own tests prove the server side). Synthetic data only.
 */
import {
  ROLE_PERMISSIONS,
  hospitalToday,
  type PermissionCode,
  type RoleCode,
} from '@hospitalos/shared';
import { addDays } from '../lib/format';
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
      ['Patients', 'Book appointment', 'Queue', 'Follow-ups', 'Invoices', 'Patients per doctor'],
      [
        'Prescriptions',
        'Lab worklist',
        'Audit log',
        'Stock',
        'My appointments',
        'Doctor earnings',
        'My earnings',
      ],
    ],
    [
      'DOC',
      ['My appointments', 'My earnings', 'Queue', 'Medicines', 'Patients'],
      ['Invoices', 'Book appointment', 'Stock', 'Staff', 'Doctor earnings', 'Patients per doctor'],
    ],
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
    [
      'FIN',
      ['Invoices', 'Price list', 'Expenses', 'Finance summary', 'Doctor earnings'],
      ['Queue', 'Prescriptions', 'My earnings', 'Patients per doctor'],
    ],
    ['HR', ['Staff', 'Attendance', 'Leave'], ['Patients', 'Invoices']],
    ['MKT', ['Enquiries', 'Campaigns', 'Leave'], ['Patients', 'Queue', 'Prescriptions']],
    [
      // The Super Admin heads the hospital: every department in one portal, clinical work
      // included, using the hospital-wide pages rather than a doctor's own ones.
      'SA',
      [
        'Patients',
        'Appointments',
        'Queue',
        'Prescriptions',
        'Stock',
        'Lab worklist',
        'Lab tests',
        'Invoices',
        'Staff',
        'Attendance',
        'Leave',
        'Expenses',
        'Finance summary',
        'Equipment',
        'Enquiries',
        'Campaigns',
        'Settings',
        'Audit log',
        'Medicines',
        'Doctors and schedules',
      ],
      ['My appointments', 'My earnings'],
    ],
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

describe('doctor dashboard', () => {
  it('shows a visit booked at reception for a later day, not only checked-in patients', async () => {
    const today = hospitalToday();
    const booked = {
      id: '00000000-0000-4000-8000-0000000000a9',
      appointmentNo: 'APT0000009',
      kind: 'scheduled',
      status: 'booked',
      visitDate: addDays(today, 2),
      slotStart: `${addDays(today, 2)}T03:30:00.000Z`,
      slotEnd: `${addDays(today, 2)}T03:40:00.000Z`,
      tokenNo: null,
      checkedInAt: null,
      patient: {
        id: '00000000-0000-4000-8000-0000000000b9',
        mrn: 'MRN0000099',
        firstName: 'Zz',
        lastName: 'Future',
      },
      doctor: { id: '00000000-0000-4000-8000-0000000000d1', fullName: 'Dr. Zz Test' },
      departmentId: '00000000-0000-4000-8000-0000000000e1',
      rescheduledFromId: null,
    };
    const handlers: Record<string, () => Response> = {
      'GET /api/auth/me': () => as('DOC', { fullName: 'Dr. Zz Test' }),
    };
    for (let i = 0; i < 7; i++) {
      const date = addDays(today, i);
      handlers[`GET /api/appointments?date=${date}`] = () =>
        json(200, { appointments: i === 2 ? [booked] : [] });
    }
    const api = fakeApi(handlers);
    renderApp('/');
    const section = await screen.findByRole('region', { name: /My appointments — next 7 days/ });
    expect(await within(section).findByText('Zz Future')).toBeTruthy();
    expect(within(section).getByText('MRN0000099')).toBeTruthy();
    // The doctor never asks for another doctor's list: no doctorId in any request.
    expect(api.calls.filter((c) => c.key.includes('doctorId='))).toEqual([]);
  });
});

describe('doctor reports', () => {
  const row = (id: string, name: string, patients: number, billed: string | null) => ({
    doctorId: id,
    fullName: name,
    departmentName: 'Zz Medicine',
    visits: {
      patients,
      booked: 1,
      waiting: 1,
      inConsultation: 0,
      seen: patients - 2,
      noShow: 0,
      cancelled: 0,
    },
    earnings:
      billed === null ? null : { consultations: patients - 1, billedPaise: billed, paidPaise: '0' },
  });

  it('shows finance each doctor’s consultation fees with totals', async () => {
    const today = hospitalToday();
    const from = `${today.slice(0, 8)}01`;
    fakeApi({
      'GET /api/auth/me': () => as('FIN'),
      [`GET /api/reports/doctors?from=${from}&to=${today}`]: () =>
        json(200, {
          report: {
            from,
            to: today,
            scope: 'all',
            rows: [
              row('00000000-0000-4000-8000-0000000000d1', 'Dr. Zz One', 5, '200000'),
              row('00000000-0000-4000-8000-0000000000d2', 'Dr. Zz Two', 3, '100000'),
            ],
          },
        }),
    });
    renderApp('/reports/doctor-earnings');
    expect(await screen.findByRole('heading', { name: 'Doctor earnings' })).toBeTruthy();
    const table = await screen.findByRole('table', { name: 'Doctor earnings' });
    expect(within(table).getByText('Dr. Zz One')).toBeTruthy();
    expect(within(table).getByText('₹2,000.00')).toBeTruthy();
    expect(screen.getByText('₹3,000.00')).toBeTruthy(); // total fees billed
  });

  it('shows reception the patient count per doctor, without earnings', async () => {
    const today = hospitalToday();
    fakeApi({
      'GET /api/auth/me': () => as('REC'),
      [`GET /api/reports/doctors?from=${today}&to=${today}`]: () =>
        json(200, {
          report: {
            from: today,
            to: today,
            scope: 'all',
            rows: [row('00000000-0000-4000-8000-0000000000d1', 'Dr. Zz One', 4, null)],
          },
        }),
    });
    renderApp('/reports/doctors');
    const table = await screen.findByRole('table', { name: 'Patients per doctor' });
    expect(within(table).getByText('Dr. Zz One')).toBeTruthy();
    expect(within(table).queryByText(/₹/)).toBeNull();
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

describe('lookup by patient number', () => {
  const WHO = {
    id: PATIENT.id,
    mrn: PATIENT.mrn,
    firstName: PATIENT.firstName,
    lastName: PATIENT.lastName,
    dob: PATIENT.dob,
    sex: PATIENT.sex,
  };
  const rx = (id: string, status: string) => ({
    id,
    rxNo: `RX-${id}`,
    status,
    issuedAt: '2030-01-07T05:00:00.000Z',
    notes: null,
    encounterId: 'e1',
    patient: WHO,
    doctor: { id: DOCTOR.id, fullName: DOCTOR.fullName },
    items: [],
  });

  it('shows pharmacy the patient’s prescriptions to dispense and past ones, from just the digits', async () => {
    fakeApi({
      'GET /api/auth/me': () => as('PHA'),
      'GET /api/pharmacy/prescriptions?status=open': () => json(200, { prescriptions: [] }),
      'GET /api/pharmacy/patients/MRN000042': () =>
        json(200, {
          patient: WHO,
          allergies: [{ id: 'a1', substance: 'Zzpenicillin', reaction: null, severity: 'severe' }],
          prescriptions: [rx('open1', 'issued'), rx('old1', 'dispensed')],
        }),
    });
    renderApp('/pharmacy');
    fireEvent.change(await screen.findByLabelText('Patient number'), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    expect(await screen.findByRole('heading', { name: 'Zz Patient' })).toBeTruthy();
    expect(screen.getByText(/Zzpenicillin/)).toBeTruthy();
    const toDo = screen.getByRole('table', { name: 'Prescriptions to dispense' });
    expect(within(toDo).getByText('RX-open1')).toBeTruthy();
    const past = screen.getByRole('table', { name: 'Previous prescriptions' });
    expect(within(past).getByText('RX-old1')).toBeTruthy();
  });

  it('says so when the number is not a patient number, without calling the API', async () => {
    const api = fakeApi({
      'GET /api/auth/me': () => as('LAB'),
      'GET /api/lab/orders': () => json(200, { orders: [] }),
    });
    renderApp('/lab');
    fireEvent.change(await screen.findByLabelText('Patient number'), {
      target: { value: 'abc' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    expect(await screen.findByText(/for example MRN000123/)).toBeTruthy();
    expect(api.calls.some((c) => c.key.includes('/api/lab/patients/'))).toBe(false);
  });

  it('shows an unknown patient number as not found', async () => {
    fakeApi({
      'GET /api/auth/me': () => as('FIN'),
      'GET /api/billing/patients/MRN000999': () =>
        apiError(404, 'NOT_FOUND', 'No patient has this patient number'),
    });
    renderApp('/billing?mrn=MRN000999');
    expect(await screen.findByText('No patient has this patient number')).toBeTruthy();
  });

  it('splits billing into bills to be paid and past bills, with the amount due', async () => {
    const inv = (id: string, status: string, total: number, paid: number) => ({
      id,
      invoiceNo: `INV-${id}`,
      status,
      patient: WHO,
      appointmentId: null,
      totalPaise: total,
      paidPaise: paid,
      balancePaise: total - paid,
      createdAt: '2030-01-07T05:00:00.000Z',
      issuedAt: '2030-01-07T05:00:00.000Z',
    });
    fakeApi({
      'GET /api/auth/me': () => as('FIN'),
      'GET /api/billing/patients/MRN000042': () =>
        json(200, {
          patient: WHO,
          invoices: [
            inv('due1', 'partially_paid', 50000, 20000),
            inv('old1', 'paid', 30000, 30000),
          ],
        }),
    });
    renderApp('/billing?mrn=mrn42');
    const due = await screen.findByRole('table', { name: 'Bills to be paid' });
    expect(within(due).getByText('INV-due1')).toBeTruthy();
    expect(
      within(screen.getByRole('table', { name: 'Past bills' })).getByText('INV-old1'),
    ).toBeTruthy();
    expect(screen.getByText(/Due ₹\s?300/)).toBeTruthy();
  });
});
