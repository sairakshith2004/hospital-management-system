-- Hand-written migration. Forward-only: never edit it once it has been applied anywhere.
-- Rules Drizzle can't express: overlap exclusions, the appointment status machine, and
-- hms_app privileges. btree_gist (needed for "=" inside a GiST exclusion) is installed
-- by the Docker init script.

-- 1. No double booking. While an appointment is active, no other active appointment of the
-- same doctor may overlap its time, whatever the slot length. PostgreSQL enforces this
-- under concurrent transactions: the second insert waits, then fails with 23P01.
ALTER TABLE appointments ADD CONSTRAINT appointments_no_doctor_overlap
  EXCLUDE USING gist (doctor_id WITH =, tstzrange(slot_start, slot_end) WITH &&)
  WHERE (status IN ('booked', 'checked_in', 'in_consultation') AND slot_start IS NOT NULL);
--> statement-breakpoint
-- A patient can't hold two overlapping active appointments (even with different doctors).
ALTER TABLE appointments ADD CONSTRAINT appointments_no_patient_overlap
  EXCLUDE USING gist (patient_id WITH =, tstzrange(slot_start, slot_end) WITH &&)
  WHERE (status IN ('booked', 'checked_in', 'in_consultation') AND slot_start IS NOT NULL);
--> statement-breakpoint
-- Active weekly sessions of one doctor on one weekday never overlap in time while their
-- validity periods overlap. (date + time gives a timestamp on a fixed reference day.)
ALTER TABLE doctor_schedules ADD CONSTRAINT doctor_schedules_no_overlap
  EXCLUDE USING gist (
    doctor_id WITH =,
    weekday WITH =,
    tsrange(DATE '2000-01-03' + start_time, DATE '2000-01-03' + end_time) WITH &&,
    daterange(valid_from, valid_to, '[]') WITH &&
  ) WHERE (active);
--> statement-breakpoint

-- 2. The appointment status machine (docs/state-machines.md §1; the same table is in
-- packages/shared/src/schemas/appointments.ts). New rows start as booked (by slot) or
-- checked_in (walk-in); every status change must be an allowed one; the patient, doctor
-- and number of an appointment never change.
CREATE FUNCTION appointments_enforce_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('booked', 'checked_in') THEN
      RAISE EXCEPTION 'appointments must start as booked or checked_in, not %', NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.patient_id <> OLD.patient_id OR NEW.doctor_id <> OLD.doctor_id
     OR NEW.appointment_no <> OLD.appointment_no OR NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'an appointment''s patient, doctor, number and kind cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'booked' AND NEW.status IN ('checked_in', 'cancelled', 'rescheduled', 'no_show'))
    OR (OLD.status = 'checked_in' AND NEW.status IN ('in_consultation', 'cancelled'))
    OR (OLD.status = 'in_consultation' AND NEW.status IN ('completed', 'checked_in'))
  ) THEN
    RAISE EXCEPTION 'invalid appointment status change: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER appointments_enforce_status BEFORE INSERT OR UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointments_enforce_status();
--> statement-breakpoint

-- 3. Keep updated_at current (set_updated_at() is defined in migration 0001).
CREATE TRIGGER doctor_schedules_set_updated_at BEFORE UPDATE ON doctor_schedules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER schedule_exceptions_set_updated_at BEFORE UPDATE ON schedule_exceptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER appointments_set_updated_at BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- 4. hms_app privileges. No DELETE: schedules and time off are deactivated, and
-- appointments keep their history (cancelled, rescheduled, no-show).
GRANT SELECT, INSERT, UPDATE ON doctor_schedules, schedule_exceptions, appointments TO hms_app;
--> statement-breakpoint
-- nextval() for the appointment_no column default.
GRANT USAGE ON SEQUENCE appointment_no_seq TO hms_app;
