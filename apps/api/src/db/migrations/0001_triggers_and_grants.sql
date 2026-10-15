-- Hand-written migration. Forward-only: never edit it once it has been applied anywhere.

-- 1. Keep updated_at current on every mutable table.
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER hospital_settings_set_updated_at BEFORE UPDATE ON hospital_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER departments_set_updated_at BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER employees_set_updated_at BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER roles_set_updated_at BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- 2. audit_logs is append-only, for every role, including its owner.
CREATE FUNCTION audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update_delete BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();
--> statement-breakpoint

-- 3. hms_app privileges, table by table. A table not listed here gets nothing.
GRANT SELECT, UPDATE ON hospital_settings TO hms_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON departments, employees, users, roles TO hms_app;
--> statement-breakpoint
GRANT SELECT ON permissions TO hms_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON user_roles, role_permissions TO hms_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_logs TO hms_app;
