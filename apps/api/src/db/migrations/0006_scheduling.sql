CREATE SEQUENCE "public"."appointment_no_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9999999 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_no" text DEFAULT ('APT' || lpad(nextval('appointment_no_seq')::text, 7, '0')) NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"doctor_schedule_id" uuid,
	"kind" text NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"visit_date" date NOT NULL,
	"slot_start" timestamp with time zone,
	"slot_end" timestamp with time zone,
	"token_no" integer,
	"checked_in_at" timestamp with time zone,
	"consult_started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"no_show_at" timestamp with time zone,
	"rescheduled_from_id" uuid,
	"follow_up_of_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "appointments_appointment_no_key" UNIQUE("appointment_no"),
	CONSTRAINT "appointments_rescheduled_from_id_key" UNIQUE("rescheduled_from_id"),
	CONSTRAINT "appointments_id_patient_id_key" UNIQUE("id","patient_id"),
	CONSTRAINT "appointments_kind_check" CHECK ("appointments"."kind" IN ('scheduled', 'walk_in', 'follow_up')),
	CONSTRAINT "appointments_status_check" CHECK ("appointments"."status" IN ('booked', 'checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show', 'rescheduled')),
	CONSTRAINT "appointments_walk_in_has_no_slot" CHECK (("appointments"."kind" = 'walk_in') = ("appointments"."slot_start" IS NULL)),
	CONSTRAINT "appointments_slot_both_or_neither" CHECK (("appointments"."slot_start" IS NULL) = ("appointments"."slot_end" IS NULL)),
	CONSTRAINT "appointments_slot_order" CHECK ("appointments"."slot_start" IS NULL OR "appointments"."slot_start" < "appointments"."slot_end"),
	CONSTRAINT "appointments_slot_on_visit_date" CHECK ("appointments"."slot_start" IS NULL OR "appointments"."visit_date" = ("appointments"."slot_start" AT TIME ZONE 'Asia/Kolkata')::date),
	CONSTRAINT "appointments_follow_up_link" CHECK (("appointments"."kind" = 'follow_up') = ("appointments"."follow_up_of_id" IS NOT NULL)),
	CONSTRAINT "appointments_not_own_follow_up" CHECK ("appointments"."follow_up_of_id" IS NULL OR "appointments"."follow_up_of_id" <> "appointments"."id"),
	CONSTRAINT "appointments_not_own_reschedule" CHECK ("appointments"."rescheduled_from_id" IS NULL OR "appointments"."rescheduled_from_id" <> "appointments"."id"),
	CONSTRAINT "appointments_token_positive" CHECK ("appointments"."token_no" IS NULL OR "appointments"."token_no" > 0),
	CONSTRAINT "appointments_checked_in_fields" CHECK ("appointments"."status" NOT IN ('checked_in', 'in_consultation', 'completed') OR ("appointments"."checked_in_at" IS NOT NULL AND "appointments"."token_no" IS NOT NULL)),
	CONSTRAINT "appointments_cancelled_fields" CHECK ("appointments"."status" <> 'cancelled' OR ("appointments"."cancelled_at" IS NOT NULL AND length(trim("appointments"."cancel_reason")) > 0)),
	CONSTRAINT "appointments_no_show_fields" CHECK ("appointments"."status" <> 'no_show' OR "appointments"."no_show_at" IS NOT NULL),
	CONSTRAINT "appointments_cancel_reason_length" CHECK ("appointments"."cancel_reason" IS NULL OR length("appointments"."cancel_reason") <= 200)
);
--> statement-breakpoint
CREATE TABLE "doctor_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"slot_minutes" integer NOT NULL,
	"valid_from" date DEFAULT CURRENT_DATE NOT NULL,
	"valid_to" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "doctor_schedules_id_doctor_id_key" UNIQUE("id","doctor_id"),
	CONSTRAINT "doctor_schedules_weekday_check" CHECK ("doctor_schedules"."weekday" BETWEEN 1 AND 7),
	CONSTRAINT "doctor_schedules_time_order" CHECK ("doctor_schedules"."start_time" < "doctor_schedules"."end_time"),
	CONSTRAINT "doctor_schedules_slot_minutes" CHECK ("doctor_schedules"."slot_minutes" BETWEEN 5 AND 120),
	CONSTRAINT "doctor_schedules_fits_one_slot" CHECK ("doctor_schedules"."end_time" - "doctor_schedules"."start_time" >= make_interval(mins => "doctor_schedules"."slot_minutes")),
	CONSTRAINT "doctor_schedules_valid_range" CHECK ("doctor_schedules"."valid_to" IS NULL OR "doctor_schedules"."valid_to" >= "doctor_schedules"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "schedule_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "schedule_exceptions_kind_check" CHECK ("schedule_exceptions"."kind" IN ('leave', 'blocked')),
	CONSTRAINT "schedule_exceptions_time_order" CHECK ("schedule_exceptions"."starts_at" < "schedule_exceptions"."ends_at"),
	CONSTRAINT "schedule_exceptions_reason_length" CHECK ("schedule_exceptions"."reason" IS NULL OR length("schedule_exceptions"."reason") <= 200)
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_doctor_profiles_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_schedule_doctor_fk" FOREIGN KEY ("doctor_schedule_id","doctor_id") REFERENCES "public"."doctor_schedules"("id","doctor_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_rescheduled_from_same_patient_fk" FOREIGN KEY ("rescheduled_from_id","patient_id") REFERENCES "public"."appointments"("id","patient_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_follow_up_of_same_patient_fk" FOREIGN KEY ("follow_up_of_id","patient_id") REFERENCES "public"."appointments"("id","patient_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_schedules" ADD CONSTRAINT "doctor_schedules_doctor_id_doctor_profiles_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_schedules" ADD CONSTRAINT "doctor_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_schedules" ADD CONSTRAINT "doctor_schedules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_doctor_id_doctor_profiles_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_doctor_day_token_key" ON "appointments" USING btree ("doctor_id","visit_date","token_no") WHERE "appointments"."token_no" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_patient_doctor_day_active_key" ON "appointments" USING btree ("patient_id","doctor_id","visit_date") WHERE "appointments"."status" IN ('booked', 'checked_in', 'in_consultation');--> statement-breakpoint
CREATE INDEX "appointments_day_doctor_status_idx" ON "appointments" USING btree ("visit_date","doctor_id","status");--> statement-breakpoint
CREATE INDEX "appointments_patient_id_idx" ON "appointments" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "doctor_schedules_doctor_id_idx" ON "doctor_schedules" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "schedule_exceptions_doctor_starts_idx" ON "schedule_exceptions" USING btree ("doctor_id","starts_at");