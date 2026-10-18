CREATE SEQUENCE "public"."enquiry_no_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9999999 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."expense_no_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9999999 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"status" text NOT NULL,
	"check_in" time,
	"check_out" time,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "attendance_employee_date_key" UNIQUE("employee_id","work_date"),
	CONSTRAINT "attendance_status_check" CHECK ("attendance"."status" IN ('present', 'absent', 'leave', 'half_day')),
	CONSTRAINT "attendance_time_order" CHECK ("attendance"."check_in" IS NULL OR "attendance"."check_out" IS NULL OR "attendance"."check_in" <= "attendance"."check_out")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"channel" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"status" text DEFAULT 'planned' NOT NULL,
	"budget_paise" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "campaigns_status_check" CHECK ("campaigns"."status" IN ('planned', 'active', 'completed')),
	CONSTRAINT "campaigns_date_order" CHECK ("campaigns"."end_date" IS NULL OR "campaigns"."start_date" <= "campaigns"."end_date"),
	CONSTRAINT "campaigns_budget_non_negative" CHECK ("campaigns"."budget_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enquiry_no" text DEFAULT ('ENQ' || lpad(nextval('enquiry_no_seq')::text, 7, '0')) NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"channel" text NOT NULL,
	"referral_source_id" uuid,
	"campaign_id" uuid,
	"subject" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'open' NOT NULL,
	"converted_patient_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "enquiries_enquiry_no_key" UNIQUE("enquiry_no"),
	CONSTRAINT "enquiries_channel_check" CHECK ("enquiries"."channel" IN ('phone', 'walk_in', 'web', 'referral', 'other')),
	CONSTRAINT "enquiries_status_check" CHECK ("enquiries"."status" IN ('open', 'follow_up', 'converted', 'closed')),
	CONSTRAINT "enquiries_phone_digits" CHECK ("enquiries"."phone" ~ '^[0-9]{7,15}$'),
	CONSTRAINT "enquiries_converted_link" CHECK (("enquiries"."status" = 'converted') = ("enquiries"."converted_patient_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "enquiry_follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"note" text NOT NULL,
	"due_on" date,
	"done" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_tag" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"serial_no" text,
	"department_id" uuid,
	"location_note" text,
	"status" text DEFAULT 'in_service' NOT NULL,
	"purchase_date" date,
	"maintenance_interval_days" integer,
	"next_maintenance_due" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "equipment_asset_tag_key" UNIQUE("asset_tag"),
	CONSTRAINT "equipment_serial_no_key" UNIQUE("serial_no"),
	CONSTRAINT "equipment_status_check" CHECK ("equipment"."status" IN ('in_service', 'under_maintenance', 'out_of_service', 'retired')),
	CONSTRAINT "equipment_interval" CHECK ("equipment"."maintenance_interval_days" IS NULL OR "equipment"."maintenance_interval_days" BETWEEN 1 AND 3650)
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "expense_categories_code_key" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_no" text DEFAULT ('EXP' || lpad(nextval('expense_no_seq')::text, 7, '0')) NOT NULL,
	"category_id" uuid NOT NULL,
	"expense_date" date NOT NULL,
	"amount_paise" bigint NOT NULL,
	"payee" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "expenses_expense_no_key" UNIQUE("expense_no"),
	CONSTRAINT "expenses_amount_positive" CHECK ("expenses"."amount_paise" > 0),
	CONSTRAINT "expenses_status_check" CHECK ("expenses"."status" IN ('submitted', 'approved', 'rejected')),
	CONSTRAINT "expenses_decision_fields" CHECK (("expenses"."status" <> 'submitted') = ("expenses"."decided_by" IS NOT NULL AND "expenses"."decided_at" IS NOT NULL)),
	CONSTRAINT "expenses_not_self_approved" CHECK ("expenses"."decided_by" IS NULL OR "expenses"."decided_by" <> "expenses"."created_by")
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "leave_requests_kind_check" CHECK ("leave_requests"."kind" IN ('casual', 'sick', 'earned', 'other')),
	CONSTRAINT "leave_requests_status_check" CHECK ("leave_requests"."status" IN ('pending', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "leave_requests_date_order" CHECK ("leave_requests"."start_date" <= "leave_requests"."end_date"),
	CONSTRAINT "leave_requests_decision_fields" CHECK (("leave_requests"."status" IN ('approved', 'rejected')) = ("leave_requests"."decided_by" IS NOT NULL AND "leave_requests"."decided_at" IS NOT NULL)),
	CONSTRAINT "leave_requests_not_self_decided" CHECK ("leave_requests"."decided_by" IS NULL OR "leave_requests"."decided_by" <> "leave_requests"."created_by")
);
--> statement-breakpoint
CREATE TABLE "maintenance_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"performed_on" date NOT NULL,
	"notes" text NOT NULL,
	"outcome" text NOT NULL,
	"next_due" date,
	"logged_by" uuid NOT NULL,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_logs_kind_check" CHECK ("maintenance_logs"."kind" IN ('preventive', 'corrective', 'inspection')),
	CONSTRAINT "maintenance_logs_outcome_check" CHECK ("maintenance_logs"."outcome" IN ('in_service', 'under_maintenance', 'out_of_service'))
);
--> statement-breakpoint
CREATE TABLE "referral_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" "citext" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "referral_sources_name_key" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_referral_source_id_referral_sources_id_fk" FOREIGN KEY ("referral_source_id") REFERENCES "public"."referral_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_converted_patient_id_patients_id_fk" FOREIGN KEY ("converted_patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_follow_ups" ADD CONSTRAINT "enquiry_follow_ups_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_follow_ups" ADD CONSTRAINT "enquiry_follow_ups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_logs" ADD CONSTRAINT "maintenance_logs_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_logs" ADD CONSTRAINT "maintenance_logs_logged_by_users_id_fk" FOREIGN KEY ("logged_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_sources" ADD CONSTRAINT "referral_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_sources" ADD CONSTRAINT "referral_sources_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_date_idx" ON "attendance" USING btree ("work_date");--> statement-breakpoint
CREATE INDEX "enquiries_status_idx" ON "enquiries" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "enquiry_follow_ups_enquiry_idx" ON "enquiry_follow_ups" USING btree ("enquiry_id","created_at");--> statement-breakpoint
CREATE INDEX "equipment_next_due_idx" ON "equipment" USING btree ("next_maintenance_due");--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("expense_date");--> statement-breakpoint
CREATE INDEX "expenses_status_idx" ON "expenses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leave_requests_employee_idx" ON "leave_requests" USING btree ("employee_id","start_date");--> statement-breakpoint
CREATE INDEX "leave_requests_status_idx" ON "leave_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "maintenance_logs_equipment_idx" ON "maintenance_logs" USING btree ("equipment_id","performed_on");