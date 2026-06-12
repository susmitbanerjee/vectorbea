import "server-only";
import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";

type Row = Record<string, any>;

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  return neon(url);
}

export interface NeonUser {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
}

export async function createUser(email: string, password: string, fullName?: string): Promise<NeonUser> {
  const sql = db();
  const hash = await bcrypt.hash(password, 12);
  const userId = crypto.randomUUID();

  // email_verified=FALSE — password signups must confirm via the verification
  // mail before reaching the beta application. (OAuth users are provider-verified.)
  const rows = await sql`
    INSERT INTO app_users (id, supabase_user_id, email, full_name, password_hash, status, email_verified)
    VALUES (${userId}, ${userId}, ${email.toLowerCase().trim()}, ${fullName ?? null}, ${hash}, 'active', FALSE)
    RETURNING id, email, full_name, avatar_url` as Row[];

  const user = rows[0]! as NeonUser;
  const slug = email.split("@")[0]!.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 40);

  const wsRows = await sql`
    INSERT INTO workspaces (name, slug, owner_user_id)
    VALUES (${(fullName ?? email.split("@")[0]) + "'s Workspace"}, ${slug}, ${userId})
    ON CONFLICT (slug) DO UPDATE SET slug = ${slug} || '-' || substr(md5(random()::text), 1, 6)
    RETURNING id` as Row[];
  const wsId = wsRows[0]!.id as string;

  await sql`INSERT INTO environments (workspace_id, name, slug, type)
    VALUES (${wsId}, 'Development', 'development', 'development') ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, status)
    VALUES (${wsId}, ${userId}, 'owner', 'active') ON CONFLICT DO NOTHING`;

  return user;
}

export async function verifyCredentials(email: string, password: string): Promise<NeonUser | null> {
  const sql = db();
  const rows = await sql`
    SELECT id, email, full_name, avatar_url, password_hash
    FROM app_users WHERE LOWER(email) = LOWER(${email.trim()}) AND status = 'active' LIMIT 1` as Row[];

  const user = rows[0];
  if (!user?.password_hash) return null;
  const ok = await bcrypt.compare(password, user.password_hash as string);
  if (!ok) return null;
  return { id: user.id, email: user.email, full_name: user.full_name, avatar_url: user.avatar_url } as NeonUser;
}

/** True when the user's email address has been confirmed. */
export async function isEmailVerified(userId: string): Promise<boolean> {
  const sql = db();
  const rows = await sql`
    SELECT email_verified FROM app_users WHERE id = ${userId} LIMIT 1` as { email_verified: boolean }[];
  return rows[0]?.email_verified === true;
}

/** Marks the user's email as verified (idempotent). */
export async function markEmailVerified(userId: string): Promise<void> {
  const sql = db();
  await sql`UPDATE app_users SET email_verified = TRUE, updated_at = now() WHERE id = ${userId}`;
}

export async function getUserById(id: string): Promise<NeonUser | null> {
  const sql = db();
  const rows = await sql`
    SELECT id, email, full_name, avatar_url FROM app_users
    WHERE id = ${id} AND status = 'active' LIMIT 1` as Row[];
  return rows[0] ? (rows[0] as NeonUser) : null;
}

export async function getUserBetaStatus(id: string): Promise<{ betaStatus: string; isPlatformAdmin: boolean } | null> {
  try {
    const sql = db();
    const rows = await sql`
      SELECT COALESCE(beta_status, 'waitlisted') as beta_status,
             COALESCE(is_platform_admin, false) as is_platform_admin
      FROM app_users WHERE id = ${id} LIMIT 1` as { beta_status: string; is_platform_admin: boolean }[];
    if (!rows[0]) return null;
    return { betaStatus: rows[0].beta_status, isPlatformAdmin: rows[0].is_platform_admin };
  } catch {
    // FAIL CLOSED: if the status can't be read, treat as waitlisted. V015
    // backfilled all pre-existing users to 'approved', so this only ever
    // gates users we can't positively identify as approved.
    return { betaStatus: "waitlisted", isPlatformAdmin: false };
  }
}

export async function getUserWorkspaces(userId: string) {
  const sql = db();
  const rows = await sql`
    SELECT w.id, w.name, w.slug, wm.role
    FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
    WHERE wm.user_id = ${userId} AND wm.status = 'active' ORDER BY w.name` as Row[];
  return rows as { id: string; name: string; slug: string; role: string }[];
}
