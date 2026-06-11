export const AUTH_COOKIE_NAME = "vectorbea-access-token";

/**
 * Carries the per-login session UUID that is also stored in
 * vectorbea.profiles.current_session_id.
 * Middleware compares this cookie against the DB value to kill sessions that
 * have been displaced by a login on another device (seat-sharing prevention).
 */
export const SESSION_ID_COOKIE_NAME = "vb_session_id";
