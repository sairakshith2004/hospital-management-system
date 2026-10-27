CREATE TABLE "meeting_participants" (
	"meeting_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"joined_at" timestamp with time zone,
	"present" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	CONSTRAINT "meeting_participants_pkey" PRIMARY KEY("meeting_id","user_id"),
	CONSTRAINT "meeting_participants_present_joined" CHECK (NOT "meeting_participants"."present" OR ("meeting_participants"."joined_at" IS NOT NULL AND "meeting_participants"."last_seen_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'standard' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"host_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	CONSTRAINT "meetings_kind_check" CHECK ("meetings"."kind" IN ('standard', 'emergency')),
	CONSTRAINT "meetings_status_check" CHECK ("meetings"."status" IN ('active', 'ended')),
	CONSTRAINT "meetings_title_length" CHECK (length(trim("meetings"."title")) BETWEEN 1 AND 120),
	CONSTRAINT "meetings_ended_fields" CHECK (("meetings"."status" = 'ended') = ("meetings"."ended_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_participants_user_idx" ON "meeting_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "meetings_created_at_idx" ON "meetings" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_one_active_per_conversation" ON "meetings" USING btree ("conversation_id") WHERE "meetings"."status" = 'active';