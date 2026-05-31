-- =============================================================================
-- V007__local_auth.sql
-- Switch from Supabase auth to Neon-native email/password authentication.
--
-- app_users now stores:
--   - password_hash  bcrypt-hashed password (nullable for legacy/SSO rows)
--   - email_verified whether the email is confirmed
--
-- The JWT is now signed locally with JWT_SECRET and verified by both
-- the Next.js app and the Kotlin API using HS256.
-- supabase_user_id is reused as the stable user UUID (set to app_users.id
-- on local signup so existing Kotlin API code needs no changes).
-- =============================================================================

ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS password_hash   TEXT,
    ADD COLUMN IF NOT EXISTS email_verified  BOOLEAN NOT NULL DEFAULT TRUE;

-- Allow email lookup (sign-in by email)
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email_lower
    ON app_users (LOWER(email))
    WHERE email IS NOT NULL;
