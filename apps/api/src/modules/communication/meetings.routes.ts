/**
 * Video meetings (Phase C2; docs/permissions.md note 15). Audio and video travel directly
 * between browsers (WebRTC, one connection per pair of people). The API keeps who is
 * invited and who is in the meeting, and relays connection details ("signals") between two
 * people who are both in it. Nothing is recorded.
 *
 *   GET  /api/comm/meetings                  message:send  my active meetings and the last 24 h
 *   GET  /api/comm/meetings/:id              invitees only (404 otherwise)
 *   POST /api/comm/meetings                  meeting:create  invite people and/or whole roles; audited
 *   POST /api/comm/conversations/:id/meeting members of the conversation; joins its live meeting
 *                                            if there is one, otherwise starts it; audited
 *   POST /api/comm/meetings/:id/join         invitees; at most MAX_IN_MEETING at once; audited
 *   POST /api/comm/meetings/:id/heartbeat    people in the meeting (every ~15 s)
 *   POST /api/comm/meetings/:id/leave        audited; the last person out ends the meeting
 *   POST /api/comm/meetings/:id/end          the host only; audited
 *   POST /api/comm/meetings/:id/signal       both sender and recipient in the meeting
 */
import {
  MAX_IN_MEETING,
  MAX_MEETING_INVITEES,
  MEETING_PRESENCE_SECONDS,
  meetingSchema,
  signalSchema,
} from '@hospitalos/shared';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { withTransaction, type Database, type Queryable } from '../../db/client.js';
import { auditContext, recordAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { requirePermission, requireUser } from '../../middleware/auth.js';
import type { EventHub } from './event-hub.js';

const uuid = (value: unknown, what: string) => {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new AppError(404, 'NOT_FOUND', `${what} not found`);
  return parsed.data;
};
const pgCode = (err: unknown) => (err as { code?: string }).code;
const notFound = () => new AppError(404, 'NOT_FOUND', 'Meeting not found');

/** Someone counts as in the meeting while their heartbeat is recent. */
const FRESH = (p: string) =>
  `(${p}.present AND ${p}.last_seen_at > clock_timestamp() - interval '${MEETING_PRESENCE_SECONDS} seconds')`;
const nameOf = (col: string) =>
  `(SELECT e.full_name FROM users u JOIN employees e ON e.id = u.employee_id WHERE u.id = ${col})`;

/** $1 = the caller. One row per meeting the caller is invited to. */
const MEETING_SELECT = `
  SELECT m.id, m.title, m.kind, m.status, m.created_at AS "createdAt", m.ended_at AS "endedAt",
         m.conversation_id AS "conversationId", m.host_id AS "hostId", ${nameOf('m.host_id')} AS "hostName",
         (m.host_id = $1) AS "isHost", ${FRESH('me')} AS "present", me.joined_at AS "joinedAt",
         (SELECT json_agg(json_build_object('id', p.user_id, 'fullName', ${nameOf('p.user_id')},
                                            'present', ${FRESH('p')}) ORDER BY ${FRESH('p')} DESC, p.invited_at)
            FROM meeting_participants p WHERE p.meeting_id = m.id) AS participants
    FROM meeting_participants me JOIN meetings m ON m.id = me.meeting_id
   WHERE me.user_id = $1`;

/**
 * Ends meetings nobody is in any more: a meeting whose last person's heartbeat stopped
 * (closed tab, lost network), or one nobody joined within 10 minutes.
 */
async function endAbandoned(db: Queryable): Promise<void> {
  await db.query(
    `UPDATE meetings m SET status = 'ended', ended_at = now()
      WHERE m.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM meeting_participants p WHERE p.meeting_id = m.id AND ${FRESH('p')})
        AND (m.created_at < now() - interval '10 minutes'
             OR EXISTS (SELECT 1 FROM meeting_participants p
                         WHERE p.meeting_id = m.id AND p.joined_at IS NOT NULL))`,
  );
}

async function participantIds(db: Queryable, meetingId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT user_id AS id FROM meeting_participants WHERE meeting_id = $1',
    [meetingId],
  );
  return rows.map((r) => r.id);
}

/** Creates the meeting, its chat (unless one is given) and the invitations. */
async function createMeeting(
  tx: Queryable,
  input: {
    title: string;
    kind: string;
    hostId: string;
    userIds: string[];
    conversationId?: string;
  },
): Promise<string> {
  let conversationId = input.conversationId;
  if (!conversationId) {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO conversations (kind, title, created_by) VALUES ('group', $1, $2) RETURNING id`,
      [`Meeting: ${input.title}`.slice(0, 80), input.hostId],
    );
    conversationId = rows[0]!.id;
    await tx.query(
      `INSERT INTO conversation_members (conversation_id, user_id) SELECT $1, unnest($2::uuid[])`,
      [conversationId, input.userIds],
    );
  }
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO meetings (title, kind, host_id, conversation_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.title, input.kind, input.hostId, conversationId],
  );
  const id = rows[0]!.id;
  await tx.query(
    `INSERT INTO meeting_participants (meeting_id, user_id) SELECT $1, unnest($2::uuid[])`,
    [id, input.userIds],
  );
  return id;
}

export function meetingRoutes(db: Database, hub: EventHub): Router {
  const router = Router();
  const canMessage = requirePermission(db, 'message:send');

  const audit = (
    tx: Queryable,
    req: Request,
    res: Response,
    action: string,
    id: string,
    changes?: Record<string, string | number | boolean | null>,
  ) =>
    recordAudit(
      tx,
      {
        actor: { type: 'user', userId: requireUser(res).id },
        action,
        entityType: 'meeting',
        entityId: id,
        changes,
      },
      auditContext(req, res),
    );

  router.get('/comm/meetings', canMessage, async (_req, res) => {
    const me = requireUser(res).id;
    await endAbandoned(db);
    const { rows } = await db.query(
      `${MEETING_SELECT}
         AND (m.status = 'active' OR m.ended_at > now() - interval '24 hours')
       ORDER BY (m.status = 'active') DESC, m.created_at DESC LIMIT 30`,
      [me],
    );
    res.json({ meetings: rows });
  });

  router.get('/comm/meetings/:id', canMessage, async (req, res) => {
    const me = requireUser(res).id;
    const id = uuid(req.params.id, 'Meeting');
    const { rows } = await db.query(`${MEETING_SELECT} AND m.id = $2`, [me, id]);
    if (!rows[0]) throw notFound();
    res.json(rows[0]);
  });

  router.post('/comm/meetings', requirePermission(db, 'meeting:create'), async (req, res) => {
    const input = meetingSchema.parse(req.body);
    const me = requireUser(res).id;
    const { id, userIds } = await withTransaction(db, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT u.id FROM users u
          WHERE u.status = 'active' AND NOT u.pending_approval
            AND (u.id = ANY($1::uuid[]) OR EXISTS (
                  SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                   WHERE ur.user_id = u.id AND r.code = ANY($2::text[])))`,
        [input.inviteeIds, input.inviteRoles],
      );
      const found = new Set(rows.map((r) => r.id));
      if (input.inviteeIds.some((u) => !found.has(u)))
        throw new AppError(422, 'UNKNOWN_USER', 'One or more staff members were not found.');
      found.add(me);
      if (found.size < 2)
        throw new AppError(422, 'NO_INVITEES', 'Nobody else matches the people you invited.');
      if (found.size > MAX_MEETING_INVITEES + 1)
        throw new AppError(
          422,
          'TOO_MANY_INVITEES',
          `A meeting can invite at most ${MAX_MEETING_INVITEES} people.`,
        );
      const userIds = [...found];
      const meetingId = await createMeeting(tx, {
        title: input.title,
        kind: input.kind,
        hostId: me,
        userIds,
      });
      await audit(tx, req, res, 'meeting.started', meetingId, {
        kind: input.kind,
        invited: userIds.length - 1,
      });
      return { id: meetingId, userIds };
    });
    hub.send(userIds, { type: 'meeting', id });
    res.status(201).json({ id });
  });

  router.post('/comm/conversations/:id/meeting', canMessage, async (req, res) => {
    const me = requireUser(res).id;
    const conversationId = uuid(req.params.id, 'Conversation');
    const start = () =>
      withTransaction(db, async (tx) => {
        const { rows: conv } = await tx.query<{ title: string | null; members: string[] }>(
          `SELECT c.title, array_agg(cm.user_id) AS members
             FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id
            WHERE c.id = $1 GROUP BY c.id`,
          [conversationId],
        );
        if (!conv[0]?.members.includes(me))
          throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
        const { rows: live } = await tx.query<{ id: string }>(
          `SELECT id FROM meetings WHERE conversation_id = $1 AND status = 'active'`,
          [conversationId],
        );
        if (live[0]) return { id: live[0].id, created: false, userIds: conv[0].members };
        const id = await createMeeting(tx, {
          title: conv[0].title ?? 'Video call',
          kind: 'standard',
          hostId: me,
          userIds: conv[0].members,
          conversationId,
        });
        await audit(tx, req, res, 'meeting.started', id, {
          kind: 'standard',
          invited: conv[0].members.length - 1,
        });
        return { id, created: true, userIds: conv[0].members };
      });
    // Two members pressing "Video call" at once: the loser joins the winner's meeting.
    const result = await start().catch((err) => {
      if (pgCode(err) === '23505') return start();
      throw err;
    });
    if (result.created) hub.send(result.userIds, { type: 'meeting', id: result.id });
    res.status(result.created ? 201 : 200).json({ id: result.id });
  });

  router.post('/comm/meetings/:id/join', canMessage, async (req, res) => {
    const me = requireUser(res).id;
    const id = uuid(req.params.id, 'Meeting');
    const peers = await withTransaction(db, async (tx) => {
      // Locking the meeting row makes joins one at a time, so the size limit holds.
      const { rows: m } = await tx.query<{ status: string }>(
        `SELECT m.status FROM meetings m
           JOIN meeting_participants p ON p.meeting_id = m.id AND p.user_id = $2
          WHERE m.id = $1 FOR UPDATE OF m`,
        [id, me],
      );
      if (!m[0]) throw notFound();
      if (m[0].status !== 'active')
        throw new AppError(409, 'MEETING_ENDED', 'This meeting has ended.');
      const { rows: present } = await tx.query<{ id: string }>(
        `SELECT p.user_id AS id FROM meeting_participants p
          WHERE p.meeting_id = $1 AND p.user_id <> $2 AND ${FRESH('p')}`,
        [id, me],
      );
      if (present.length >= MAX_IN_MEETING)
        throw new AppError(
          409,
          'MEETING_FULL',
          `This meeting already has ${MAX_IN_MEETING} people in it.`,
        );
      await tx.query(
        `UPDATE meeting_participants
            SET present = true, joined_at = coalesce(joined_at, clock_timestamp()),
                last_seen_at = clock_timestamp(), left_at = NULL
          WHERE meeting_id = $1 AND user_id = $2`,
        [id, me],
      );
      await audit(tx, req, res, 'meeting.joined', id);
      return present.map((p) => p.id);
    });
    hub.send(await participantIds(db, id), { type: 'meeting', id });
    res.json({ peers });
  });

  router.post('/comm/meetings/:id/heartbeat', canMessage, async (req, res) => {
    const me = requireUser(res).id;
    const id = uuid(req.params.id, 'Meeting');
    const { rowCount } = await db.query(
      `UPDATE meeting_participants p SET last_seen_at = clock_timestamp()
         FROM meetings m
        WHERE m.id = p.meeting_id AND m.status = 'active'
          AND p.meeting_id = $1 AND p.user_id = $2 AND p.present`,
      [id, me],
    );
    if (!rowCount) throw new AppError(409, 'NOT_IN_MEETING', 'You are no longer in this meeting.');
    res.json({ ok: true });
  });

  router.post('/comm/meetings/:id/leave', canMessage, async (req, res) => {
    const me = requireUser(res).id;
    const id = uuid(req.params.id, 'Meeting');
    const result = await withTransaction(db, async (tx) => {
      const { rowCount } = await tx.query(
        `UPDATE meeting_participants SET present = false, left_at = clock_timestamp()
          WHERE meeting_id = $1 AND user_id = $2 AND present`,
        [id, me],
      );
      if (!rowCount) return null;
      await audit(tx, req, res, 'meeting.left', id);
      const { rows: others } = await tx.query<{ id: string }>(
        `SELECT p.user_id AS id FROM meeting_participants p
          WHERE p.meeting_id = $1 AND ${FRESH('p')}`,
        [id],
      );
      if (others.length === 0)
        await tx.query(
          `UPDATE meetings SET status = 'ended', ended_at = now() WHERE id = $1 AND status = 'active'`,
          [id],
        );
      return others.map((o) => o.id);
    });
    if (result) {
      hub.send(result, { type: 'signal', id, from: me, kind: 'leave' });
      hub.send(await participantIds(db, id), { type: 'meeting', id });
    }
    res.json({ ok: true });
  });

  router.post('/comm/meetings/:id/end', canMessage, async (req, res) => {
    const me = requireUser(res).id;
    const id = uuid(req.params.id, 'Meeting');
    await withTransaction(db, async (tx) => {
      const { rows } = await tx.query<{ hostId: string; status: string }>(
        `SELECT m.host_id AS "hostId", m.status FROM meetings m
           JOIN meeting_participants p ON p.meeting_id = m.id AND p.user_id = $2
          WHERE m.id = $1 FOR UPDATE OF m`,
        [id, me],
      );
      if (!rows[0]) throw notFound();
      if (rows[0].hostId !== me)
        throw new AppError(403, 'NOT_HOST', 'Only the person who started the meeting can end it.');
      if (rows[0].status !== 'active') return;
      await tx.query(
        `UPDATE meetings SET status = 'ended', ended_at = now(), ended_by = $2 WHERE id = $1`,
        [id, me],
      );
      await tx.query(
        `UPDATE meeting_participants SET present = false, left_at = clock_timestamp()
          WHERE meeting_id = $1 AND present`,
        [id],
      );
      await audit(tx, req, res, 'meeting.ended', id);
    });
    hub.send(await participantIds(db, id), { type: 'meeting', id });
    res.json({ ok: true });
  });

  router.post('/comm/meetings/:id/signal', canMessage, async (req, res) => {
    const me = requireUser(res).id;
    const id = uuid(req.params.id, 'Meeting');
    const signal = signalSchema.parse(req.body);
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM meeting_participants p
         JOIN meetings m ON m.id = p.meeting_id AND m.status = 'active'
        WHERE p.meeting_id = $1 AND p.user_id IN ($2, $3) AND ${FRESH('p')}`,
      [id, me, signal.to],
    );
    if (signal.to === me || rows[0]!.n !== 2)
      throw new AppError(409, 'PEER_NOT_IN_MEETING', 'That person is not in this meeting.');
    hub.send([signal.to], { type: 'signal', id, from: me, kind: signal.kind, data: signal.data });
    res.json({ ok: true });
  });

  return router;
}
