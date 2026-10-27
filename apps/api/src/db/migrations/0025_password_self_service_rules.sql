-- Hand-written migration. Forward-only: never edit it once it has been applied anywhere.
-- Rules for password-reset links (0024): a link is only ever marked used, once; nothing
-- else about it changes. Exact hms_app privileges (no DELETE: links are kept for audit).

CREATE FUNCTION password_reset_tokens_enforce() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'a used password-reset link cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - 'used_at') <> (to_jsonb(OLD) - 'used_at') THEN
    RAISE EXCEPTION 'only the use of a password-reset link can be recorded' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER password_reset_tokens_enforce BEFORE UPDATE ON password_reset_tokens
  FOR EACH ROW EXECUTE FUNCTION password_reset_tokens_enforce();
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON password_reset_tokens TO hms_app;
