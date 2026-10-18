-- Hand-written migration. Forward-only: never edit it once it has been applied anywhere.
-- Rules Drizzle can't express for the laboratory and billing tables (0013).

-- 1. Lab order status machine. Verified results are final.
CREATE FUNCTION lab_orders_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'ordered' THEN
      RAISE EXCEPTION 'lab orders start as ordered' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.patient_id <> OLD.patient_id OR NEW.encounter_id <> OLD.encounter_id
     OR NEW.test_id <> OLD.test_id OR NEW.order_no <> OLD.order_no THEN
    RAISE EXCEPTION 'a lab order''s patient, encounter, test and number cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'ordered' AND NEW.status IN ('collected', 'cancelled'))
    OR (OLD.status = 'collected' AND NEW.status IN ('resulted', 'cancelled'))
    OR (OLD.status = 'resulted' AND NEW.status = 'verified')
  ) THEN
    RAISE EXCEPTION 'invalid lab order status change: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('verified', 'cancelled') THEN
    RAISE EXCEPTION 'a % lab order cannot change', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER lab_orders_enforce BEFORE INSERT OR UPDATE ON lab_orders
  FOR EACH ROW EXECUTE FUNCTION lab_orders_enforce();
--> statement-breakpoint

-- 2. A result value is never edited: a correction inserts a new current row and marks
-- the old one not current. Nothing changes once the order is verified.
CREATE FUNCTION lab_results_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT status FROM lab_orders WHERE id = NEW.order_id) NOT IN ('collected', 'resulted') THEN
    RAISE EXCEPTION 'results can only be entered for a collected or resulted order'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (
       (to_jsonb(NEW) - 'is_current') <> (to_jsonb(OLD) - 'is_current')
       OR NEW.is_current OR NOT OLD.is_current) THEN
    RAISE EXCEPTION 'a lab result can only be superseded' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER lab_results_enforce BEFORE INSERT OR UPDATE ON lab_results
  FOR EACH ROW EXECUTE FUNCTION lab_results_enforce();
--> statement-breakpoint

-- 3. Invoice status machine; patient and visit never change.
CREATE FUNCTION invoices_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'invoices start as drafts' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.patient_id <> OLD.patient_id OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id
     OR (OLD.invoice_no IS NOT NULL AND NEW.invoice_no IS DISTINCT FROM OLD.invoice_no) THEN
    RAISE EXCEPTION 'an invoice''s patient, visit and number cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'draft' AND (NEW.subtotal_paise <> OLD.subtotal_paise
     OR NEW.discount_paise <> OLD.discount_paise OR NEW.tax_paise <> OLD.tax_paise) THEN
    RAISE EXCEPTION 'an issued invoice''s amounts cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'draft' AND NEW.status IN ('issued', 'void'))
    OR (OLD.status = 'issued' AND NEW.status IN ('partially_paid', 'paid', 'void'))
    OR (OLD.status = 'partially_paid' AND NEW.status = 'paid')
  ) THEN
    RAISE EXCEPTION 'invalid invoice status change: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('paid', 'void') AND to_jsonb(NEW) - 'updated_at' <> to_jsonb(OLD) - 'updated_at' THEN
    RAISE EXCEPTION 'a % invoice cannot change', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER invoices_enforce BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_enforce();
--> statement-breakpoint

-- 4. Lines are added or deactivated only on a draft invoice; nothing else about them changes.
CREATE FUNCTION invoice_items_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT status FROM invoices WHERE id = NEW.invoice_id) <> 'draft' THEN
    RAISE EXCEPTION 'only a draft invoice''s lines can change' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND ((to_jsonb(NEW) - 'is_active') <> (to_jsonb(OLD) - 'is_active')
     OR NEW.is_active OR NOT OLD.is_active) THEN
    RAISE EXCEPTION 'an invoice line can only be deactivated' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER invoice_items_enforce BEFORE INSERT OR UPDATE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION invoice_items_enforce();
--> statement-breakpoint

-- 5. At commit, every touched invoice's totals equal its active lines and payments.
CREATE FUNCTION invoices_match_lines() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  inv invoices%ROWTYPE;
  lines bigint;
  paid bigint;
BEGIN
  SELECT * INTO inv FROM invoices WHERE id = NEW.id;
  SELECT coalesce(sum(line_total_paise), 0) INTO lines FROM invoice_items
    WHERE invoice_id = NEW.id AND is_active;
  SELECT coalesce(sum(amount_paise), 0) INTO paid FROM payments WHERE invoice_id = NEW.id;
  IF inv.subtotal_paise <> lines OR inv.paid_paise <> paid THEN
    RAISE EXCEPTION 'invoice % totals do not match its lines and payments', inv.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER invoices_match_lines AFTER INSERT OR UPDATE ON invoices
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION invoices_match_lines();
--> statement-breakpoint

-- 6. Payments and document counters.
CREATE TRIGGER payments_no_update_delete BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();
--> statement-breakpoint

-- 7. Keep updated_at current (set_updated_at() is defined in migration 0001).
CREATE TRIGGER service_catalogue_set_updated_at BEFORE UPDATE ON service_catalogue
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER lab_tests_set_updated_at BEFORE UPDATE ON lab_tests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER lab_orders_set_updated_at BEFORE UPDATE ON lab_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER invoices_set_updated_at BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- 8. hms_app privileges. No DELETE: prices are deactivated, orders cancelled, invoices voided.
GRANT SELECT, INSERT, UPDATE ON service_catalogue, lab_tests, lab_test_parameters, lab_orders,
  document_counters, invoices, invoice_items TO hms_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON lab_results, payments TO hms_app;
--> statement-breakpoint
GRANT UPDATE (is_current) ON lab_results TO hms_app;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE lab_order_no_seq TO hms_app;
