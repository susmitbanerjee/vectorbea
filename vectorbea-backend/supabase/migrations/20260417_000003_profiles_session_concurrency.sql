-- =============================================================================
-- Seat-sharing prevention: 1-to-1 session concurrency enforcement
--
-- Adds current_session_id to vectorbea.profiles. Every successful login
-- rotates this UUID. The Next.js middleware reads the vb_session_id httpOnly
-- cookie and compares it against this column on every protected page request.
-- If they differ (i.e. the user logged in elsewhere), the old session is
-- immediately killed and the browser is redirected to /login?error=session_expired.
-- =============================================================================

alter table vectorbea.profiles
  add column if not exists current_session_id uuid null;

comment on column vectorbea.profiles.current_session_id is
  'Rotated on every login. Middleware compares the vb_session_id cookie against '
  'this value to enforce 1-to-1 session concurrency (anti-seat-sharing).';
