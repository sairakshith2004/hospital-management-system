CREATE SEQUENCE "public"."grn_no_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9999999 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."transfer_no_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9999999 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grn_no" text DEFAULT ('GRN' || lpad(nextval('grn_no_seq')::text, 7, '0')) NOT NULL,
	"supplier_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"location_kind" text DEFAULT 'store' NOT NULL,
	"supplier_invoice_ref" text,
	"received_by" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipts_grn_no_key" UNIQUE("grn_no"),
	CONSTRAINT "goods_receipts_store_only" CHECK ("goods_receipts"."location_kind" = 'store')
);
--> statement-breakpoint
CREATE TABLE "grn_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grn_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"batch_no" text NOT NULL,
	"expiry_date" date,
	"qty" integer NOT NULL,
	"unit_cost_paise" bigint NOT NULL,
	"batch_id" uuid NOT NULL,
	"stock_movement_id" bigint NOT NULL,
	CONSTRAINT "grn_lines_stock_movement_id_key" UNIQUE("stock_movement_id"),
	CONSTRAINT "grn_lines_qty_positive" CHECK ("grn_lines"."qty" > 0),
	CONSTRAINT "grn_lines_cost_non_negative" CHECK ("grn_lines"."unit_cost_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" "citext" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "ingredients_name_key" UNIQUE("name"),
	CONSTRAINT "ingredients_name_not_blank" CHECK (length(trim("ingredients"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "locations_code_key" UNIQUE("code"),
	CONSTRAINT "locations_id_kind_key" UNIQUE("id","kind"),
	CONSTRAINT "locations_kind_check" CHECK ("locations"."kind" IN ('pharmacy', 'store', 'lab', 'opd_room')),
	CONSTRAINT "locations_code_format" CHECK ("locations"."code" ~ '^[A-Z][A-Z0-9_-]{1,19}$')
);
--> statement-breakpoint
CREATE TABLE "medicine_products" (
	"stock_item_id" uuid PRIMARY KEY NOT NULL,
	"brand_name" text NOT NULL,
	"manufacturer" text,
	"dosage_form" text NOT NULL,
	"route" text NOT NULL,
	"pack_size" text,
	"rx_only" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "medicine_products_dosage_form_check" CHECK ("medicine_products"."dosage_form" IN ('tablet', 'capsule', 'syrup', 'suspension', 'injection', 'ointment', 'cream', 'drops', 'inhaler', 'powder', 'gel', 'solution')),
	CONSTRAINT "medicine_products_route_check" CHECK ("medicine_products"."route" IN ('oral', 'topical', 'iv', 'im', 'sc', 'inhalation', 'ophthalmic', 'otic', 'nasal'))
);
--> statement-breakpoint
CREATE TABLE "product_ingredients" (
	"product_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"strength_value" numeric(12, 4) NOT NULL,
	"strength_unit" text NOT NULL,
	CONSTRAINT "product_ingredients_pkey" PRIMARY KEY("product_id","ingredient_id"),
	CONSTRAINT "product_ingredients_strength_positive" CHECK ("product_ingredients"."strength_value" > 0),
	CONSTRAINT "product_ingredients_unit_check" CHECK ("product_ingredients"."strength_unit" IN ('mg', 'g', 'mcg', 'ml', 'IU', '%', 'mg/ml', 'mg/5ml'))
);
--> statement-breakpoint
CREATE TABLE "stock_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"batch_no" text NOT NULL,
	"expiry_date" date,
	"unit_cost_paise" bigint DEFAULT 0 NOT NULL,
	"sale_price_paise" bigint DEFAULT 0 NOT NULL,
	"qty_on_hand" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "stock_batches_item_location_batch_key" UNIQUE("stock_item_id","location_id","batch_no"),
	CONSTRAINT "stock_batches_id_item_key" UNIQUE("id","stock_item_id"),
	CONSTRAINT "stock_batches_id_location_key" UNIQUE("id","location_id"),
	CONSTRAINT "stock_batches_qty_non_negative" CHECK ("stock_batches"."qty_on_hand" >= 0),
	CONSTRAINT "stock_batches_prices_non_negative" CHECK ("stock_batches"."unit_cost_paise" >= 0 AND "stock_batches"."sale_price_paise" >= 0),
	CONSTRAINT "stock_batches_status_check" CHECK ("stock_batches"."status" IN ('active', 'quarantined', 'recalled')),
	CONSTRAINT "stock_batches_batch_no_not_blank" CHECK (length(trim("stock_batches"."batch_no")) > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"base_unit" text NOT NULL,
	"category" text,
	"reorder_level" integer DEFAULT 0 NOT NULL,
	"tracks_expiry" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "stock_items_sku_key" UNIQUE("sku"),
	CONSTRAINT "stock_items_kind_check" CHECK ("stock_items"."kind" IN ('medicine', 'general')),
	CONSTRAINT "stock_items_reorder_level" CHECK ("stock_items"."reorder_level" >= 0),
	CONSTRAINT "stock_items_medicine_tracks_expiry" CHECK ("stock_items"."kind" <> 'medicine' OR "stock_items"."tracks_expiry")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_movements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"batch_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"qty" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reason" text,
	"ref_type" text,
	"ref_id" text,
	"performed_by" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_id_batch_key" UNIQUE("id","batch_id"),
	CONSTRAINT "stock_movements_kind_check" CHECK ("stock_movements"."kind" IN ('receipt', 'dispense', 'adjustment_in', 'adjustment_out', 'damage', 'expiry_writeoff', 'transfer_out', 'transfer_in', 'transfer_return')),
	CONSTRAINT "stock_movements_qty_non_zero" CHECK ("stock_movements"."qty" <> 0),
	CONSTRAINT "stock_movements_balance_non_negative" CHECK ("stock_movements"."balance_after" >= 0),
	CONSTRAINT "stock_movements_sign_matches_kind" CHECK (("stock_movements"."kind" IN ('receipt', 'adjustment_in', 'transfer_in', 'transfer_return')) = ("stock_movements"."qty" > 0)),
	CONSTRAINT "stock_movements_adjustment_reason" CHECK ("stock_movements"."kind" NOT IN ('adjustment_in', 'adjustment_out', 'damage', 'expiry_writeoff') OR length(trim(coalesce("stock_movements"."reason", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_transfer_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"from_location_id" uuid NOT NULL,
	"to_location_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"from_batch_id" uuid NOT NULL,
	"to_batch_id" uuid,
	"qty" integer NOT NULL,
	"out_movement_id" bigint NOT NULL,
	"in_movement_id" bigint,
	"return_movement_id" bigint,
	CONSTRAINT "stock_transfer_lines_out_movement_key" UNIQUE("out_movement_id"),
	CONSTRAINT "stock_transfer_lines_in_movement_key" UNIQUE("in_movement_id"),
	CONSTRAINT "stock_transfer_lines_return_movement_key" UNIQUE("return_movement_id"),
	CONSTRAINT "stock_transfer_lines_qty_positive" CHECK ("stock_transfer_lines"."qty" > 0),
	CONSTRAINT "stock_transfer_lines_in_or_return" CHECK (num_nonnulls("stock_transfer_lines"."in_movement_id", "stock_transfer_lines"."return_movement_id") <= 1),
	CONSTRAINT "stock_transfer_lines_in_has_batch" CHECK (("stock_transfer_lines"."in_movement_id" IS NULL) = ("stock_transfer_lines"."to_batch_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "stock_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_no" text DEFAULT ('TRF' || lpad(nextval('transfer_no_seq')::text, 7, '0')) NOT NULL,
	"from_location_id" uuid NOT NULL,
	"to_location_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'dispatched' NOT NULL,
	"dispatched_by" uuid NOT NULL,
	"dispatched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" uuid,
	"received_at" timestamp with time zone,
	"rejected_by" uuid,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transfers_transfer_no_key" UNIQUE("transfer_no"),
	CONSTRAINT "stock_transfers_id_locations_key" UNIQUE("id","from_location_id","to_location_id"),
	CONSTRAINT "stock_transfers_status_check" CHECK ("stock_transfers"."status" IN ('dispatched', 'received', 'rejected')),
	CONSTRAINT "stock_transfers_distinct_locations" CHECK ("stock_transfers"."from_location_id" <> "stock_transfers"."to_location_id"),
	CONSTRAINT "stock_transfers_reason_not_blank" CHECK (length(trim("stock_transfers"."reason")) > 0),
	CONSTRAINT "stock_transfers_receiver_not_dispatcher" CHECK ("stock_transfers"."received_by" IS NULL OR "stock_transfers"."received_by" <> "stock_transfers"."dispatched_by"),
	CONSTRAINT "stock_transfers_rejecter_not_dispatcher" CHECK ("stock_transfers"."rejected_by" IS NULL OR "stock_transfers"."rejected_by" <> "stock_transfers"."dispatched_by"),
	CONSTRAINT "stock_transfers_fields_match_status" CHECK (CASE "stock_transfers"."status"
        WHEN 'dispatched' THEN "stock_transfers"."received_by" IS NULL AND "stock_transfers"."rejected_by" IS NULL
        WHEN 'received' THEN "stock_transfers"."received_by" IS NOT NULL AND "stock_transfers"."received_at" IS NOT NULL AND "stock_transfers"."rejected_by" IS NULL
        WHEN 'rejected' THEN "stock_transfers"."rejected_by" IS NOT NULL AND "stock_transfers"."rejected_at" IS NOT NULL AND "stock_transfers"."received_by" IS NULL
          AND length(trim(coalesce("stock_transfers"."rejection_reason", ''))) > 0
      END)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"gstin" text,
	"phone" text,
	"email" "citext",
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "suppliers_code_key" UNIQUE("code"),
	CONSTRAINT "suppliers_name_not_blank" CHECK (length(trim("suppliers"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_store_location_fk" FOREIGN KEY ("location_id","location_kind") REFERENCES "public"."locations"("id","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_grn_id_goods_receipts_id_fk" FOREIGN KEY ("grn_id") REFERENCES "public"."goods_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_stock_movement_id_stock_movements_id_fk" FOREIGN KEY ("stock_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_batch_item_fk" FOREIGN KEY ("batch_id","stock_item_id") REFERENCES "public"."stock_batches"("id","stock_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medicine_products" ADD CONSTRAINT "medicine_products_stock_item_id_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medicine_products" ADD CONSTRAINT "medicine_products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medicine_products" ADD CONSTRAINT "medicine_products_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_product_id_medicine_products_stock_item_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."medicine_products"("stock_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_stock_item_id_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batch_location_fk" FOREIGN KEY ("batch_id","location_id") REFERENCES "public"."stock_batches"("id","location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transfer_fk" FOREIGN KEY ("transfer_id","from_location_id","to_location_id") REFERENCES "public"."stock_transfers"("id","from_location_id","to_location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_from_batch_location_fk" FOREIGN KEY ("from_batch_id","from_location_id") REFERENCES "public"."stock_batches"("id","location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_from_batch_item_fk" FOREIGN KEY ("from_batch_id","stock_item_id") REFERENCES "public"."stock_batches"("id","stock_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_to_batch_location_fk" FOREIGN KEY ("to_batch_id","to_location_id") REFERENCES "public"."stock_batches"("id","location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_to_batch_item_fk" FOREIGN KEY ("to_batch_id","stock_item_id") REFERENCES "public"."stock_batches"("id","stock_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_out_movement_fk" FOREIGN KEY ("out_movement_id","from_batch_id") REFERENCES "public"."stock_movements"("id","batch_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_in_movement_fk" FOREIGN KEY ("in_movement_id","to_batch_id") REFERENCES "public"."stock_movements"("id","batch_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_return_movement_fk" FOREIGN KEY ("return_movement_id","from_batch_id") REFERENCES "public"."stock_movements"("id","batch_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_dispatched_by_users_id_fk" FOREIGN KEY ("dispatched_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goods_receipts_supplier_idx" ON "goods_receipts" USING btree ("supplier_id","received_at");--> statement-breakpoint
CREATE INDEX "grn_lines_grn_idx" ON "grn_lines" USING btree ("grn_id");--> statement-breakpoint
CREATE INDEX "product_ingredients_ingredient_idx" ON "product_ingredients" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "stock_batches_item_location_expiry_idx" ON "stock_batches" USING btree ("stock_item_id","location_id","expiry_date");--> statement-breakpoint
CREATE INDEX "stock_movements_batch_idx" ON "stock_movements" USING btree ("batch_id","occurred_at");--> statement-breakpoint
CREATE INDEX "stock_movements_location_idx" ON "stock_movements" USING btree ("location_id","occurred_at");--> statement-breakpoint
CREATE INDEX "stock_movements_ref_idx" ON "stock_movements" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "stock_transfer_lines_transfer_idx" ON "stock_transfer_lines" USING btree ("transfer_id");--> statement-breakpoint
CREATE INDEX "stock_transfers_status_idx" ON "stock_transfers" USING btree ("status","dispatched_at");