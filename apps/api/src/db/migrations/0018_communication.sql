CREATE TABLE "call_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"doctor_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"urgency" text DEFAULT 'routine' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"response_note" text,
	"responded_at" timestamp with time zone,
	"conversation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_requests_urgency_check" CHECK ("call_requests"."urgency" IN ('routine', 'urgent', 'emergency')),
	CONSTRAINT "call_requests_status_check" CHECK ("call_requests"."status" IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
	CONSTRAINT "call_requests_not_self" CHECK ("call_requests"."requester_id" <> "call_requests"."doctor_user_id"),
	CONSTRAINT "call_requests_reason_length" CHECK (length(trim("call_requests"."reason")) BETWEEN 1 AND 300),
	CONSTRAINT "call_requests_response_fields" CHECK (("call_requests"."status" IN ('accepted', 'declined')) = ("call_requests"."responded_at" IS NOT NULL)
          AND ("call_requests"."status" = 'accepted') = ("call_requests"."conversation_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "conversation_members" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_members_pkey" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"title" text,
	"direct_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "conversations_direct_key_key" UNIQUE("direct_key"),
	CONSTRAINT "conversations_kind_check" CHECK ("conversations"."kind" IN ('direct', 'group')),
	CONSTRAINT "conversations_kind_fields" CHECK (CASE "conversations"."kind"
            WHEN 'direct' THEN "conversations"."direct_key" IS NOT NULL AND "conversations"."title" IS NULL
            ELSE "conversations"."direct_key" IS NULL AND length(trim("conversations"."title")) BETWEEN 1 AND 80
          END)
);
--> statement-breakpoint
CREATE TABLE "doctor_availability" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_availability_status_check" CHECK ("doctor_availability"."status" IN ('available', 'busy', 'off_duty')),
	CONSTRAINT "doctor_availability_note_length" CHECK (length("doctor_availability"."note") <= 100)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_body_length" CHECK (length(trim("messages"."body")) BETWEEN 1 AND 2000)
);
--> statement-breakpoint
CREATE TABLE "notice_reads" (
	"notice_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notice_reads_pkey" PRIMARY KEY("notice_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"audience" text NOT NULL,
	"audience_role" text,
	"audience_department_id" uuid,
	"audience_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "notices_priority_check" CHECK ("notices"."priority" IN ('normal', 'urgent')),
	CONSTRAINT "notices_audience_check" CHECK ("notices"."audience" IN ('all', 'role', 'department', 'user')),
	CONSTRAINT "notices_title_not_blank" CHECK (length(trim("notices"."title")) BETWEEN 1 AND 150),
	CONSTRAINT "notices_body_not_blank" CHECK (length(trim("notices"."body")) BETWEEN 1 AND 4000),
	CONSTRAINT "notices_audience_target" CHECK (("notices"."audience_role" IS NOT NULL) = ("notices"."audience" = 'role')
          AND ("notices"."audience_department_id" IS NOT NULL) = ("notices"."audience" = 'department')
          AND ("notices"."audience_user_id" IS NOT NULL) = ("notices"."audience" = 'user'))
);
--> statement-breakpoint
ALTER TABLE "call_requests" ADD CONSTRAINT "call_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_requests" ADD CONSTRAINT "call_requests_doctor_user_id_users_id_fk" FOREIGN KEY ("doctor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_requests" ADD CONSTRAINT "call_requests_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_availability" ADD CONSTRAINT "doctor_availability_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_notice_id_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."notices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_audience_department_id_departments_id_fk" FOREIGN KEY ("audience_department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_audience_user_id_users_id_fk" FOREIGN KEY ("audience_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_requests_doctor_idx" ON "call_requests" USING btree ("doctor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "call_requests_requester_idx" ON "call_requests" USING btree ("requester_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "call_requests_one_pending" ON "call_requests" USING btree ("requester_id","doctor_user_id") WHERE "call_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "conversation_members_user_idx" ON "conversation_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "notice_reads_user_idx" ON "notice_reads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notices_created_at_idx" ON "notices" USING btree ("created_at");