/**
 * Communication hub (Phase C1; docs/permissions.md note 14).
 *
 *   GET  /api/comm/events                    message:send  live updates (Server-Sent Events)
 *   GET  /api/comm/summary                   message:send  unread counts, own availability
 *   GET  /api/comm/staff?q=                  message:send  active staff to message or call
 *   GET  /api/comm/departments               notice:publish  notice targets
 *   GET  /api/comm/notices                   message:send  notices addressed to me (90 days)
 *   POST /api/comm/notices                   notice:publish  audited
 *   POST /api/comm/notices/:id/read          message:send
 *   GET  /api/comm/conversations             message:send  my conversations
 *   POST /api/comm/conversations             message:send  direct (find or create) or group
 *   GET  /api/comm/conversations/:id/messages?before=   members only (404 otherwise)
 *   POST /api/comm/conversations/:id/messages          members only
 *   POST /api/comm/conversations/:id/read              members only
 *   POST /api/comm/availability              message:send + an active doctor profile
 *   GET  /api/comm/calls                     message:send  incoming (doctors) and outgoing
 *   POST /api/comm/calls                     call_request:create  audited
 *   POST /api/comm/calls/:id/respond         the called doctor only; audited
 *   POST /api/comm/calls/:id/cancel          the requester only, while pending; audited
 */
import {
  availabilitySchema,
  CALL_REQUEST_TTL_MINUTES,
  callRequestSchema,
  callResponseSchema,
  type CommSummary,
  conversationSchema,
  messageSchema,
  noticeSchema,
} from '@hospitalos/shared';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { withTransaction, type Database, type Queryable } from '../../db/client.js';
import { auditContext, recordAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { requirePermission, requireUser } from '../../middleware/auth.js';
import { EventHub, HEARTBEAT_MS, STREAM_LIFETIME_MS } from './event-hub.js';

const uuid = (value: unknown, what: string) => {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new AppError(404, 'NOT_FOUND', `${what} not found`);
  return parsed.data;
};
const pgCode = (err: unknown) => (err as { code?: string }).code;
const TTL = `interval '${CALL_REQUEST_TTL_MINUTES} minutes'`;
const NOTICE_WINDOW = `interval '90 days'`;
// Message times and read markers use the wall clock, not now(): now() is fixed for a whole
// transaction, so a message and a read marker written in one transaction would tie and the
// message would never count as unread.
const INSERT_MESSAGE = `INSERT INTO messages (conversation_id, sender_id, body, created_at)
  VALUES ($1, $2, $3, clock_timestamp())`;
const MARK_READ = `UPDATE conversation_members SET last_read_at = clock_timestamp()
  WHERE conversation_id = $1 AND user_id = $2`;

/** A user's display name ($n = users.id). */
const nameOf = (col: string) =>
  `(SELECT e.full_name FROM users u JOIN employees e ON e.id = u.employee_id WHERE u.id = ${col})`;

/** Notices visible to user $1: addressed to everyone, one of their roles, their department
 * (employee or doctor-profile department), them personally, or written by them. */
const NOTICE_VISIBLE = `(
  n.audience = 'all'
  OR (n.audience = 'role' AND n.audience_role IN (
        SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1))
  OR (n.audience = 'department' AND n.audience_department_id IN (
        SELECT e.department_id FROM users u JOIN employees e ON e.id = u.employee_id WHERE u.id = $1
        UNION
        SELECT dp.department_id FROM users u JOIN doctor_profiles dp ON dp.employee_id = u.employee_id
         WHERE u.id = $1 AND dp.active))
  OR (n.audience = 'user' AND n.audience_user_id = $1)
  OR n.created_by = $1)`;

const IS_DOCTOR = (col: string) => `EXISTS (
  SELECT 1 FROM users du JOIN doctor_profiles dp ON dp.employee_id = du.employee_id AND dp.active
   WHERE du.id = ${col})`;

/** Pending requests past their time become 'expired'. Cheap; run before reading or deciding. */
async function expireOldCalls(db: Queryable): Promise<void> {
  await db.query(
    `UPDATE call_requests SET status = 'expired'
      WHERE status = 'pending' AND created_at < now() - ${TTL}`,
  );
}

async function isMember(db: Queryable, conversationId: string, userId: string) {
  const { rowCount } = await db.query(
    'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
    [conversationId, userId],
  );
  return rowCount === 1;
}

async function memberIds(db: Queryable, conversationId: string): Promise<string[]> {
  const { rows } = await db.query<{ userId: string }>(
    'SELECT user_id AS "userId" FROM conversation_members WHERE conversation_id = $1',
    [conversationId],
  );
  return rows.map((r) => r.userId);
}

/** The number of the given IDs that are active, approved accounts. */
async function activeUserCount(db: Queryable, ids: string[]): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM users
      WHERE id = ANY($1::uuid[]) AND status = 'active' AND NOT pending_approval`,
    [ids],
  );
  return rows[0]!.n;
}

/** The direct conversation between two users, created if needed. */
async function directConversation(
  tx: Queryable,
  me: string,
  other: string,
): Promise<{ id: string; created: boolean }> {
  const key = [me, other].sort().join(':');
  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO conversations (kind, direct_key, created_by) VALUES ('direct', $1, $2)
     ON CONFLICT (direct_key) DO NOTHING RETURNING id`,
    [key, me],
  );
  const id =
    inserted.rows[0]?.id ??
    (await tx.query<{ id: string }>('SELECT id FROM conversations WHERE direct_key = $1', [key]))
      .rows[0]!.id;
  await tx.query(
    `INSERT INTO conversation_members (conversation_id, user_id)
     SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
    [id, [me, other]],
  );
  return { id, created: inserted.rows.length === 1 };
}

export function communicationRoutes(db: Database, hub: EventHub): Router {
  const router = Router();
  const canMessage = requirePermission(db, 'message:send');

  /** Runs `work` in a transaction and writes its audit row in the same one. */
  async function audited<T>(
    req: Request,
    res: Response,
    entry: {
      action: string;
      entityType: string;
      changes?: Record<string, string | number | boolean | null>;
    },
    work: (tx: Queryable, userId: string) => Promise<{ id: string; result: T }>,
  ): Promise<T> {
    const userId = requireUser(res).id;
    return withTransaction(db, async (tx) => {
      const { id, result } = await work(tx, userId);
      await recordAudit(
        tx,
        { actor: { type: 'user', userId }, entityId: id, ...entry },
        auditContext(req, res),
      );
      return result;
    });
  }

  // ---- Live updates ----
  router.get('/comm/events', canMessage, (req, res) => {
    const user = requireUser(res);
    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive',
      // Stops proxies (and Vite's) from buffering the stream.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    const remove = hub.add(user.id, res);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    // Ending the stream makes the browser reconnect, which re-checks the session.
    const lifetime = setTimeout(() => res.end(), STREAM_LIFETIME_MS);
    const cleanup = () => {
      clearInterval(heartbeat);
      clearTimeout(lifetime);
      remove();
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
  });

  router.get('/comm/summary', canMessage, async (_req, res) => {
    const me = requireUser(res).id;
    const { rows } = await db.query<CommSummary>(
      `SELECT
         (SELECT count(*)::int FROM messages m
            JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = $1
           WHERE m.created_at > cm.last_read_at AND m.sender_id <> $1) AS "unreadMessages",
         (SELECT count(*)::int FROM notices n
           WHERE ${NOTICE_VISIBLE} AND n.created_by <> $1 AND n.created_at > now() - ${NOTICE_WINDOW}
             AND NOT EXISTS (SELECT 1 FROM notice_reads r WHERE r.notice_id = n.id AND r.user_id = $1))
           AS "unreadNotices",
         (SELECT count(*)::int FROM call_requests c
           WHERE c.doctor_user_id = $1 AND c.status = 'pending' AND c.created_at > now() - ${TTL})
           AS "incomingCalls",
         (SELECT count(*)::int FROM meeting_participants p
            JOIN meetings m ON m.id = p.meeting_id AND m.status = 'active'
           WHERE p.user_id = $1 AND p.joined_at IS NULL) AS "meetingInvites",
         ${IS_DOCTOR('$1')} AS "isDoctor",
         (SELECT status FROM doctor_availability WHERE user_id = $1) AS availability`,
      [me],
    );
    res.json(rows[0]);
  });

  router.get('/comm/staff', canMessage, async (req, res) => {
    const me = requireUser(res).id;
    const { q } = z.object({ q: z.string().trim().max(60).optional() }).parse(req.query);
    const { rows } = await db.query(
      `SELECT u.id, e.full_name AS "fullName", e.designation, d.name AS department,
              coalesce((SELECT array_agg(r.code ORDER BY r.code) FROM user_roles ur
                         JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '{}') AS roles,
              dp.specialty, (dp.id IS NOT NULL) AS "isDoctor",
              CASE WHEN dp.id IS NULL THEN NULL ELSE coalesce(a.status, 'available') END AS availability,
              a.note AS "availabilityNote"
         FROM users u
         JOIN employees e ON e.id = u.employee_id
         JOIN departments d ON d.id = e.department_id
         LEFT JOIN doctor_profiles dp ON dp.employee_id = e.id AND dp.active
         LEFT JOIN doctor_availability a ON a.user_id = u.id
        WHERE u.status = 'active' AND NOT u.pending_approval AND u.id <> $1
          AND ($2::text IS NULL OR e.full_name ILIKE '%' || $2 || '%'
               OR dp.specialty ILIKE '%' || $2 || '%' OR d.name ILIKE '%' || $2 || '%')
        ORDER BY (dp.id IS NULL), e.full_name
        LIMIT 100`,
      [me, q || null],
    );
    res.json({ staff: rows });
  });

  // ---- Notices ----
  router.get('/comm/departments', requirePermission(db, 'notice:publish'), async (_req, res) => {
    const { rows } = await db.query('SELECT id, name FROM departments WHERE active ORDER BY name');
    res.json({ departments: rows });
  });

  router.get('/comm/notices', canMessage, async (_req, res) => {
    const me = requireUser(res).id;
    const { rows } = await db.query(
      `SELECT n.id, n.title, n.body, n.priority, n.audience, n.created_at AS "createdAt",
              ${nameOf('n.created_by')} AS author, (n.created_by = $1) AS mine,
              CASE n.audience
                WHEN 'all' THEN 'All staff'
                WHEN 'role' THEN n.audience_role
                WHEN 'department' THEN (SELECT name FROM departments WHERE id = n.audience_department_id)
                ELSE ${nameOf('n.audience_user_id')}
              END AS "audienceLabel",
              (n.created_by = $1 OR EXISTS (SELECT 1 FROM notice_reads r
                 WHERE r.notice_id = n.id AND r.user_id = $1)) AS read
         FROM notices n
        WHERE ${NOTICE_VISIBLE} AND n.created_at > now() - ${NOTICE_WINDOW}
        ORDER BY n.created_at DESC LIMIT 100`,
      [me],
    );
    res.json({ notices: rows });
  });

  router.post('/comm/notices', requirePermission(db, 'notice:publish'), async (req, res) => {
    const input = noticeSchema.parse(req.body);
    const id = await audited(
      req,
      res,
      {
        action: 'notice.published',
        entityType: 'notice',
        changes: { audience: input.audience, priority: input.priority },
      },
      async (tx, me) => {
        if (input.userId && (await activeUserCount(tx, [input.userId])) !== 1)
          throw new AppError(422, 'UNKNOWN_USER', 'That staff member was not found.');
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO notices (title, body, priority, audience, audience_role,
                                audience_department_id, audience_user_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            input.title,
            input.body,
            input.priority,
            input.audience,
            input.roleCode ?? null,
            input.departmentId ?? null,
            input.userId ?? null,
            me,
          ],
        );
        return { id: rows[0]!.id, result: rows[0]!.id };
      },
    ).catch((err) => {
      if (pgCode(err) === '23503')
        throw new AppError(422, 'UNKNOWN_DEPARTMENT', 'That department was not found.');
      throw err;
    });
    hub.broadcast({ type: 'notice', id });
    res.status(201).json({ id });
  });

  router.post('/comm/notices/:id/read', canMessage, async (req, res) => {
    const me = requireUser(res).id;
    const id = uuid(req.params.id, 'Notice');
    const { rowCount } = await db.query(
      `INSERT INTO notice_reads (notice_id, user_id)
       SELECT n.id, $1 FROM notices n WHERE n.id = $2 AND ${NOTICE_VISIBLE}
       ON CONFLICT DO NOTHING`,
      [me, id],
    );
    // 0 rows: already read, or not addressed to this user. Either way nothing to reveal.
    if (rowCount) hub.send([me], { type: 'notice', id });
    res.json({ ok: true });
  });

  // ---- Conversations and messages ----
  router.get('/comm/conversations', canMessage, async (_req, res) => {
    const me = requireUser(res).id;
    const { rows } = await db.query(
      `SELECT c.id, c.kind, c.title, c.created_at AS "createdAt",
              (SELECT json_agg(json_build_object('id', u.id, 'fullName', e.full_name) ORDER BY e.full_name)
                 FROM conversation_members m2
                 JOIN users u ON u.id = m2.user_id JOIN employees e ON e.id = u.employee_id
                WHERE m2.conversation_id = c.id AND m2.user_id <> $1) AS others,
              left(lm.body, 120) AS "lastMessage", lm.created_at AS "lastMessageAt",
              (lm.sender_id = $1) AS "lastFromMe",
              (SELECT count(*)::int FROM messages m
                WHERE m.conversation_id = c.id AND m.created_at > cm.last_read_at
                  AND m.sender_id <> $1) AS unread
         FROM conversation_members cm
         JOIN conversations c ON c.id = cm.conversation_id
         LEFT JOIN LATERAL (SELECT m.body, m.created_at, m.sender_id FROM messages m
                             WHERE m.conversation_id = c.id
                             ORDER BY m.created_at DESC, m.id DESC LIMIT 1) lm ON true
        WHERE cm.user_id = $1
        ORDER BY coalesce(lm.created_at, c.created_at) DESC
        LIMIT 100`,
      [me],
    );
    res.json({ conversations: rows });
  });

  router.post('/comm/conversations', canMessage, async (req, res) => {
    const input = conversationSchema.parse(req.body);
    const me = requireUser(res).id;
    if (input.kind === 'direct') {
      if (input.userId === me)
        throw new AppError(422, 'SELF_CONVERSATION', "You can't start a chat with yourself.");
      const result = await withTransaction(db, async (tx) => {
        if ((await activeUserCount(tx, [input.userId])) !== 1)
          throw new AppError(422, 'UNKNOWN_USER', 'That staff member was not found.');
        const conv = await directConversation(tx, me, input.userId);
        if (conv.created)
          await recordAudit(
            tx,
            {
              actor: { type: 'user', userId: me },
              action: 'conversation.created',
              entityType: 'conversation',
              entityId: conv.id,
              changes: { kind: 'direct' },
            },
            auditContext(req, res),
          );
        return conv;
      });
      res.status(result.created ? 201 : 200).json({ id: result.id });
      return;
    }
    const members = [...new Set([me, ...input.memberIds])];
    const id = await audited(
      req,
      res,
      {
        action: 'conversation.created',
        entityType: 'conversation',
        changes: { kind: 'group', members: members.length },
      },
      async (tx) => {
        if ((await activeUserCount(tx, members)) !== members.length)
          throw new AppError(422, 'UNKNOWN_USER', 'One or more staff members were not found.');
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO conversations (kind, title, created_by) VALUES ('group', $1, $2) RETURNING id`,
          [input.title, me],
        );
        const convId = rows[0]!.id;
        await tx.query(
          `INSERT INTO conversation_members (conversation_id, user_id)
           SELECT $1, unnest($2::uuid[])`,
          [convId, members],
        );
        return { id: convId, result: convId };
      },
    );
    hub.send(members, { type: 'message', id });
    res.status(201).json({ id });
  });

  router.get('/comm/conversations/:id/messages', canMessage, async (req, res) => {
    const me = requireUser(res).id;
    const id = uuid(req.params.id, 'Conversation');
    const { before } = z.object({ before: z.iso.datetime().optional() }).parse(req.query);
    // Non-members get the same 404 as an unknown ID, so a conversation's existence isn't revealed.
    if (!(await isMember(db, id, me)))
      throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
    const { rows } = await db.query(
      `SELECT * FROM (
         SELECT m.id, m.body, m.created_at AS "createdAt", m.sender_id AS "senderId",
                ${nameOf('m.sender_id')} AS "senderName", (m.sender_id = $2) AS mine
           FROM messages m
          WHERE m.conversation_id = $1 AND ($3::timestamptz IS NULL OR m.created_at < $3)
          ORDER BY m.created_at DESC, m.id DESC LIMIT 50) recent
       ORDER BY "createdAt", id`,
      [id, me, before ?? null],
    );
    res.json({ messages: rows, hasMore: rows.length === 50 });
  });

  router.post('/comm/conversations/:id/messages', canMessage, async (req, res) => {
    const me = requireUser(res).id;
    const id = uuid(req.params.id, 'Conversation');
    const { body } = messageSchema.parse(req.body);
    const members = await withTransaction(db, async (tx) => {
      if (!(await isMember(tx, id, me)))
        throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
      await tx.query(INSERT_MESSAGE, [id, me, body]);
      await tx.query(MARK_READ, [id, me]);
      return memberIds(tx, id);
    });
    hub.send(members, { type: 'message', id });
    res.status(201).json({ ok: true });
  });

  router.post('/comm/conversations/:id/read', canMessage, async (req, res) => {
    const me = requireUser(res).id;
    const id = uuid(req.params.id, 'Conversation');
    const { rowCount } = await db.query(MARK_READ, [id, me]);
    if (!rowCount) throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
    hub.send([me], { type: 'message', id });
    res.json({ ok: true });
  });

  // ---- Doctor availability ----
  router.post('/comm/availability', canMessage, async (req, res) => {
    const me = requireUser(res).id;
    const input = availabilitySchema.parse(req.body);
    const { rows } = await db.query<{ doctor: boolean }>(`SELECT ${IS_DOCTOR('$1')} AS doctor`, [
      me,
    ]);
    if (!rows[0]?.doctor)
      throw new AppError(403, 'NOT_A_DOCTOR', 'Only doctors set their availability.');
    await db.query(
      `INSERT INTO doctor_availability (user_id, status, note) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note`,
      [me, input.status, input.note || null],
    );
    hub.broadcast({ type: 'availability', id: me });
    res.json({ ok: true });
  });

  // ---- Call requests ----
  const CALL_COLUMNS = `c.id, c.reason, c.urgency, c.status, c.response_note AS "responseNote",
       c.created_at AS "createdAt", c.responded_at AS "respondedAt", c.conversation_id AS "conversationId",
       c.requester_id AS "requesterId", ${nameOf('c.requester_id')} AS "requesterName",
       c.doctor_user_id AS "doctorUserId", ${nameOf('c.doctor_user_id')} AS "doctorName",
       (c.created_at + ${TTL}) AS "expiresAt"`;

  router.get('/comm/calls', canMessage, async (_req, res) => {
    const me = requireUser(res).id;
    await expireOldCalls(db);
    const list = async (column: 'doctor_user_id' | 'requester_id') =>
      (
        await db.query(
          `SELECT ${CALL_COLUMNS} FROM call_requests c
            WHERE c.${column} = $1 AND c.created_at > now() - interval '24 hours'
            ORDER BY (c.status = 'pending') DESC, c.created_at DESC LIMIT 50`,
          [me],
        )
      ).rows;
    res.json({ incoming: await list('doctor_user_id'), outgoing: await list('requester_id') });
  });

  router.post('/comm/calls', requirePermission(db, 'call_request:create'), async (req, res) => {
    const input = callRequestSchema.parse(req.body);
    const me = requireUser(res).id;
    if (input.doctorUserId === me)
      throw new AppError(422, 'SELF_CALL', "You can't send a call request to yourself.");
    const id = await audited(
      req,
      res,
      {
        action: 'call_request.created',
        entityType: 'call_request',
        changes: { urgency: input.urgency },
      },
      async (tx) => {
        await expireOldCalls(tx);
        const { rows: doc } = await tx.query<{ doctor: boolean; status: string | null }>(
          `SELECT ${IS_DOCTOR('u.id')} AS doctor,
                  (SELECT status FROM doctor_availability WHERE user_id = u.id) AS status
             FROM users u WHERE u.id = $1 AND u.status = 'active'`,
          [input.doctorUserId],
        );
        if (!doc[0]?.doctor) throw new AppError(422, 'NOT_A_DOCTOR', 'That doctor was not found.');
        if (doc[0].status === 'off_duty' && input.urgency !== 'emergency')
          throw new AppError(
            409,
            'DOCTOR_OFF_DUTY',
            'This doctor is off duty. Only emergency requests can be sent.',
          );
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO call_requests (requester_id, doctor_user_id, reason, urgency)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [me, input.doctorUserId, input.reason, input.urgency],
        );
        return { id: rows[0]!.id, result: rows[0]!.id };
      },
    ).catch((err) => {
      if (pgCode(err) === '23505')
        throw new AppError(
          409,
          'ALREADY_PENDING',
          'You already have a request waiting for this doctor.',
        );
      throw err;
    });
    hub.send([me, input.doctorUserId], { type: 'call', id });
    res.status(201).json({ id });
  });

  /** Locks a pending, unexpired call request where `column` is the caller. */
  async function lockOpenCall(
    tx: Queryable,
    id: string,
    me: string,
    column: 'doctor_user_id' | 'requester_id',
  ) {
    const { rows } = await tx.query<{
      requesterId: string;
      doctorUserId: string;
      status: string;
      expired: boolean;
    }>(
      `SELECT requester_id AS "requesterId", doctor_user_id AS "doctorUserId", status,
              (created_at < now() - ${TTL}) AS expired
         FROM call_requests WHERE id = $1 AND ${column} = $2 FOR UPDATE`,
      [id, me],
    );
    const call = rows[0];
    if (!call) throw new AppError(404, 'NOT_FOUND', 'Call request not found');
    if (call.status !== 'pending' || call.expired)
      throw new AppError(
        409,
        'CALL_CLOSED',
        call.expired && call.status === 'pending'
          ? 'This request has expired.'
          : `This request was already ${call.status}.`,
      );
    return call;
  }

  router.post('/comm/calls/:id/respond', canMessage, async (req, res) => {
    const id = uuid(req.params.id, 'Call request');
    const { decision, note } = callResponseSchema.parse(req.body);
    const result = await audited(
      req,
      res,
      {
        action: decision === 'accept' ? 'call_request.accepted' : 'call_request.declined',
        entityType: 'call_request',
      },
      async (tx, me) => {
        const call = await lockOpenCall(tx, id, me, 'doctor_user_id');
        let conversationId: string | null = null;
        if (decision === 'accept') {
          conversationId = (await directConversation(tx, me, call.requesterId)).id;
          await tx.query(INSERT_MESSAGE, [
            conversationId,
            me,
            `Call request accepted.${note ? ` ${note}` : ''}`,
          ]);
        }
        await tx.query(
          `UPDATE call_requests SET status = $2, response_note = $3, responded_at = now(),
                  conversation_id = $4 WHERE id = $1`,
          [id, decision === 'accept' ? 'accepted' : 'declined', note || null, conversationId],
        );
        return { id, result: { conversationId, users: [me, call.requesterId] } };
      },
    );
    hub.send(result.users, { type: 'call', id });
    if (result.conversationId)
      hub.send(result.users, { type: 'message', id: result.conversationId });
    res.json({ conversationId: result.conversationId });
  });

  router.post('/comm/calls/:id/cancel', canMessage, async (req, res) => {
    const id = uuid(req.params.id, 'Call request');
    const users = await audited(
      req,
      res,
      { action: 'call_request.cancelled', entityType: 'call_request' },
      async (tx, me) => {
        const call = await lockOpenCall(tx, id, me, 'requester_id');
        await tx.query(`UPDATE call_requests SET status = 'cancelled' WHERE id = $1`, [id]);
        return { id, result: [me, call.doctorUserId] };
      },
    );
    hub.send(users, { type: 'call', id });
    res.json({ ok: true });
  });

  return router;
}
