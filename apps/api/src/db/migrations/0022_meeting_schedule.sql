ALTER TABLE "meetings" DROP CONSTRAINT "meetings_status_check";--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "scheduled_for" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "meetings_scheduled_for_idx" ON "meetings" USING btree ("scheduled_for") WHERE "meetings"."status" = 'scheduled';--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_scheduled_fields" CHECK ("meetings"."status" <> 'scheduled' OR "meetings"."scheduled_for" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_status_check" CHECK ("meetings"."status" IN ('scheduled', 'active', 'ended'));