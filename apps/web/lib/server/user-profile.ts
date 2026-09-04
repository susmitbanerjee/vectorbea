import "server-only";

import bcrypt from "bcryptjs";

import { appQueryOne } from "@/lib/server/app-db";

/* ══════════════════════════════════════════════════════════════════════════════
   THE SIGNED-IN PERSON

   `/settings/profile` was a static page. It rendered the sentence "Your name
   and email come from your OAuth provider — we don't store them separately",
   which is not true: `app_users` has `full_name`, `avatar_url` and
   `password_hash`, all written at sign-up by `lib/auth/neon-auth.createUser`.
   There was simply no endpoint to change any of them.

   THE JWT SUBJECT IS NOT ALWAYS THE ROW ID. Password accounts carry
   `app_users.id` in `sub`; OAuth accounts carry `supabase_user_id`. Every
   lookup here resolves both, the same way `neon-auth.getUserById` does, because
   a profile page that works for password users and 404s for OAuth users is the
   kind of bug that only shows up in production.
══════════════════════════════════════════════════════════════════════════════ */

export interface UserProfile {
  id: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  status: string;
  emailVerified: boolean;
  betaStatus: string;
  isPlatformAdmin: boolean;
  /** False for OAuth-only accounts — they have no password to change. */
  hasPassword: boolean;
  createdAt: string;
}

interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  status: string;
  email_verified: boolean;
  beta_status: string;
  is_platform_admin: boolean;
  has_password: boolean;
  created_at: Date | string;
}

const SELECT_PROFILE = `
  SELECT id, email, full_name, avatar_url, status,
         COALESCE(email_verified, true)     AS email_verified,
         COALESCE(beta_status, 'waitlisted') AS beta_status,
         COALESCE(is_platform_admin, false)  AS is_platform_admin,
         (password_hash IS NOT NULL)         AS has_password,
         created_at
    FROM app_users`;

function toProfile(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    status: row.status,
    emailVerified: row.email_verified,
    betaStatus: row.beta_status,
    isPlatformAdmin: row.is_platform_admin,
    hasPassword: row.has_password,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

/** Resolve a JWT subject to the canonical `app_users` row. */
export async function getUserProfile(subject: string): Promise<UserProfile | null> {
  const row = await appQueryOne<ProfileRow>(
    `${SELECT_PROFILE} WHERE (id::text = $1 OR supabase_user_id = $1) LIMIT 1`,
    [subject],
  );
  return row ? toProfile(row) : null;
}

export const PROFILE_LIMITS = {
  FULL_NAME_MAX: 120,
  AVATAR_URL_MAX: 2048,
  PASSWORD_MIN: 12,
  PASSWORD_MAX: 200,
} as const;

export interface ProfileUpdate {
  fullName?: string | null;
  avatarUrl?: string | null;
}

/**
 * Update the fields a person owns.
 *
 * `email` is deliberately not here. It is the login identifier and the key
 * every invitation is addressed to; changing it is an account-recovery flow
 * with a verification step, not a text field, and offering it as one would be
 * the kind of half-built control this screen is being rebuilt to remove.
 */
export async function updateUserProfile(
  subject: string,
  update: ProfileUpdate,
): Promise<UserProfile> {
  const fullName = normalizeName(update.fullName);
  const avatarUrl = normalizeAvatarUrl(update.avatarUrl);

  // COALESCE on the parameter, not the column: an absent key leaves the value
  // alone, while an explicit null clears it. A blanket overwrite would wipe an
  // avatar every time somebody edited only their name.
  const row = await appQueryOne<ProfileRow>(
    `UPDATE app_users
        SET full_name  = CASE WHEN $2::boolean THEN $3 ELSE full_name END,
            avatar_url = CASE WHEN $4::boolean THEN $5 ELSE avatar_url END,
            updated_at = now()
      WHERE (id::text = $1 OR supabase_user_id = $1)
      RETURNING id, email, full_name, avatar_url, status,
                COALESCE(email_verified, true)      AS email_verified,
                COALESCE(beta_status, 'waitlisted') AS beta_status,
                COALESCE(is_platform_admin, false)  AS is_platform_admin,
                (password_hash IS NOT NULL)         AS has_password,
                created_at`,
    [
      subject,
      update.fullName !== undefined,
      fullName,
      update.avatarUrl !== undefined,
      avatarUrl,
    ],
  );

  if (!row) throw new Error("Your account could not be found.");
  return toProfile(row);
}

function normalizeName(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > PROFILE_LIMITS.FULL_NAME_MAX) {
    throw new Error(`Your name must be ${PROFILE_LIMITS.FULL_NAME_MAX} characters or fewer.`);
  }
  return trimmed;
}

/**
 * An avatar URL is rendered into an `<img src>`, so the scheme is checked here
 * rather than trusted. `javascript:` and `data:` are refused: the first is an
 * XSS vector the moment anything renders it as a link, and the second lets a
 * user store arbitrary payloads in a text column.
 */
function normalizeAvatarUrl(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > PROFILE_LIMITS.AVATAR_URL_MAX) {
    throw new Error("That avatar URL is too long.");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Enter a full image URL, starting with https://.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Avatar URLs must use https.");
  }
  return parsed.toString();
}

export type PasswordChangeResult =
  | { ok: true }
  | { ok: false; reason: "no_password" | "wrong_password" | "not_found" };

/**
 * Change a password, proving the current one first.
 *
 * The current password is required even though the caller already holds a valid
 * session: a session cookie proves the browser was authenticated at some point,
 * not that the person at the keyboard is the account holder. Without this step
 * an unattended laptop is a permanent account takeover.
 *
 * The distinction between "wrong password" and "no account" is returned to the
 * CALLER and not to the browser — the route collapses both into one message, so
 * this cannot become an oracle.
 */
export async function changePassword(
  subject: string,
  currentPassword: string,
  newPassword: string,
): Promise<PasswordChangeResult> {
  if (newPassword.length < PROFILE_LIMITS.PASSWORD_MIN) {
    throw new Error(`Choose a password of at least ${PROFILE_LIMITS.PASSWORD_MIN} characters.`);
  }
  if (newPassword.length > PROFILE_LIMITS.PASSWORD_MAX) {
    throw new Error("That password is too long.");
  }
  if (newPassword === currentPassword) {
    throw new Error("The new password must be different from the current one.");
  }

  const row = await appQueryOne<{ id: string; password_hash: string | null }>(
    `SELECT id, password_hash FROM app_users
      WHERE (id::text = $1 OR supabase_user_id = $1) AND status = 'active' LIMIT 1`,
    [subject],
  );
  if (!row) return { ok: false, reason: "not_found" };
  if (!row.password_hash) return { ok: false, reason: "no_password" };

  const matches = await bcrypt.compare(currentPassword, row.password_hash);
  if (!matches) return { ok: false, reason: "wrong_password" };

  const hash = await bcrypt.hash(newPassword, 12);
  await appQueryOne(
    `UPDATE app_users SET password_hash = $2, updated_at = now() WHERE id = $1::uuid RETURNING id`,
    [row.id, hash],
  );
  return { ok: true };
}
