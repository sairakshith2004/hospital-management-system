import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connectTest,
  createTestApp,
  createTestUser,
  inRollback,
  signIn,
} from '../../db/test-db.js';
import { lockIdentity } from './patients.repo.js';

// Synthetic data only.
let client!: pg.Client;
beforeAll(async () => {
  client = await connectTest('app');
});
afterAll(async () => {
  await client?.end();
});
const tx = (work: () => Promise<void>) => () => inRollback(client, work);

const PATIENT = {
  firstName: 'Zz Test',
  lastName: 'Patientone',
  dob: '1985-03-14',
  sex: 'female',
  phone: '9000099901',
  email: 'zz.test@example.invalid',
  address: '1 Test Lane',
  bloodGroup: 'O+',
};

async function setup(roles: string[] = ['REC']) {
  const { app, db } = createTestApp(client);
  const user = await createTestUser(db, { roles });
  const session = await signIn(app, user.username);
  const post = (body: unknown) =>
    request(app)
      .post('/api/patients')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send(body as object);
  const get = (path: string) => request(app).get(path).set('Cookie', session.cookie);
  return { app, db, user, session, post, get };
}

async function audit(action: string) {
  const { rows } = await client.query(
    `SELECT actor_user_id, entity_id, patient_id, reason, changes FROM audit_logs
     WHERE action = $1 AND occurred_at = now() ORDER BY id`,
    [action],
  );
  return rows;
}

describe('POST /api/patients', () => {
  it(
    'registers a patient with a generated MRN and audits it (PR-1)',
    tx(async () => {
      const { post, user } = await setup();
      const res = await post(PATIENT);
      expect(res.status).toBe(201);
      expect(res.body.patient).toMatchObject({ ...PATIENT, version: 1 });
      expect(res.body.patient.mrn).toMatch(/^MRN\d{6}$/);
      expect(await audit('patient.created')).toEqual([
        {
          actor_user_id: user.id,
          entity_id: res.body.patient.id,
          patient_id: res.body.patient.id,
          reason: null,
          changes: null,
        },
      ]);
    }),
  );

  it(
    'gives every registration a distinct, increasing MRN',
    tx(async () => {
      const { post } = await setup();
      const mrns: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const res = await post({ ...PATIENT, phone: `900009991${i}` });
        mrns.push(res.body.patient.mrn);
      }
      expect(new Set(mrns).size).toBe(3);
      expect([...mrns].sort()).toEqual(mrns);
    }),
  );

  it(
    'warns about a possible duplicate (same phone and date of birth), then registers on confirmation (PR-2)',
    tx(async () => {
      const { post } = await setup();
      const first = await post(PATIENT);
      const again = await post({ ...PATIENT, firstName: 'Different' });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('DUPLICATE_SUSPECTED');
      expect(again.body.error.data.candidates).toEqual([
        {
          id: first.body.patient.id,
          mrn: first.body.patient.mrn,
          firstName: PATIENT.firstName,
          lastName: PATIENT.lastName,
        },
      ]);
      const confirmed = await post({ ...PATIENT, firstName: 'Different', confirmDuplicate: true });
      expect(confirmed.status).toBe(201);
      expect((await audit('patient.created')).map((r) => r.reason)).toEqual([
        null,
        'duplicate_confirmed',
      ]);
    }),
  );

  it(
    'returns 422 with field paths and never echoes the submitted values (PR-3)',
    tx(async () => {
      const { post } = await setup();
      const res = await post({ ...PATIENT, phone: 'zz-bad-phone', dob: '2999-01-01', extra: 1 });
      expect(res.status).toBe(422);
      const paths = res.body.error.details.map((d: { path: string }) => d.path);
      expect(paths).toEqual(expect.arrayContaining(['phone', 'dob']));
      expect(JSON.stringify(res.body)).not.toContain('zz-bad-phone');
    }),
  );

  it(
    'is refused without the CSRF token',
    tx(async () => {
      const { app, session } = await setup();
      const res = await request(app)
        .post('/api/patients')
        .set('Cookie', session.cookie)
        .send(PATIENT);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_INVALID');
    }),
  );
});

describe('GET /api/patients (search) and /api/patients/:id', () => {
  it(
    'finds patients by MRN, by phone digits and by partial or misspelt name',
    tx(async () => {
      const { post, get } = await setup();
      const created = (await post(PATIENT)).body.patient;
      await post({
        ...PATIENT,
        firstName: 'Zz Other',
        lastName: 'Personfour',
        phone: '9000099902',
      });
      const find = async (q: string) =>
        (await get(`/api/patients?q=${encodeURIComponent(q)}`)).body.patients.map(
          (p: { mrn: string }) => p.mrn,
        );
      expect(await find(created.mrn.toLowerCase())).toEqual([created.mrn]);
      expect(await find('99901')).toEqual([created.mrn]);
      expect(await find('patientone')).toContain(created.mrn);
      expect(await find('Zz Test Patientonne')).toContain(created.mrn); // fuzzy
      expect(await find('zz_nomatch%')).toEqual([]); // wildcards are literal
    }),
  );

  it(
    'requires at least 2 characters',
    tx(async () => {
      const { get } = await setup();
      expect((await get('/api/patients?q=a')).status).toBe(422);
      expect((await get('/api/patients')).status).toBe(422);
    }),
  );

  it(
    'returns one patient, and 404 for unknown or malformed IDs',
    tx(async () => {
      const { post, get } = await setup();
      const created = (await post(PATIENT)).body.patient;
      expect((await get(`/api/patients/${created.id}`)).body.patient).toEqual(created);
      expect((await get('/api/patients/00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect((await get('/api/patients/not-a-uuid')).status).toBe(404);
    }),
  );
});

describe('PATCH /api/patients/:id', () => {
  it(
    'updates, bumps the version and audits only the changed field names (PR-4)',
    tx(async () => {
      const { app, post, session } = await setup();
      const created = (await post(PATIENT)).body.patient;
      const res = await request(app)
        .patch(`/api/patients/${created.id}`)
        .set('Cookie', session.cookie)
        .set('X-CSRF-Token', session.csrf)
        .send({ ...PATIENT, phone: '9000099909', address: '2 Test Lane', version: 1 });
      expect(res.status).toBe(200);
      expect(res.body.patient).toMatchObject({
        phone: '9000099909',
        address: '2 Test Lane',
        version: 2,
      });
      const rows = await audit('patient.updated');
      expect(rows).toHaveLength(1);
      expect(rows[0].changes).toEqual({ fields: ['phone', 'address'] });
      expect(JSON.stringify(rows)).not.toContain('9000099909');
    }),
  );

  it(
    'refuses a stale version with 409 STALE_VERSION and changes nothing',
    tx(async () => {
      const { app, post, session } = await setup();
      const created = (await post(PATIENT)).body.patient;
      const patch = (body: object) =>
        request(app)
          .patch(`/api/patients/${created.id}`)
          .set('Cookie', session.cookie)
          .set('X-CSRF-Token', session.csrf)
          .send(body);
      expect((await patch({ ...PATIENT, address: 'A', version: 1 })).status).toBe(200);
      const stale = await patch({ ...PATIENT, address: 'B', version: 1 });
      expect(stale.status).toBe(409);
      expect(stale.body.error).toMatchObject({
        code: 'STALE_VERSION',
        data: { currentVersion: 2 },
      });
      const { rows } = await client.query('SELECT address, version FROM patients WHERE id = $1', [
        created.id,
      ]);
      expect(rows[0]).toEqual({ address: 'A', version: 2 });
    }),
  );

  it(
    'writes nothing when no field changed',
    tx(async () => {
      const { app, post, session } = await setup();
      const created = (await post(PATIENT)).body.patient;
      const res = await request(app)
        .patch(`/api/patients/${created.id}`)
        .set('Cookie', session.cookie)
        .set('X-CSRF-Token', session.csrf)
        .send({ ...PATIENT, version: 1 });
      expect(res.body.patient.version).toBe(1);
      expect(await audit('patient.updated')).toEqual([]);
    }),
  );
});

describe('permissions on patient endpoints', () => {
  it(
    'gives 401 without a session',
    tx(async () => {
      const { app } = createTestApp(client);
      expect((await request(app).get('/api/patients?q=ab')).status).toBe(401);
      expect((await request(app).post('/api/patients').send(PATIENT)).status).toBe(401);
    }),
  );

  it.each([['DOC'], ['NUR'], ['PHA'], ['LAB'], ['FIN'], ['ADM']])(
    '%s can search and read but not register (audited 403)',
    (role) =>
      tx(async () => {
        const { get, post, user } = await setup([role]);
        expect((await get('/api/patients?q=zz')).status).toBe(200);
        const res = await post(PATIENT);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
        const denied = await client.query(
          `SELECT entity_id, changes FROM audit_logs
           WHERE action = 'access.denied' AND actor_user_id = $1 AND occurred_at = now()`,
          [user.id],
        );
        expect(denied.rows).toEqual([
          { entity_id: 'POST /api/patients/', changes: { permission: 'patient:create' } },
        ]);
      })(),
  );

  it.each([['HR'], ['INV'], ['MKT'], ['SA']])('%s cannot search patients', (role) =>
    tx(async () => {
      const { get } = await setup([role]);
      expect((await get('/api/patients?q=zz')).status).toBe(403);
    })(),
  );

  it(
    'only REC can edit demographics',
    tx(async () => {
      const rec = await setup(['REC']);
      const created = (await rec.post(PATIENT)).body.patient;
      const { app } = rec;
      const doc = await createTestUser(rec.db, { roles: ['DOC'] });
      const docSession = await signIn(app, doc.username);
      const res = await request(app)
        .patch(`/api/patients/${created.id}`)
        .set('Cookie', docSession.cookie)
        .set('X-CSRF-Token', docSession.csrf)
        .send({ ...PATIENT, version: 1 });
      expect(res.status).toBe(403);
    }),
  );
});

describe('concurrent registrations (two real connections, both rolled back)', () => {
  const insert = (c: pg.Client, phone: string) =>
    c.query<{ mrn: string }>(
      `INSERT INTO patients (first_name, last_name, dob, sex, phone)
       VALUES ('Zz Conc', 'Patient', '1990-01-01', 'male', $1) RETURNING mrn`,
      [phone],
    );

  it('serialises two registrations of the same person, and gives distinct MRNs', async () => {
    const a = await connectTest('app');
    const b = await connectTest('app');
    try {
      await a.query('BEGIN');
      await b.query('BEGIN');
      await lockIdentity(a, '9000099950', '1990-01-01');
      const aMrn = (await insert(a, '9000099950')).rows[0]!.mrn;

      let bAcquired = false;
      const bLock = lockIdentity(b, '9000099950', '1990-01-01').then(() => {
        bAcquired = true;
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(bAcquired).toBe(false); // B waits while A holds the identity lock

      await a.query('ROLLBACK');
      await bLock;
      expect(bAcquired).toBe(true);
      const bMrn = (await insert(b, '9000099950')).rows[0]!.mrn;
      expect(bMrn).not.toBe(aMrn);
    } finally {
      await a.query('ROLLBACK').catch(() => undefined);
      await b.query('ROLLBACK').catch(() => undefined);
      await a.end();
      await b.end();
    }
  });

  it('never lets two parallel inserts share an MRN', async () => {
    const clients = await Promise.all([1, 2, 3, 4].map(() => connectTest('app')));
    try {
      await Promise.all(clients.map((c) => c.query('BEGIN')));
      const mrns = await Promise.all(
        clients.map(async (c, i) => (await insert(c, `90000999${60 + i}`)).rows[0]!.mrn),
      );
      expect(new Set(mrns).size).toBe(4);
    } finally {
      await Promise.all(clients.map((c) => c.query('ROLLBACK').catch(() => undefined)));
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});
