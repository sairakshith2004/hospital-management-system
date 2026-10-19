CREATE SEQUENCE "public"."lab_order_no_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9999999 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "document_counters" (
	"doc_type" text NOT NULL,
	"fiscal_year" integer NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "document_counters_pkey" PRIMARY KEY("doc_type","fiscal_year"),
	CONSTRAINT "document_counters_next_positive" CHECK ("document_counters"."next_value" >= 1)
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"service_id" uuid,
	"description" text NOT NULL,
	"source_type" text NOT NULL,
	"consultation_appointment_id" uuid,
	"dispensing_line_id" uuid,
	"lab_order_id" uuid,
	"qty" integer NOT NULL,
	"unit_price_paise" bigint NOT NULL,
	"line_total_paise" bigint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "invoice_items_id_invoice_key" UNIQUE("id","invoice_id"),
	CONSTRAINT "invoice_items_source_check" CHECK ("invoice_items"."source_type" IN ('consultation', 'dispensing', 'lab', 'manual')),
	CONSTRAINT "invoice_items_qty_positive" CHECK ("invoice_items"."qty" > 0),
	CONSTRAINT "invoice_items_price_non_negative" CHECK ("invoice_items"."unit_price_paise" >= 0),
	CONSTRAINT "invoice_items_line_arithmetic" CHECK ("invoice_items"."line_total_paise" = "invoice_items"."qty" * "invoice_items"."unit_price_paise"),
	CONSTRAINT "invoice_items_typed_source" CHECK (CASE "invoice_items"."source_type"
        WHEN 'consultation' THEN "invoice_items"."consultation_appointment_id" IS NOT NULL AND "invoice_items"."dispensing_line_id" IS NULL AND "invoice_items"."lab_order_id" IS NULL
        WHEN 'dispensing' THEN "invoice_items"."dispensing_line_id" IS NOT NULL AND "invoice_items"."consultation_appointment_id" IS NULL AND "invoice_items"."lab_order_id" IS NULL
        WHEN 'lab' THEN "invoice_items"."lab_order_id" IS NOT NULL AND "invoice_items"."consultation_appointment_id" IS NULL AND "invoice_items"."dispensing_line_id" IS NULL
        ELSE "invoice_items"."lab_order_id" IS NULL AND "invoice_items"."consultation_appointment_id" IS NULL AND "invoice_items"."dispensing_line_id" IS NULL
      END)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_no" text,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"subtotal_paise" bigint DEFAULT 0 NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"tax_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint DEFAULT 0 NOT NULL,
	"paid_paise" bigint DEFAULT 0 NOT NULL,
	"issued_at" timestamp with time zone,
	"issued_by" uuid,
	"void_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "invoices_invoice_no_key" UNIQUE("invoice_no"),
	CONSTRAINT "invoices_id_patient_key" UNIQUE("id","patient_id"),
	CONSTRAINT "invoices_status_check" CHECK ("invoices"."status" IN ('draft', 'issued', 'partially_paid', 'paid', 'void')),
	CONSTRAINT "invoices_total_arithmetic" CHECK ("invoices"."total_paise" = "invoices"."subtotal_paise" - "invoices"."discount_paise" + "invoices"."tax_paise"),
	CONSTRAINT "invoices_amounts_non_negative" CHECK ("invoices"."subtotal_paise" >= 0 AND "invoices"."discount_paise" >= 0 AND "invoices"."tax_paise" >= 0 AND "invoices"."total_paise" >= 0),
	CONSTRAINT "invoices_paid_range" CHECK ("invoices"."paid_paise" BETWEEN 0 AND "invoices"."total_paise"),
	CONSTRAINT "invoices_number_when_issued" CHECK (("invoices"."status" = 'draft') = ("invoices"."invoice_no" IS NULL)),
	CONSTRAINT "invoices_issued_fields" CHECK (("invoices"."status" = 'draft') = ("invoices"."issued_at" IS NULL)),
	CONSTRAINT "invoices_paid_matches_status" CHECK ("invoices"."status" NOT IN ('draft', 'void') OR "invoices"."paid_paise" = 0),
	CONSTRAINT "invoices_void_reason" CHECK ("invoices"."status" <> 'void' OR length(trim(coalesce("invoices"."void_reason", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "lab_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_no" text DEFAULT ('LAB' || lpad(nextval('lab_order_no_seq')::text, 7, '0')) NOT NULL,
	"encounter_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"test_id" uuid NOT NULL,
	"ordered_by" uuid NOT NULL,
	"priority" text DEFAULT 'routine' NOT NULL,
	"status" text DEFAULT 'ordered' NOT NULL,
	"clinical_notes" text,
	"sample_barcode" text,
	"collected_by" uuid,
	"collected_at" timestamp with time zone,
	"resulted_by" uuid,
	"resulted_at" timestamp with time zone,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "lab_orders_order_no_key" UNIQUE("order_no"),
	CONSTRAINT "lab_orders_sample_barcode_key" UNIQUE("sample_barcode"),
	CONSTRAINT "lab_orders_id_test_key" UNIQUE("id","test_id"),
	CONSTRAINT "lab_orders_status_check" CHECK ("lab_orders"."status" IN ('ordered', 'collected', 'resulted', 'verified', 'cancelled')),
	CONSTRAINT "lab_orders_priority_check" CHECK ("lab_orders"."priority" IN ('routine', 'urgent')),
	CONSTRAINT "lab_orders_verifier_not_enterer" CHECK ("lab_orders"."verified_by" IS NULL OR "lab_orders"."verified_by" <> "lab_orders"."resulted_by"),
	CONSTRAINT "lab_orders_fields_match_status" CHECK (("lab_orders"."status" IN ('collected', 'resulted', 'verified')) <= ("lab_orders"."collected_at" IS NOT NULL)
        AND ("lab_orders"."status" IN ('resulted', 'verified')) <= ("lab_orders"."resulted_at" IS NOT NULL)
        AND ("lab_orders"."status" = 'verified') = ("lab_orders"."verified_at" IS NOT NULL)
        AND ("lab_orders"."status" = 'cancelled') = ("lab_orders"."cancelled_at" IS NOT NULL)
        AND ("lab_orders"."status" <> 'cancelled' OR length(trim(coalesce("lab_orders"."cancel_reason", ''))) > 0))
);
--> statement-breakpoint
CREATE TABLE "lab_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"test_id" uuid NOT NULL,
	"parameter_id" uuid NOT NULL,
	"value_num" numeric(14, 4),
	"value_text" text,
	"unit" text,
	"ref_low" numeric(12, 4),
	"ref_high" numeric(12, 4),
	"ref_text" text,
	"abnormal_flag" text,
	"entered_by" uuid NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	CONSTRAINT "lab_results_has_value" CHECK ("lab_results"."value_num" IS NOT NULL OR length(trim(coalesce("lab_results"."value_text", ''))) > 0),
	CONSTRAINT "lab_results_flag_check" CHECK ("lab_results"."abnormal_flag" IS NULL OR "lab_results"."abnormal_flag" IN ('low', 'normal', 'high'))
);
--> statement-breakpoint
CREATE TABLE "lab_test_parameters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit" text,
	"ref_low" numeric(12, 4),
	"ref_high" numeric(12, 4),
	"ref_text" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "lab_test_parameters_test_name_key" UNIQUE("test_id","name"),
	CONSTRAINT "lab_test_parameters_id_test_key" UNIQUE("id","test_id"),
	CONSTRAINT "lab_test_parameters_ref_order" CHECK ("lab_test_parameters"."ref_low" IS NULL OR "lab_test_parameters"."ref_high" IS NULL OR "lab_test_parameters"."ref_low" <= "lab_test_parameters"."ref_high")
);
--> statement-breakpoint
CREATE TABLE "lab_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sample_type" text NOT NULL,
	"service_id" uuid NOT NULL,
	"turnaround_hours" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "lab_tests_code_key" UNIQUE("code"),
	CONSTRAINT "lab_tests_service_id_key" UNIQUE("service_id"),
	CONSTRAINT "lab_tests_turnaround" CHECK ("lab_tests"."turnaround_hours" BETWEEN 1 AND 720)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_no" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"idempotency_key" text NOT NULL,
	"received_by" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_receipt_no_key" UNIQUE("receipt_no"),
	CONSTRAINT "payments_idempotency_key_key" UNIQUE("idempotency_key"),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_paise" > 0),
	CONSTRAINT "payments_method_check" CHECK ("payments"."method" IN ('cash', 'card', 'upi', 'bank'))
);
--> statement-breakpoint
CREATE TABLE "service_catalogue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"department_id" uuid,
	"kind" text NOT NULL,
	"price_paise" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "service_catalogue_code_key" UNIQUE("code"),
	CONSTRAINT "service_catalogue_kind_check" CHECK ("service_catalogue"."kind" IN ('consultation', 'lab', 'procedure', 'other')),
	CONSTRAINT "service_catalogue_price_non_negative" CHECK ("service_catalogue"."price_paise" >= 0)
);
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_service_id_service_catalogue_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_catalogue"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_consultation_appointment_id_appointments_id_fk" FOREIGN KEY ("consultation_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_dispensing_line_id_dispensing_lines_id_fk" FOREIGN KEY ("dispensing_line_id") REFERENCES "public"."dispensing_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_lab_order_id_lab_orders_id_fk" FOREIGN KEY ("lab_order_id") REFERENCES "public"."lab_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_appointment_fk" FOREIGN KEY ("appointment_id","patient_id") REFERENCES "public"."appointments"("id","patient_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_test_id_lab_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."lab_tests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_ordered_by_users_id_fk" FOREIGN KEY ("ordered_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_collected_by_users_id_fk" FOREIGN KEY ("collected_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_resulted_by_users_id_fk" FOREIGN KEY ("resulted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_encounter_fk" FOREIGN KEY ("encounter_id","patient_id") REFERENCES "public"."encounters"("id","patient_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_order_fk" FOREIGN KEY ("order_id","test_id") REFERENCES "public"."lab_orders"("id","test_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_parameter_fk" FOREIGN KEY ("parameter_id","test_id") REFERENCES "public"."lab_test_parameters"("id","test_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_test_parameters" ADD CONSTRAINT "lab_test_parameters_test_id_lab_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."lab_tests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_service_id_service_catalogue_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_catalogue"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_catalogue" ADD CONSTRAINT "service_catalogue_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_catalogue" ADD CONSTRAINT "service_catalogue_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_catalogue" ADD CONSTRAINT "service_catalogue_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_items_invoice_idx" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_items_consultation_active_key" ON "invoice_items" USING btree ("consultation_appointment_id") WHERE "invoice_items"."is_active" AND "invoice_items"."consultation_appointment_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_items_dispensing_active_key" ON "invoice_items" USING btree ("dispensing_line_id") WHERE "invoice_items"."is_active" AND "invoice_items"."dispensing_line_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_items_lab_active_key" ON "invoice_items" USING btree ("lab_order_id") WHERE "invoice_items"."is_active" AND "invoice_items"."lab_order_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_one_draft_per_visit_key" ON "invoices" USING btree ("appointment_id") WHERE "invoices"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "invoices_patient_idx" ON "invoices" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "lab_orders_status_idx" ON "lab_orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "lab_orders_patient_idx" ON "lab_orders" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_results_current_key" ON "lab_results" USING btree ("order_id","parameter_id") WHERE "lab_results"."is_current";--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_received_idx" ON "payments" USING btree ("received_at");