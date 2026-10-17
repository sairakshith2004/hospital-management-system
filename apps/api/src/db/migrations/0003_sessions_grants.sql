-- Hand-written migration. Forward-only: never edit it once it has been applied anywhere.
-- Sessions are created at login, refreshed on activity, and deleted at logout or once
-- expired. They hold a user ID, the session start time and a CSRF token; no clinical,
-- financial or audit data. No other table's privileges change.
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO hms_app;
