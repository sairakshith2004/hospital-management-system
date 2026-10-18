CREATE SEQUENCE "public"."dispense_no_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9999999 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."encounter_no_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9999999 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."rx_no_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9999999 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "allergies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"substance" text NOT NULL,
	"ingredient_id" uuid,
	"reaction" text,
	"severity" text DEFAULT 'unknown' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "allergies_severity_check" CHECK ("allergies"."severity" IN ('mild', 'moderate', 'severe', 'unknown')),
	CONSTRAINT "allergies_status_check" CHECK ("allergies"."status" IN ('active', 'inactive')),
	CONSTRAINT "allergies_substance_not_blank" CHECK (length(trim("allergies"."substance")) > 0)
);
--> statement-breakpoint
CREATE TABLE "clinical_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"encounter_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_notes_kind_check" CHECK ("clinical_notes"."kind" IN ('symptoms', 'observation', 'plan', 'addendum')),
	CONSTRAINT "clinical_notes_body_not_blank" CHECK (length(trim("clinical_notes"."body")) > 0)
);
--> statement-breakpoint
CREATE TABLE "diagnoses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"encounter_id" uuid NOT NULL,
	"description" text NOT NULL,
	"code" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "diagnoses_description_not_blank" CHECK (length(trim("diagnoses"."description")) > 0)
);
--> statement-breakpoint
CREATE TABLE "dispensing_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispensing_id" uuid NOT NULL,
	"prescription_id" uuid NOT NULL,
	"prescription_item_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"dispensed_product_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_price_paise" bigint NOT NULL,
	"stock_movement_id" bigint NOT NULL,
	CONSTRAINT "dispensing_lines_stock_movement_key" UNIQUE("stock_movement_id"),
	CONSTRAINT "dispensing_lines_qty_positive" CHECK ("dispensing_lines"."qty" > 0),
	CONSTRAINT "dispensing_lines_price_non_negative" CHECK ("dispensing_lines"."unit_price_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "dispensings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispense_no" text DEFAULT ('DSP' || lpad(nextval('dispense_no_seq')::text, 7, '0')) NOT NULL,
	"prescription_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"dispensed_by" uuid NOT NULL,
	"dispensed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispensings_dispense_no_key" UNIQUE("dispense_no"),
	CONSTRAINT "dispensings_idempotency_key_key" UNIQUE("idempotency_key"),
	CONSTRAINT "dispensings_id_prescription_key" UNIQUE("id","prescription_id")
);
--> statement-breakpoint
CREATE TABLE "encounters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"encounter_no" text DEFAULT ('ENC' || lpad(nextval('encounter_no_seq')::text, 7, '0')) NOT NULL,
	"appointment_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"chief_complaint" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "encounters_encounter_no_key" UNIQUE("encounter_no"),
	CONSTRAINT "encounters_appointment_id_key" UNIQUE("appointment_id"),
	CONSTRAINT "encounters_id_patient_key" UNIQUE("id","patient_id"),
	CONSTRAINT "encounters_status_check" CHECK ("encounters"."status" IN ('in_progress', 'completed')),
	CONSTRAINT "encounters_completed_fields" CHECK (("encounters"."status" = 'completed') = ("encounters"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"source_encounter_id" uuid NOT NULL,
	"recommended_by" uuid NOT NULL,
	"target_doctor_id" uuid,
	"reason" text NOT NULL,
	"instructions" text,
	"due_from" date NOT NULL,
	"due_to" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "follow_ups_status_check" CHECK ("follow_ups"."status" IN ('pending', 'booked', 'completed', 'cancelled')),
	CONSTRAINT "follow_ups_due_order" CHECK ("follow_ups"."due_from" <= "follow_ups"."due_to"),
	CONSTRAINT "follow_ups_reason_not_blank" CHECK (length(trim("follow_ups"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "prescription_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prescription_id" uuid NOT NULL,
	"medicine_product_id" uuid NOT NULL,
	"dose" text NOT NULL,
	"frequency" text NOT NULL,
	"route" text NOT NULL,
	"duration_days" integer,
	"qty_prescribed" integer NOT NULL,
	"qty_dispensed" integer DEFAULT 0 NOT NULL,
	"instructions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prescription_items_id_prescription_key" UNIQUE("id","prescription_id"),
	CONSTRAINT "prescription_items_qty_positive" CHECK ("prescription_items"."qty_prescribed" > 0),
	CONSTRAINT "prescription_items_dispensed_range" CHECK ("prescription_items"."qty_dispensed" BETWEEN 0 AND "prescription_items"."qty_prescribed"),
	CONSTRAINT "prescription_items_duration" CHECK ("prescription_items"."duration_days" IS NULL OR "prescription_items"."duration_days" BETWEEN 1 AND 365)
);
--> statement-breakpoint
CREATE TABLE "prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rx_no" text DEFAULT ('RX' || lpad(nextval('rx_no_seq')::text, 7, '0')) NOT NULL,
	"encounter_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "prescriptions_rx_no_key" UNIQUE("rx_no"),
	CONSTRAINT "prescriptions_id_patient_key" UNIQUE("id","patient_id"),
	CONSTRAINT "prescriptions_status_check" CHECK ("prescriptions"."status" IN ('issued', 'partially_dispensed', 'dispensed', 'cancelled', 'closed')),
	CONSTRAINT "prescriptions_cancel_reason" CHECK ("prescriptions"."status" <> 'cancelled' OR length(trim(coalesce("prescriptions"."cancel_reason", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "vital_signs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"temp_c" numeric(4, 1),
	"pulse" integer,
	"bp_sys" integer,
	"bp_dia" integer,
	"resp_rate" integer,
	"spo2" integer,
	"weight_kg" numeric(5, 1),
	"height_cm" numeric(4, 1),
	"entered_in_error" boolean DEFAULT false NOT NULL,
	CONSTRAINT "vital_signs_some_value" CHECK (num_nonnulls("vital_signs"."temp_c", "vital_signs"."pulse", "vital_signs"."bp_sys", "vital_signs"."resp_rate", "vital_signs"."spo2", "vital_signs"."weight_kg", "vital_signs"."height_cm") > 0),
	CONSTRAINT "vital_signs_bp_pair" CHECK (("vital_signs"."bp_sys" IS NULL) = ("vital_signs"."bp_dia" IS NULL)),
	CONSTRAINT "vital_signs_plausible" CHECK (("vital_signs"."temp_c" IS NULL OR "vital_signs"."temp_c" BETWEEN 30 AND 45)
        AND ("vital_signs"."pulse" IS NULL OR "vital_signs"."pulse" BETWEEN 20 AND 250)
        AND ("vital_signs"."bp_sys" IS NULL OR "vital_signs"."bp_sys" BETWEEN 50 AND 260)
        AND ("vital_signs"."bp_dia" IS NULL OR "vital_signs"."bp_dia" BETWEEN 20 AND 160)
        AND ("vital_signs"."resp_rate" IS NULL OR "vital_signs"."resp_rate" BETWEEN 4 AND 80)
        AND ("vital_signs"."spo2" IS NULL OR "vital_signs"."spo2" BETWEEN 50 AND 100)
        AND ("vital_signs"."weight_kg" IS NULL OR "vital_signs"."weight_kg" BETWEEN 0.3 AND 400)
        AND ("vital_signs"."height_cm" IS NULL OR "vital_signs"."height_cm" BETWEEN 20 AND 250))
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_id_patient_doctor_key" UNIQUE("id","patient_id","doctor_id");--> statement-breakpoint
ALTER TABLE "allergies" ADD CONSTRAINT "allergies_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allergies" ADD CONSTRAINT "allergies_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allergies" ADD CONSTRAINT "allergies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allergies" ADD CONSTRAINT "allergies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensing_lines" ADD CONSTRAINT "dispensing_lines_dispensed_product_id_medicine_products_stock_item_id_fk" FOREIGN KEY ("dispensed_product_id") REFERENCES "public"."medicine_products"("stock_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensing_lines" ADD CONSTRAINT "dispensing_lines_stock_movement_id_stock_movements_id_fk" FOREIGN KEY ("stock_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensing_lines" ADD CONSTRAINT "dispensing_lines_dispensing_fk" FOREIGN KEY ("dispensing_id","prescription_id") REFERENCES "public"."dispensings"("id","prescription_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensing_lines" ADD CONSTRAINT "dispensing_lines_item_fk" FOREIGN KEY ("prescription_item_id","prescription_id") REFERENCES "public"."prescription_items"("id","prescription_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensing_lines" ADD CONSTRAINT "dispensing_lines_batch_product_fk" FOREIGN KEY ("batch_id","dispensed_product_id") REFERENCES "public"."stock_batches"("id","stock_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_dispensed_by_users_id_fk" FOREIGN KEY ("dispensed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispensings" ADD CONSTRAINT "dispensings_prescription_fk" FOREIGN KEY ("prescription_id","patient_id") REFERENCES "public"."prescriptions"("id","patient_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_appointment_fk" FOREIGN KEY ("appointment_id","patient_id","doctor_id") REFERENCES "public"."appointments"("id","patient_id","doctor_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patient_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_doctor_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_recommended_by_users_id_fk" FOREIGN KEY ("recommended_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_target_doctor_id_doctor_profiles_id_fk" FOREIGN KEY ("target_doctor_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_encounter_fk" FOREIGN KEY ("source_encounter_id","patient_id") REFERENCES "public"."encounters"("id","patient_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_prescription_id_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_medicine_product_id_medicine_products_stock_item_id_fk" FOREIGN KEY ("medicine_product_id") REFERENCES "public"."medicine_products"("stock_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_doctor_id_doctor_profiles_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_encounter_fk" FOREIGN KEY ("encounter_id","patient_id") REFERENCES "public"."encounters"("id","patient_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vital_signs" ADD CONSTRAINT "vital_signs_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vital_signs" ADD CONSTRAINT "vital_signs_appointment_fk" FOREIGN KEY ("appointment_id","patient_id") REFERENCES "public"."appointments"("id","patient_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allergies_patient_idx" ON "allergies" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "allergies_ingredient_idx" ON "allergies" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "clinical_notes_encounter_idx" ON "clinical_notes" USING btree ("encounter_id","created_at");--> statement-breakpoint
CREATE INDEX "diagnoses_encounter_idx" ON "diagnoses" USING btree ("encounter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "diagnoses_one_primary_key" ON "diagnoses" USING btree ("encounter_id") WHERE "diagnoses"."is_primary";--> statement-breakpoint
CREATE INDEX "dispensing_lines_dispensing_idx" ON "dispensing_lines" USING btree ("dispensing_id");--> statement-breakpoint
CREATE INDEX "dispensings_prescription_idx" ON "dispensings" USING btree ("prescription_id");--> statement-breakpoint
CREATE INDEX "encounters_patient_idx" ON "encounters" USING btree ("patient_id","started_at");--> statement-breakpoint
CREATE INDEX "encounters_doctor_status_idx" ON "encounters" USING btree ("doctor_id","status");--> statement-breakpoint
CREATE INDEX "follow_ups_status_due_idx" ON "follow_ups" USING btree ("status","due_to");--> statement-breakpoint
CREATE INDEX "follow_ups_target_idx" ON "follow_ups" USING btree ("target_doctor_id","status");--> statement-breakpoint
CREATE INDEX "follow_ups_patient_idx" ON "follow_ups" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "prescription_items_prescription_idx" ON "prescription_items" USING btree ("prescription_id");--> statement-breakpoint
CREATE INDEX "prescriptions_status_idx" ON "prescriptions" USING btree ("status","issued_at");--> statement-breakpoint
CREATE INDEX "prescriptions_patient_idx" ON "prescriptions" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "vital_signs_appointment_idx" ON "vital_signs" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "vital_signs_patient_idx" ON "vital_signs" USING btree ("patient_id","recorded_at");