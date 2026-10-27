-- Hand-written migration. Forward-only: never edit it once it has been applied anywhere.
-- Rules for the video meeting tables (0020): a meeting only ends, once; a participant row
-- keeps who was invited and when; exact hms_app privileges.

-- 1. A meeting changes only from active to ended, and its details never change.
CREATE FUNCTION meetings_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'active' THEN
    RAISE EXCEPTION 'an ended meeting cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'ended_at', 'ended_by'])
     <> (to_jsonb(OLD) - ARRAY['status', 'ended_at', 'ended_by']) THEN
    RAISE EXCEPTION 'only the end of a meeting can be recorded' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER meetings_enforce BEFORE UPDATE ON meetings
  FOR EACH ROW EXECUTE FUNCTION meetings_enforce();
--> statement-breakpoint

-- 2. Participants: the meeting, person and invitation time never change; the first join
-- time is kept once set.
CREATE FUNCTION meeting_participants_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.meeting_id <> OLD.meeting_id OR NEW.user_id <> OLD.user_id
     OR NEW.invited_at <> OLD.invited_at
     OR (OLD.joined_at IS NOT NULL AND NEW.joined_at IS DISTINCT FROM OLD.joined_at) THEN
    RAISE EXCEPTION 'a meeting invitation cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER meeting_participants_enforce BEFORE UPDATE ON meeting_participants
  FOR EACH ROW EXECUTE FUNCTION meeting_participants_enforce();
--> statement-breakpoint

-- 3. hms_app privileges. No DELETE.
GRANT SELECT, INSERT, UPDATE ON meetings, meeting_participants TO hms_app;
