-- V076 - the time zone a person reads timestamps in.
--
-- Nullable with no default: NULL means "use my browser's zone", which is the right
-- answer for nearly everyone, and a default of 'UTC' would silently override it.
-- Set from Settings → Profile. Read by the web app only; nothing in the runtime
-- depends on it, so the API and worker tolerate either side of this migration.

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS time_zone TEXT;

COMMENT ON COLUMN app_users.time_zone IS
    'IANA zone the user reads timestamps in (e.g. Asia/Kolkata). NULL = browser zone.';
