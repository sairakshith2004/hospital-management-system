/**
 * Video meetings through the real API on hms_test, each test in one rolled-back
 * transaction. The event hub is captured to check who gets which live event. Synthetic data.
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
import { EventHub } from './event-hub.js';

let client!: pg.Client;
beforeAll(async () => {
  client = await connectTest('app');
});
afterAll(async () => {
  await client?.end();
});
const tx = (work: () => Promise<void>) => () => inRollback(client, work);

async function setup() {
  const events = new EventHub();
  const { app, db } = createTestApp(client, { events });
  const as = async (roles: string[]) => {
    const u = await createTestUser(db, { roles });
    const s = await signIn(app, u.username);
    const received: string[] = [];
    events.add(u.id, { write: (c: string) => received.push(c), end: () => undefined });
    return {
      id: u.id,
      received,
      get: (path: string) => request(app).get(path).set('Cookie', s.cookie),
      post: (path: string, body: object = {}) =>
        request(app).post(path).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).send(body),
    };
  };
  return { as };
}

const audit = async (action: string) =>
  (
    await client.query(
      'SELECT entity_id, changes FROM audit_logs WHERE action = $1 AND occurred_at = now()',
      [action],
    )
  ).rows;

describe('video meetings', () => {
  it(
    'starts an emergency meeting for whole roles, joins, relays signals only between people in it, and ends',
    tx(async () => {
      const f = await setup();
      const adm = await f.as(['ADM']);
      const doc = await f.as(['DOC']);
      const hr = await f.as(['HR']);
      const pharmacist = await f.as(['PHA']);

      expect(
        (await pharmacist.post('/api/comm/meetings', { title: 'x', inviteeIds: [doc.id] })).status,
      ).toBe(403);

      const started = await adm.post('/api/comm/meetings', {
        title: 'Zz mass casualty',
        kind: 'emergency',
        inviteRoles: ['DOC', 'HR'],
      });
      expect(started.status, JSON.stringify(started.body)).toBe(201);
      const id = started.body.id as string;
      expect((await audit('meeting.started'))[0].changes.kind).toBe('emergency');
      expect(doc.received.some((c) => c.includes('event: meeting'))).toBe(true);

      // Invitees see it (with a pending invite); others get 404.
      expect((await doc.get('/api/comm/summary')).body.meetingInvites).toBeGreaterThan(0);
      const seen = (await doc.get(`/api/comm/meetings/${id}`)).body;
      expect(seen).toMatchObject({
        title: 'Zz mass casualty',
        kind: 'emergency',
        status: 'active',
      });
      expect((await pharmacist.get(`/api/comm/meetings/${id}`)).status).toBe(404);
      expect((await pharmacist.post(`/api/comm/meetings/${id}/join`)).status).toBe(404);

      // The first person in has no peers; the next one is told who to connect to.
      expect((await adm.post(`/api/comm/meetings/${id}/join`)).body.peers).toEqual([]);
      expect((await doc.post(`/api/comm/meetings/${id}/join`)).body.peers).toEqual([adm.id]);
      expect(await audit('meeting.joined')).toHaveLength(2);

      // Signals reach only the named person, and only while both are in the meeting.
      adm.received.length = 0;
      const offer = { type: 'offer', sdp: 'v=0 zz' };
      expect(
        (
          await doc.post(`/api/comm/meetings/${id}/signal`, {
            to: adm.id,
            kind: 'offer',
            data: offer,
          })
        ).status,
      ).toBe(200);
      expect(adm.received).toEqual([
        `event: signal\ndata: ${JSON.stringify({ id, from: doc.id, kind: 'offer', data: offer })}\n\n`,
      ]);
      expect(
        (
          await doc.post(`/api/comm/meetings/${id}/signal`, {
            to: hr.id,
            kind: 'offer',
            data: offer,
          })
        ).body.error.code,
      ).toBe('PEER_NOT_IN_MEETING');
      expect(
        (
          await hr.post(`/api/comm/meetings/${id}/signal`, {
            to: adm.id,
            kind: 'offer',
            data: offer,
          })
        ).body.error.code,
      ).toBe('PEER_NOT_IN_MEETING');

      expect((await doc.post(`/api/comm/meetings/${id}/heartbeat`)).status).toBe(200);
      expect((await hr.post(`/api/comm/meetings/${id}/heartbeat`)).body.error.code).toBe(
        'NOT_IN_MEETING',
      );

      // Only the host ends it for everyone.
      expect((await doc.post(`/api/comm/meetings/${id}/end`)).body.error.code).toBe('NOT_HOST');
      expect((await adm.post(`/api/comm/meetings/${id}/end`)).status).toBe(200);
      expect(await audit('meeting.ended')).toHaveLength(1);
      expect((await hr.post(`/api/comm/meetings/${id}/join`)).body.error.code).toBe(
        'MEETING_ENDED',
      );
      const after = (await doc.get(`/api/comm/meetings/${id}`)).body;
      expect(after.status).toBe('ended');
      expect(after.participants.every((p: { present: boolean }) => !p.present)).toBe(true);

      await expectSqlError(
        client,
        `UPDATE meetings SET status = 'active', ended_at = NULL WHERE id = $1`,
        '23514',
        /ended meeting/,
        [id],
      );
    }),
  );

  it(
    'lets chat members video-call; a second press joins the same call; the last one out ends it',
    tx(async () => {
      const f = await setup();
      const nurse = await f.as(['NUR']);
      const doc = await f.as(['DOC']);
      const outsider = await f.as(['NUR']);
      const conv = await nurse.post('/api/comm/conversations', { kind: 'direct', userId: doc.id });

      const first = await nurse.post(`/api/comm/conversations/${conv.body.id}/meeting`);
      expect(first.status).toBe(201);
      const second = await doc.post(`/api/comm/conversations/${conv.body.id}/meeting`);
      expect(second.status).toBe(200);
      expect(second.body.id).toBe(first.body.id);
      expect((await outsider.post(`/api/comm/conversations/${conv.body.id}/meeting`)).status).toBe(
        404,
      );

      const id = first.body.id as string;
      await nurse.post(`/api/comm/meetings/${id}/join`);
      await doc.post(`/api/comm/meetings/${id}/join`);
      nurse.received.length = 0;
      await doc.post(`/api/comm/meetings/${id}/leave`);
      // The others are told at once so they can close the connection.
      expect(nurse.received.some((c) => c.includes('"kind":"leave"'))).toBe(true);
      expect((await nurse.get(`/api/comm/meetings/${id}`)).body.status).toBe('active');
      await nurse.post(`/api/comm/meetings/${id}/leave`);
      expect((await nurse.get(`/api/comm/meetings/${id}`)).body.status).toBe('ended');
      expect(await audit('meeting.left')).toHaveLength(2);

      // A new call in the same chat starts a fresh meeting.
      const again = await doc.post(`/api/comm/conversations/${conv.body.id}/meeting`);
      expect(again.status).toBe(201);
      expect(again.body.id).not.toBe(id);
    }),
  );

  it(
    'refuses more than 8 people at once and ends meetings whose people all went silent',
    tx(async () => {
      const f = await setup();
      const host = await f.as(['ADM']);
      const people = [];
      for (let i = 0; i < 8; i++) people.push(await f.as(['NUR']));
      const { id } = (
        await host.post('/api/comm/meetings', {
          title: 'Zz big',
          inviteeIds: people.map((p) => p.id),
        })
      ).body;
      for (const p of people)
        expect((await p.post(`/api/comm/meetings/${id}/join`)).status).toBe(200);
      expect((await host.post(`/api/comm/meetings/${id}/join`)).body.error.code).toBe(
        'MEETING_FULL',
      );

      // Everyone's heartbeat stops (closed tabs): the next listing ends the meeting.
      await client.query(
        `UPDATE meeting_participants SET last_seen_at = now() - interval '2 minutes' WHERE meeting_id = $1`,
        [id],
      );
      const list = (await host.get('/api/comm/meetings')).body.meetings;
      expect(list.find((m: { id: string }) => m.id === id).status).toBe('ended');
    }),
  );
});
