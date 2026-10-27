/**
 * Communication hub: official notices, staff messages, doctor availability and call
 * requests (Phase C1). Video meetings come in Phase C2.
 */
import { z } from 'zod';
import { ROLE_CODES } from '../index.js';

export const NOTICE_PRIORITIES = ['normal', 'urgent'] as const;
export const NOTICE_AUDIENCES = ['all', 'role', 'department', 'user'] as const;
export const CONVERSATION_KINDS = ['direct', 'group'] as const;
export const AVAILABILITY_STATUSES = ['available', 'busy', 'off_duty'] as const;
export const CALL_URGENCIES = ['routine', 'urgent', 'emergency'] as const;
export const CALL_STATUSES = ['pending', 'accepted', 'declined', 'cancelled', 'expired'] as const;

export type NoticePriority = (typeof NOTICE_PRIORITIES)[number];
export type NoticeAudience = (typeof NOTICE_AUDIENCES)[number];
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];
export type CallUrgency = (typeof CALL_URGENCIES)[number];
export type CallStatus = (typeof CALL_STATUSES)[number];

/** A call request the doctor hasn't answered within this time expires. */
export const CALL_REQUEST_TTL_MINUTES = 10;
export const MAX_GROUP_MEMBERS = 30;

export const AVAILABILITY_LABELS: Record<AvailabilityStatus, string> = {
  available: 'Available',
  busy: 'Busy',
  off_duty: 'Off duty',
};
export const CALL_URGENCY_LABELS: Record<CallUrgency, string> = {
  routine: 'Routine',
  urgent: 'Urgent',
  emergency: 'Emergency',
};

const text = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);

export const noticeSchema = z
  .strictObject({
    title: text('Title', 150),
    body: text('Notice', 4000),
    priority: z.enum(NOTICE_PRIORITIES).default('normal'),
    audience: z.enum(NOTICE_AUDIENCES),
    // Checked lazily: index.ts (which defines ROLE_CODES) also re-exports this module.
    roleCode: z
      .string()
      .refine((v) => (ROLE_CODES as readonly string[]).includes(v), 'Unknown role')
      .optional(),
    departmentId: z.uuid().optional(),
    userId: z.uuid().optional(),
  })
  .superRefine((n, ctx) => {
    const need = { role: 'roleCode', department: 'departmentId', user: 'userId' } as const;
    for (const [audience, field] of Object.entries(need)) {
      const present = n[field] !== undefined;
      if (n.audience === audience && !present)
        ctx.addIssue({ code: 'custom', path: [field], message: 'Choose who receives the notice' });
      if (n.audience !== audience && present)
        ctx.addIssue({ code: 'custom', path: [field], message: `Not used for this audience` });
    }
  });
export type NoticeInput = z.infer<typeof noticeSchema>;

export const conversationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('direct'), userId: z.uuid() }),
  z.strictObject({
    kind: z.literal('group'),
    title: text('Group name', 80),
    memberIds: z
      .array(z.uuid())
      .min(1, 'Add at least one person')
      .max(MAX_GROUP_MEMBERS - 1, `A group can have at most ${MAX_GROUP_MEMBERS} people`),
  }),
]);
export type ConversationInput = z.infer<typeof conversationSchema>;

export const messageSchema = z.strictObject({ body: text('Message', 2000) });

export const availabilitySchema = z.strictObject({
  status: z.enum(AVAILABILITY_STATUSES),
  note: z.string().trim().max(100, 'Note must be at most 100 characters').optional(),
});

export const callRequestSchema = z.strictObject({
  doctorUserId: z.uuid(),
  reason: text('Reason', 300),
  urgency: z.enum(CALL_URGENCIES).default('routine'),
});
export type CallRequestInput = z.infer<typeof callRequestSchema>;

export const callResponseSchema = z.strictObject({
  decision: z.enum(['accept', 'decline']),
  note: z.string().trim().max(200, 'Note must be at most 200 characters').optional(),
});

/** What GET /api/comm/summary returns: the counts on the chat button. */
export interface CommSummary {
  unreadMessages: number;
  unreadNotices: number;
  incomingCalls: number;
  isDoctor: boolean;
  availability: AvailabilityStatus | null;
  /** Active meetings this user is invited to but not in. */
  meetingInvites: number;
}

// ---- Video meetings (Phase C2) ----

export const MEETING_KINDS = ['standard', 'emergency'] as const;
export const MEETING_STATUSES = ['active', 'ended'] as const;
export type MeetingKind = (typeof MEETING_KINDS)[number];
/** Browser-to-browser (mesh) video stays usable up to about this many people at once. */
export const MAX_IN_MEETING = 8;
export const MAX_MEETING_INVITEES = 100;
/** A participant who hasn't sent a heartbeat for this long counts as gone. */
export const MEETING_PRESENCE_SECONDS = 45;
/** Roles that can be invited as a whole group ("all doctors", "HR", "administration"). */
export const MEETING_INVITE_ROLES = ['DOC', 'NUR', 'HR', 'ADM', 'SA'] as const;

export const meetingSchema = z
  .strictObject({
    title: text('Meeting title', 120),
    kind: z.enum(MEETING_KINDS).default('standard'),
    inviteeIds: z.array(z.uuid()).max(MAX_MEETING_INVITEES).default([]),
    inviteRoles: z.array(z.enum(MEETING_INVITE_ROLES)).max(MEETING_INVITE_ROLES.length).default([]),
  })
  .refine((m) => m.inviteeIds.length > 0 || m.inviteRoles.length > 0, {
    path: ['inviteeIds'],
    message: 'Invite at least one person or group',
  });
export type MeetingInput = z.input<typeof meetingSchema>;

/** WebRTC signalling relayed between two people in the same meeting. */
export const SIGNAL_KINDS = ['offer', 'answer', 'ice'] as const;
export const signalSchema = z.strictObject({
  to: z.uuid(),
  kind: z.enum(SIGNAL_KINDS),
  data: z
    .record(z.string(), z.unknown())
    .refine((d) => JSON.stringify(d).length <= 20_000, 'Signal too large'),
});
export type SignalInput = z.infer<typeof signalSchema>;

/**
 * Server-sent event names. Events carry IDs only and the client reloads the data, except
 * 'signal', which carries WebRTC connection details (no patient data) between two people
 * in the same meeting.
 */
export const COMM_EVENTS = [
  'message',
  'notice',
  'call',
  'availability',
  'meeting',
  'signal',
] as const;
export type CommEventType = (typeof COMM_EVENTS)[number];
