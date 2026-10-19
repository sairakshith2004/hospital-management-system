-- Hand-written migration. Forward-only: never edit it once it has been applied anywhere.

-- 1. Keep updated_at current (set_updated_at() is defined in migration 0001).
CREATE TRIGGER patients_set_updated_at BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER doctor_profiles_set_updated_at BEFORE UPDATE ON doctor_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- 2. Fast fuzzy and partial name search (pg_trgm is installed by the Docker init script).
-- The API's search uses exactly this expression, so the index applies.
CREATE INDEX patients_full_name_trgm_idx ON patients
  USING gin ((first_name || ' ' || last_name) gin_trgm_ops);
--> statement-breakpoint

-- 3. hms_app privileges. No DELETE: patients and doctors are never hard-deleted (ADR 0011).
GRANT SELECT, INSERT, UPDATE ON patients, doctor_profiles TO hms_app;
--> statement-breakpoint
-- nextval() for the MRN column default.
GRANT USAGE ON SEQUENCE patient_mrn_seq TO hms_app;
