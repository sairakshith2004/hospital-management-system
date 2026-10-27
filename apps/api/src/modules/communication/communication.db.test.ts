/**
 * Communication hub through the real API on hms_test, each test in one rolled-back
 * transaction. Synthetic data only.
 */
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connectTest,
  createTestApp,
  createTestUser,
  expectSqlError,
  inRollback,
  signIn,
} from '../../db/test-db.js';

let client!: pg.Client;
beforeAll(async () => {
  client = await connectTest('app');
});
afterAll(async () => {
  await client?.end();
});
const tx = (work: () => Promise<void>) => () => inRollback(client, work);

async function setup() {
  const { app, db } = createTestApp(client);
  const as = async (roles: string[]) => {
    const u = await createTestUser(db, { roles });
    const s = await signIn(app, u.username);
    const send = (path: string, body: object = {}) =>
      request(app).post(path).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).send(body);
    return {
      id: u.id,
      get: (path: string) => request(app).get(path).set('Cookie', s.cookie),
      post: send,
    };
  };
  /** A user with the DOC role and an active doctor profile. */
  const doctor = async () => {
    const d = await as(['DOC']);
    await client.query(
      `INSERT INTO doctor_profiles (employee_id, department_id, specialty, registration_no, consultation_fee_paise)
       SELECT u.employee_id, e.department_id, 'Zz Cardiology', 'ZZ-REG-' || u.id, 50000
         FROM users u JOIN employees e ON e.id = u.employee_id WHERE u.id = $1`,
      [d.id],
    );
    return d;
  };
  return { app, as, doctor };
}

const audit = async (action: string) =>
  (
    await client.query(
      'SELECT entity_id, changes FROM audit_logs WHERE action = $1 AND occurred_at = now()',
      [action],
    )
  ).rows;

describe('notices', () => {
  it(
    'publishes to the right audience, tracks reads and is limited to publishers',
    tx(async () => {
      const f = await setup();
      const hr = await f.as(['HR']);
      const nurse = await f.as(['NUR']);
      const pharmacist = await f.as(['PHA']);

      expect(
        (await nurse.post('/api/comm/notices', { title: 'x', body: 'y', audience: 'all' })).status,
      ).toBe(403);
      // The audience's target is required, and only that target.
      expect(
        (await hr.post('/api/comm/notices', { title: 'x', body: 'y', audience: 'role' })).status,
      ).toBe(422);

      const toNurses = await hr.post('/api/comm/notices', {
        title: 'Zz infection control',
        body: 'Gloves in every ward.',
        audience: 'role',
        roleCode: 'NUR',
        priority: 'urgent',
      });
      expect(toNurses.status, JSON.stringify(toNurses.body)).toBe(201);
      expect(await audit('notice.published')).toEqual([
        { entity_id: toNurses.body.id, changes: { audience: 'role', priority: 'urgent' } },
      ]);

      const nurseNotices = (await nurse.get('/api/comm/notices')).body.notices;
      expect(nurseNotices.map((n: { title: string }) => n.title)).toContain('Zz infection control');
      expect((await pharmacist.get('/api/comm/notices')).body.notices).toEqual([]);

      const before = (await nurse.get('/api/comm/summary')).body.unreadNotices;
      await nurse.post(`/api/comm/notices/${toNurses.body.id}/read`);
      await nurse.post(`/api/comm/notices/${toNurses.body.id}/read`); // idempotent
      expect((await nurse.get('/api/comm/summary')).body.unreadNotices).toBe(before - 1);
      // Marking a notice you can't see does nothing.
      await pharmacist.post(`/api/comm/notices/${toNurses.body.id}/read`);
      const reads = await client.query('SELECT user_id FROM notice_reads WHERE notice_id = $1', [
        toNurses.body.id,
      ]);
      expect(reads.rows).toEqual([{ user_id: nurse.id }]);

      // One person only.
      const personal = await hr.post('/api/comm/notices', {
        title: 'Zz for you',
        body: 'Please see HR.',
        audience: 'user',
        userId: pharmacist.id,
      });
      expect(personal.status).toBe(201);
      expect((await pharmacist.get('/api/comm/notices')).body.notices[0].title).toBe('Zz for you');
      expect(
        (await nurse.get('/api/comm/notices')).body.notices.map((n: { id: string }) => n.id),
      ).not.toContain(personal.body.id);
    }),
  );

  it(
    'cannot be edited or deleted',
    tx(async () => {
      const f = await setup();
      const hr = await f.as(['HR']);
      const { id } = (
        await hr.post('/api/comm/notices', { title: 'Zz', body: 'Zz', audience: 'all' })
      ).body;
      await expectSqlError(
        client,
        `UPDATE notices SET title = 'changed' WHERE id = $1`,
        '42501',
        undefined,
        [id],
      );
    }),
  );
});

describe('conversations and messages', () => {
  it(
    'keeps one direct chat per pair, counts unread, and hides chats from non-members',
    tx(async () => {
      const f = await setup();
      const a = await f.as(['NUR']);
      const b = await f.as(['REC']);
      const outsider = await f.as(['LAB']);

      const first = await a.post('/api/comm/conversations', { kind: 'direct', userId: b.id });
      expect(first.status).toBe(201);
      const again = await b.post('/api/comm/conversations', { kind: 'direct', userId: a.id });
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(first.body.id);
      expect(await audit('conversation.created')).toHaveLength(1);
      expect(
        (await a.post('/api/comm/conversations', { kind: 'direct', userId: a.id })).body.error.code,
      ).toBe('SELF_CONVERSATION');

      const id = first.body.id as string;
      expect(
        (await a.post(`/api/comm/conversations/${id}/messages`, { body: 'Zz hello' })).status,
      ).toBe(201);
      expect((await b.get('/api/comm/summary')).body.unreadMessages).toBe(1);
      expect((await a.get('/api/comm/summary')).body.unreadMessages).toBe(0);

      const list = (await b.get('/api/comm/conversations')).body.conversations;
      expect(list[0]).toMatchObject({ id, kind: 'direct', lastMessage: 'Zz hello', unread: 1 });
      expect(list[0].others).toEqual([{ id: a.id, fullName: 'Test Person' }]);

      const msgs = (await b.get(`/api/comm/conversations/${id}/messages`)).body.messages;
      expect(msgs).toMatchObject([{ body: 'Zz hello', mine: false, senderId: a.id }]);
      await b.post(`/api/comm/conversations/${id}/read`);
      expect((await b.get('/api/comm/summary')).body.unreadMessages).toBe(0);

      // Non-members get the same 404 as an unknown conversation.
      expect((await outsider.get(`/api/comm/conversations/${id}/messages`)).status).toBe(404);
      expect(
        (await outsider.post(`/api/comm/conversations/${id}/messages`, { body: 'x' })).status,
      ).toBe(404);
      expect((await outsider.post(`/api/comm/conversations/${id}/read`)).status).toBe(404);

      await expectSqlError(client, `UPDATE messages SET body = 'edited'`, '42501');
      await expectSqlError(client, `DELETE FROM messages`, '42501');
    }),
  );

  it(
    'creates group chats with active staff only',
    tx(async () => {
      const f = await setup();
      const adm = await f.as(['ADM']);
      const doc = await f.doctor();
      const hr = await f.as(['HR']);
      const res = await adm.post('/api/comm/conversations', {
        kind: 'group',
        title: 'Zz case review',
        memberIds: [doc.id, hr.id],
      });
      expect(res.status).toBe(201);
      expect((await hr.get('/api/comm/conversations')).body.conversations[0]).toMatchObject({
        title: 'Zz case review',
        kind: 'group',
      });
      expect(
        (
          await adm.post('/api/comm/conversations', {
            kind: 'group',
            title: 'Zz bad',
            memberIds: ['00000000-0000-4000-8000-000000000000'],
          })
        ).body.error.code,
      ).toBe('UNKNOWN_USER');
    }),
  );

  it(
    'needs a role: an account without one gets 403',
    tx(async () => {
      const f = await setup();
      const none = await f.as([]);
      expect((await none.get('/api/comm/summary')).status).toBe(403);
      expect((await none.get('/api/comm/events')).status).toBe(403);
    }),
  );
});

describe('doctor availability and call requests', () => {
  it(
    'lets staff ask a doctor for a call; only that doctor accepts, which opens a chat',
    tx(async () => {
      const f = await setup();
      const doc = await f.doctor();
      const nurse = await f.as(['NUR']);
      const rec = await f.as(['REC']);

      // Only doctors set availability; reception can't send call requests.
      expect((await nurse.post('/api/comm/availability', { status: 'busy' })).body.error.code).toBe(
        'NOT_A_DOCTOR',
      );
      expect(
        (await rec.post('/api/comm/calls', { doctorUserId: doc.id, reason: 'x' })).status,
      ).toBe(403);
      expect(
        (await nurse.post('/api/comm/calls', { doctorUserId: rec.id, reason: 'x' })).body.error
          .code,
      ).toBe('NOT_A_DOCTOR');

      const call = await nurse.post('/api/comm/calls', {
        doctorUserId: doc.id,
        reason: 'Zz bed 4 needs review',
        urgency: 'urgent',
      });
      expect(call.status, JSON.stringify(call.body)).toBe(201);
      expect(
        (await nurse.post('/api/comm/calls', { doctorUserId: doc.id, reason: 'again' })).body.error
          .code,
      ).toBe('ALREADY_PENDING');
      expect((await doc.get('/api/comm/summary')).body).toMatchObject({
        incomingCalls: 1,
        isDoctor: true,
      });
      expect((await doc.get('/api/comm/calls')).body.incoming[0]).toMatchObject({
        id: call.body.id,
        status: 'pending',
        urgency: 'urgent',
        requesterId: nurse.id,
      });

      // Someone else can't answer it (404, as if it didn't exist).
      const otherDoc = await f.doctor();
      expect(
        (await otherDoc.post(`/api/comm/calls/${call.body.id}/respond`, { decision: 'accept' }))
          .status,
      ).toBe(404);

      const accepted = await doc.post(`/api/comm/calls/${call.body.id}/respond`, {
        decision: 'accept',
        note: 'Coming in 5 minutes',
      });
      expect(accepted.status).toBe(200);
      expect(accepted.body.conversationId).toBeTruthy();
      expect(await audit('call_request.accepted')).toHaveLength(1);
      const chat = (
        await nurse.get(`/api/comm/conversations/${accepted.body.conversationId}/messages`)
      ).body.messages;
      expect(chat[0].body).toBe('Call request accepted. Coming in 5 minutes');

      // Decided requests are final.
      expect(
        (await doc.post(`/api/comm/calls/${call.body.id}/respond`, { decision: 'decline' })).body
          .error.code,
      ).toBe('CALL_CLOSED');
      expect((await nurse.post(`/api/comm/calls/${call.body.id}/cancel`)).body.error.code).toBe(
        'CALL_CLOSED',
      );
      await expectSqlError(
        client,
        `UPDATE call_requests SET status = 'declined' WHERE id = $1`,
        '23514',
        /cannot change/,
        [call.body.id],
      );
    }),
  );

  it(
    'blocks routine calls to an off-duty doctor, allows cancelling, and expires old requests',
    tx(async () => {
      const f = await setup();
      const doc = await f.doctor();
      const nurse = await f.as(['NUR']);
      expect((await doc.post('/api/comm/availability', { status: 'off_duty' })).status).toBe(200);
      const found = (await nurse.get('/api/comm/staff?q=Zz Cardiology')).body.staff;
      expect(found.map((s: { id: string }) => s.id)).toContain(doc.id);
      const all = (await nurse.get('/api/comm/staff')).body.staff;
      expect(all.find((s: { id: string }) => s.id === doc.id)).toMatchObject({
        isDoctor: true,
        availability: 'off_duty',
      });

      expect(
        (await nurse.post('/api/comm/calls', { doctorUserId: doc.id, reason: 'Zz' })).body.error
          .code,
      ).toBe('DOCTOR_OFF_DUTY');
      const emergency = await nurse.post('/api/comm/calls', {
        doctorUserId: doc.id,
        reason: 'Zz collapse in ward 2',
        urgency: 'emergency',
      });
      expect(emergency.status).toBe(201);
      expect((await nurse.post(`/api/comm/calls/${emergency.body.id}/cancel`)).status).toBe(200);
      expect(await audit('call_request.cancelled')).toHaveLength(1);

      // A request older than the time limit expires and can't be accepted.
      const old = await client.query<{ id: string }>(
        `INSERT INTO call_requests (requester_id, doctor_user_id, reason, created_at)
         VALUES ($1, $2, 'Zz old', now() - interval '11 minutes') RETURNING id`,
        [nurse.id, doc.id],
      );
      expect(
        (await doc.post(`/api/comm/calls/${old.rows[0]!.id}/respond`, { decision: 'accept' })).body
          .error.code,
      ).toBe('CALL_CLOSED');
      const calls = (await doc.get('/api/comm/calls')).body.incoming;
      expect(calls.find((c: { id: string }) => c.id === old.rows[0]!.id).status).toBe('expired');
    }),
  );
});
