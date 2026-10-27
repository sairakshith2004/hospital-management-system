-- Hand-written migration. Forward-only: never edit it once it has been applied anywhere.
-- Scheduled meetings (0022): a meeting moves only forward, scheduled → active → ended, or
-- scheduled → ended (cancelled or missed). Apart from that move, its details never change.
CREATE OR REPLACE FUNCTION meetings_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT ((OLD.status = 'scheduled' AND NEW.status IN ('scheduled', 'active', 'ended'))
          OR (OLD.status = 'active' AND NEW.status IN ('active', 'ended'))) THEN
    RAISE EXCEPTION 'an ended meeting cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'ended_at', 'ended_by'])
     <> (to_jsonb(OLD) - ARRAY['status', 'ended_at', 'ended_by']) THEN
    RAISE EXCEPTION 'only the start or end of a meeting can be recorded' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
