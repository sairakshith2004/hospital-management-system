-- Hand-written migration. Forward-only: never edit it once it has been applied anywhere.
-- Triggers and exact hms_app privileges for the HR, finance, equipment and marketing
-- tables (0015).

-- 1. Maintenance logs are append-only; enquiry follow-ups only change their done flag.
CREATE TRIGGER maintenance_logs_no_update_delete BEFORE UPDATE OR DELETE ON maintenance_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();
--> statement-breakpoint
CREATE FUNCTION enquiry_follow_ups_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'done') <> (to_jsonb(OLD) - 'done') THEN
    RAISE EXCEPTION 'an enquiry follow-up can only be marked done' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER enquiry_follow_ups_enforce BEFORE UPDATE ON enquiry_follow_ups
  FOR EACH ROW EXECUTE FUNCTION enquiry_follow_ups_enforce();
--> statement-breakpoint

-- 2. Decided leave and expenses are final.
CREATE FUNCTION decided_rows_final() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('approved', 'rejected', 'cancelled')
     AND to_jsonb(NEW) - 'updated_at' <> to_jsonb(OLD) - 'updated_at' THEN
    RAISE EXCEPTION 'a decided % cannot change', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER leave_requests_final BEFORE UPDATE ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION decided_rows_final();
--> statement-breakpoint
CREATE TRIGGER expenses_final BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION decided_rows_final();
--> statement-breakpoint

-- 3. Keep updated_at current (set_updated_at() is defined in migration 0001).
CREATE TRIGGER attendance_set_updated_at BEFORE UPDATE ON attendance
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER leave_requests_set_updated_at BEFORE UPDATE ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER expense_categories_set_updated_at BEFORE UPDATE ON expense_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER expenses_set_updated_at BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER equipment_set_updated_at BEFORE UPDATE ON equipment
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER referral_sources_set_updated_at BEFORE UPDATE ON referral_sources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER campaigns_set_updated_at BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER enquiries_set_updated_at BEFORE UPDATE ON enquiries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- 4. hms_app privileges. No DELETE.
GRANT SELECT, INSERT, UPDATE ON attendance, leave_requests, expense_categories, expenses,
  equipment, referral_sources, campaigns, enquiries, enquiry_follow_ups TO hms_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON maintenance_logs TO hms_app;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE expense_no_seq, enquiry_no_seq TO hms_app;
