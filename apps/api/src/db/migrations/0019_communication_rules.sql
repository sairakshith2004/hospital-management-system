-- Hand-written migration. Forward-only: never edit it once it has been applied anywhere.
-- Rules for the communication hub tables (0018): append-only notices, conversations and
-- messages; members only move their read marker; call requests are final once decided;
-- exact hms_app privileges.

-- 1. Append-only (prevent_update_delete() is defined in migration 0010).
CREATE TRIGGER notices_no_update_delete BEFORE UPDATE OR DELETE ON notices
  FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();
--> statement-breakpoint
CREATE TRIGGER notice_reads_no_update_delete BEFORE UPDATE OR DELETE ON notice_reads
  FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();
--> statement-breakpoint
CREATE TRIGGER conversations_no_update_delete BEFORE UPDATE OR DELETE ON conversations
  FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();
--> statement-breakpoint
CREATE TRIGGER messages_no_update_delete BEFORE UPDATE OR DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();
--> statement-breakpoint
CREATE TRIGGER messages_no_truncate BEFORE TRUNCATE ON messages
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_update_delete();
--> statement-breakpoint

-- 2. A member row only ever moves its read marker forward.
CREATE FUNCTION conversation_members_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'last_read_at') <> (to_jsonb(OLD) - 'last_read_at') THEN
    RAISE EXCEPTION 'a conversation member can only update last_read_at'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.last_read_at := greatest(OLD.last_read_at, NEW.last_read_at);
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER conversation_members_enforce BEFORE UPDATE ON conversation_members
  FOR EACH ROW EXECUTE FUNCTION conversation_members_enforce();
--> statement-breakpoint

-- 3. A call request only leaves 'pending', once, and its request details never change.
CREATE FUNCTION call_requests_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'a % call request cannot change', OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'response_note', 'responded_at', 'conversation_id'])
     <> (to_jsonb(OLD) - ARRAY['status', 'response_note', 'responded_at', 'conversation_id']) THEN
    RAISE EXCEPTION 'only the outcome of a call request can change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER call_requests_enforce BEFORE UPDATE ON call_requests
  FOR EACH ROW EXECUTE FUNCTION call_requests_enforce();
--> statement-breakpoint

-- 4. Keep updated_at current (set_updated_at() is defined in migration 0001).
CREATE TRIGGER doctor_availability_set_updated_at BEFORE UPDATE ON doctor_availability
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- 5. hms_app privileges. No DELETE anywhere.
GRANT SELECT, INSERT ON notices, notice_reads, conversations, messages TO hms_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON conversation_members, doctor_availability, call_requests TO hms_app;
