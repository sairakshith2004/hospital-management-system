-- Hand-written migration. Forward-only: never edit it once it has been applied anywhere.
-- Rules Drizzle can't express for the inventory tables (0009): append-only movements,
-- stock that always matches its movement history, updated_at triggers, search indexes
-- and exact hms_app privileges.

-- 1. A generic guard for append-only tables (also used by later migrations).
CREATE FUNCTION prevent_update_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER stock_movements_no_update_delete BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();
--> statement-breakpoint
CREATE TRIGGER stock_movements_no_truncate BEFORE TRUNCATE ON stock_movements
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_update_delete();
--> statement-breakpoint
CREATE TRIGGER goods_receipts_no_update_delete BEFORE UPDATE OR DELETE ON goods_receipts
  FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();
--> statement-breakpoint
CREATE TRIGGER grn_lines_no_update_delete BEFORE UPDATE OR DELETE ON grn_lines
  FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();
--> statement-breakpoint

-- 2. Stock never changes without a movement. At commit, each batch touched in the
-- transaction must hold exactly the balance recorded by its latest movement (0 if none).
-- The current row is re-read, so several movements on one batch in one transaction are fine.
CREATE FUNCTION stock_batches_match_movements() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  on_hand integer;
  recorded integer;
BEGIN
  SELECT qty_on_hand INTO on_hand FROM stock_batches WHERE id = NEW.id;
  SELECT balance_after INTO recorded FROM stock_movements
    WHERE batch_id = NEW.id ORDER BY id DESC LIMIT 1;
  IF on_hand IS DISTINCT FROM coalesce(recorded, 0) THEN
    RAISE EXCEPTION 'stock batch % holds % but its movements record %', NEW.id, on_hand, coalesce(recorded, 0)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER stock_batches_match_movements
  AFTER INSERT OR UPDATE OF qty_on_hand ON stock_batches
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stock_batches_match_movements();
--> statement-breakpoint

-- 3. Keep updated_at current (set_updated_at() is defined in migration 0001).
CREATE TRIGGER locations_set_updated_at BEFORE UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER ingredients_set_updated_at BEFORE UPDATE ON ingredients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER stock_items_set_updated_at BEFORE UPDATE ON stock_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER medicine_products_set_updated_at BEFORE UPDATE ON medicine_products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER stock_batches_set_updated_at BEFORE UPDATE ON stock_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER suppliers_set_updated_at BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER stock_transfers_set_updated_at BEFORE UPDATE ON stock_transfers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- 4. Search: ingredient, brand and item names, partial or fuzzy (pg_trgm, migration 0005).
CREATE INDEX ingredients_name_trgm_idx ON ingredients USING gin ((name::text) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX stock_items_name_trgm_idx ON stock_items USING gin (name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX medicine_products_brand_trgm_idx ON medicine_products USING gin (brand_name gin_trgm_ops);
--> statement-breakpoint

-- 5. hms_app privileges. No DELETE anywhere: items, suppliers and locations are
-- deactivated; movements, receipts and transfers keep their history.
GRANT SELECT, INSERT, UPDATE ON locations, ingredients, stock_items, medicine_products,
  stock_batches, suppliers, stock_transfers, stock_transfer_lines TO hms_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON product_ingredients, stock_movements, goods_receipts, grn_lines TO hms_app;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE grn_no_seq, transfer_no_seq TO hms_app;
