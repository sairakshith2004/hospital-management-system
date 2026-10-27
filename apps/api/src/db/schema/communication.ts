/**
 * Communication hub (Phase C1): official notices and who has read them, staff
 * conversations and their messages, doctor availability and call requests to doctors.
 * Messages and notices are append-only (migration 0019); call requests become final once
 * answered, cancelled or expired.
 */
import {
  AVAILABILITY_STATUSES,
  CALL_STATUSES,
  CALL_URGENCIES,
  CONVERSATION_KINDS,
  MEETING_KINDS,
  MEETING_STATUSES,
  NOTICE_AUDIENCES,
  NOTICE_PRIORITIES,
} from '@hospitalos/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { oneOf } from './columns.js';
import { departments, users } from './identity.js';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const notices = pgTable(
  'notices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    priority: text('priority').notNull().default('normal'),
    audience: text('audience').notNull(),
    audienceRole: text('audience_role'),
    audienceDepartmentId: uuid('audience_department_id').references(() => departments.id, {
      onDelete: 'restrict',
    }),
    audienceUserId: uuid('audience_user_id').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    index('notices_created_at_idx').on(t.createdAt),
    check('notices_priority_check', oneOf(t.priority, NOTICE_PRIORITIES)),
    check('notices_audience_check', oneOf(t.audience, NOTICE_AUDIENCES)),
    check('notices_title_not_blank', sql`length(trim(${t.title})) BETWEEN 1 AND 150`),
    check('notices_body_not_blank', sql`length(trim(${t.body})) BETWEEN 1 AND 4000`),
    // Exactly the target column of the chosen audience is filled in.
    check(
      'notices_audience_target',
      sql`(${t.audienceRole} IS NOT NULL) = (${t.audience} = 'role')
          AND (${t.audienceDepartmentId} IS NOT NULL) = (${t.audience} = 'department')
          AND (${t.audienceUserId} IS NOT NULL) = (${t.audience} = 'user')`,
    ),
  ],
);

export const noticeReads = pgTable(
  'notice_reads',
  {
    noticeId: uuid('notice_id')
      .notNull()
      .references(() => notices.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'notice_reads_pkey', columns: [t.noticeId, t.userId] }),
    index('notice_reads_user_idx').on(t.userId),
  ],
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    title: text('title'),
    /** Direct chats only: the two user IDs, sorted and joined by ':', so each pair has one chat. */
    directKey: text('direct_key').unique('conversations_direct_key_key'),
    createdAt: createdAt(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    check('conversations_kind_check', oneOf(t.kind, CONVERSATION_KINDS)),
    check(
      'conversations_kind_fields',
      sql`CASE ${t.kind}
            WHEN 'direct' THEN ${t.directKey} IS NOT NULL AND ${t.title} IS NULL
            ELSE ${t.directKey} IS NULL AND length(trim(${t.title})) BETWEEN 1 AND 80
          END`,
    ),
  ],
);

export const conversationMembers = pgTable(
  'conversation_members',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    /** Messages after this are unread for the member. */
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'conversation_members_pkey', columns: [t.conversationId, t.userId] }),
    index('conversation_members_user_idx').on(t.userId),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'restrict' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('messages_conversation_created_idx').on(t.conversationId, t.createdAt),
    check('messages_body_length', sql`length(trim(${t.body})) BETWEEN 1 AND 2000`),
  ],
);

export const doctorAvailability = pgTable(
  'doctor_availability',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: text('status').notNull(),
    note: text('note'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('doctor_availability_status_check', oneOf(t.status, AVAILABILITY_STATUSES)),
    check('doctor_availability_note_length', sql`length(${t.note}) <= 100`),
  ],
);

export const callRequests = pgTable(
  'call_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    doctorUserId: uuid('doctor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    urgency: text('urgency').notNull().default('routine'),
    status: text('status').notNull().default('pending'),
    responseNote: text('response_note'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    /** The chat opened when the doctor accepted. */
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'restrict',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    index('call_requests_doctor_idx').on(t.doctorUserId, t.createdAt),
    index('call_requests_requester_idx').on(t.requesterId, t.createdAt),
    // One open request at a time from the same person to the same doctor.
    uniqueIndex('call_requests_one_pending')
      .on(t.requesterId, t.doctorUserId)
      .where(sql`${t.status} = 'pending'`),
    check('call_requests_urgency_check', oneOf(t.urgency, CALL_URGENCIES)),
    check('call_requests_status_check', oneOf(t.status, CALL_STATUSES)),
    check('call_requests_not_self', sql`${t.requesterId} <> ${t.doctorUserId}`),
    check('call_requests_reason_length', sql`length(trim(${t.reason})) BETWEEN 1 AND 300`),
    check(
      'call_requests_response_fields',
      sql`(${t.status} IN ('accepted', 'declined')) = (${t.respondedAt} IS NOT NULL)
          AND (${t.status} = 'accepted') = (${t.conversationId} IS NOT NULL)`,
    ),
  ],
);

/** Video meetings (Phase C2). Each has a conversation for its chat and invitation list. */
export const meetings = pgTable(
  'meetings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    kind: text('kind').notNull().default('standard'),
    status: text('status').notNull().default('active'),
    hostId: uuid('host_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedBy: uuid('ended_by').references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    index('meetings_created_at_idx').on(t.createdAt),
    // One live meeting per conversation: a second "video call" joins the first.
    uniqueIndex('meetings_one_active_per_conversation')
      .on(t.conversationId)
      .where(sql`${t.status} = 'active'`),
    check('meetings_kind_check', oneOf(t.kind, MEETING_KINDS)),
    check('meetings_status_check', oneOf(t.status, MEETING_STATUSES)),
    check('meetings_title_length', sql`length(trim(${t.title})) BETWEEN 1 AND 120`),
    check('meetings_ended_fields', sql`(${t.status} = 'ended') = (${t.endedAt} IS NOT NULL)`),
  ],
);

export const meetingParticipants = pgTable(
  'meeting_participants',
  {
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
    /** First time the person joined; null if they never did. */
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    present: boolean('present').notNull().default(false),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: 'meeting_participants_pkey', columns: [t.meetingId, t.userId] }),
    index('meeting_participants_user_idx').on(t.userId),
    check(
      'meeting_participants_present_joined',
      sql`NOT ${t.present} OR (${t.joinedAt} IS NOT NULL AND ${t.lastSeenAt} IS NOT NULL)`,
    ),
  ],
);
