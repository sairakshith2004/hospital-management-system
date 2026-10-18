-- Hand-written migration. Forward-only: never edit it once it has been applied anywhere.
-- Rules Drizzle can't express for the clinical tables (0011). Clinical records are never
-- deleted; once an encounter is completed its notes and diagnoses are frozen and
-- corrections become addenda.

-- 1. Encounters only move forward, and never change patient, doctor or visit.
CREATE FUNCTION encounters_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'in_progress' THEN
      RAISE EXCEPTION 'encounters start in_progress' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.appointment_id <> OLD.appointment_id OR NEW.patient_id <> OLD.patient_id
     OR NEW.doctor_id <> OLD.doctor_id OR NEW.encounter_no <> OLD.encounter_no THEN
    RAISE EXCEPTION 'an encounter''s visit, patient, doctor and number cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'completed' THEN
    RAISE EXCEPTION 'a completed encounter cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER encounters_enforce BEFORE INSERT OR UPDATE ON encounters
  FOR EACH ROW EXECUTE FUNCTION encounters_enforce();
--> statement-breakpoint

-- 2. Notes are append-only; after completion only addenda may be added.
CREATE FUNCTION clinical_notes_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind <> 'addendum'
     AND (SELECT status FROM encounters WHERE id = NEW.encounter_id) <> 'in_progress' THEN
    RAISE EXCEPTION 'the encounter is completed: add an addendum instead'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER clinical_notes_enforce BEFORE INSERT ON clinical_notes
  FOR EACH ROW EXECUTE FUNCTION clinical_notes_enforce();
--> statement-breakpoint
CREATE TRIGGER clinical_notes_no_update_delete BEFORE UPDATE OR DELETE ON clinical_notes
  FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();
--> statement-breakpoint

-- 3. Diagnoses change only while their encounter is in progress, and are never deleted.
CREATE FUNCTION diagnoses_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT status FROM encounters WHERE id = NEW.encounter_id) <> 'in_progress' THEN
    RAISE EXCEPTION 'diagnoses of a completed encounter cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.encounter_id <> OLD.encounter_id THEN
    RAISE EXCEPTION 'a diagnosis cannot move to another encounter' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER diagnoses_enforce BEFORE INSERT OR UPDATE ON diagnoses
  FOR EACH ROW EXECUTE FUNCTION diagnoses_enforce();
--> statement-breakpoint

-- 4. A reading is never edited: it can only be flagged as entered in error, once.
CREATE FUNCTION vital_signs_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'entered_in_error') <> (to_jsonb(OLD) - 'entered_in_error')
     OR (OLD.entered_in_error AND NOT NEW.entered_in_error) THEN
    RAISE EXCEPTION 'vital signs can only be flagged as entered in error'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER vital_signs_enforce BEFORE UPDATE ON vital_signs
  FOR EACH ROW EXECUTE FUNCTION vital_signs_enforce();
--> statement-breakpoint

-- 5. A prescription item's medicine and quantity never change; dispensing only adds.
CREATE FUNCTION prescription_items_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'qty_dispensed' - 'updated_at') <> (to_jsonb(OLD) - 'qty_dispensed' - 'updated_at')
     OR NEW.qty_dispensed < OLD.qty_dispensed THEN
    RAISE EXCEPTION 'a prescription item can only record more dispensed quantity'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER prescription_items_enforce BEFORE UPDATE ON prescription_items
  FOR EACH ROW EXECUTE FUNCTION prescription_items_enforce();
--> statement-breakpoint

-- 6. Prescription status machine.
CREATE FUNCTION prescriptions_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'issued' THEN
      RAISE EXCEPTION 'prescriptions start issued' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.patient_id <> OLD.patient_id OR NEW.encounter_id <> OLD.encounter_id
     OR NEW.doctor_id <> OLD.doctor_id OR NEW.rx_no <> OLD.rx_no THEN
    RAISE EXCEPTION 'a prescription''s patient, encounter, doctor and number cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'issued' AND NEW.status IN ('partially_dispensed', 'dispensed', 'cancelled', 'closed'))
    OR (OLD.status = 'partially_dispensed' AND NEW.status IN ('partially_dispensed', 'dispensed', 'closed'))
  ) THEN
    RAISE EXCEPTION 'invalid prescription status change: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER prescriptions_enforce BEFORE INSERT OR UPDATE ON prescriptions
  FOR EACH ROW EXECUTE FUNCTION prescriptions_enforce();
--> statement-breakpoint

-- 7. Dispensing records are never edited.
CREATE TRIGGER dispensings_no_update_delete BEFORE UPDATE OR DELETE ON dispensings
  FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();
--> statement-breakpoint
CREATE TRIGGER dispensing_lines_no_update_delete BEFORE UPDATE OR DELETE ON dispensing_lines
  FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();
--> statement-breakpoint

-- 8. Keep updated_at current (set_updated_at() is defined in migration 0001).
CREATE TRIGGER encounters_set_updated_at BEFORE UPDATE ON encounters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER allergies_set_updated_at BEFORE UPDATE ON allergies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER follow_ups_set_updated_at BEFORE UPDATE ON follow_ups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER prescriptions_set_updated_at BEFORE UPDATE ON prescriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER prescription_items_set_updated_at BEFORE UPDATE ON prescription_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- 9. hms_app privileges. No DELETE: clinical records are kept.
GRANT SELECT, INSERT, UPDATE ON encounters, diagnoses, allergies, follow_ups, prescriptions,
  prescription_items TO hms_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON vital_signs, clinical_notes, dispensings, dispensing_lines TO hms_app;
--> statement-breakpoint
GRANT UPDATE (entered_in_error) ON vital_signs TO hms_app;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE encounter_no_seq, rx_no_seq, dispense_no_seq TO hms_app;
