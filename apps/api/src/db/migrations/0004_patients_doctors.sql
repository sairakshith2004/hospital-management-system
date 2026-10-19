CREATE SEQUENCE "public"."patient_mrn_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 999999 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mrn" text DEFAULT ('MRN' || lpad(nextval('patient_mrn_seq')::text, 6, '0')) NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"dob" date NOT NULL,
	"sex" text NOT NULL,
	"phone" text NOT NULL,
	"email" "citext",
	"address" text,
	"blood_group" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "patients_mrn_key" UNIQUE("mrn"),
	CONSTRAINT "patients_first_name_not_blank" CHECK (length(trim("patients"."first_name")) > 0),
	CONSTRAINT "patients_last_name_not_blank" CHECK (length(trim("patients"."last_name")) > 0),
	CONSTRAINT "patients_sex_check" CHECK ("patients"."sex" IN ('female', 'male', 'other', 'unknown')),
	CONSTRAINT "patients_phone_digits" CHECK ("patients"."phone" ~ '^[0-9]{7,15}$'),
	CONSTRAINT "patients_blood_group_check" CHECK ("patients"."blood_group" IS NULL OR "patients"."blood_group" IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
	CONSTRAINT "patients_dob_after_1900" CHECK ("patients"."dob" >= DATE '1900-01-01'),
	CONSTRAINT "patients_version_positive" CHECK ("patients"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "doctor_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"specialty" text NOT NULL,
	"registration_no" text NOT NULL,
	"default_slot_minutes" integer DEFAULT 15 NOT NULL,
	"consultation_fee_paise" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "doctor_profiles_employee_id_key" UNIQUE("employee_id"),
	CONSTRAINT "doctor_profiles_registration_no_key" UNIQUE("registration_no"),
	CONSTRAINT "doctor_profiles_specialty_not_blank" CHECK (length(trim("doctor_profiles"."specialty")) > 0),
	CONSTRAINT "doctor_profiles_slot_minutes" CHECK ("doctor_profiles"."default_slot_minutes" BETWEEN 5 AND 120),
	CONSTRAINT "doctor_profiles_fee_non_negative" CHECK ("doctor_profiles"."consultation_fee_paise" >= 0)
);
--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patients_phone_dob_idx" ON "patients" USING btree ("phone","dob");--> statement-breakpoint
CREATE INDEX "patients_dob_idx" ON "patients" USING btree ("dob");--> statement-breakpoint
CREATE INDEX "doctor_profiles_department_id_idx" ON "doctor_profiles" USING btree ("department_id");