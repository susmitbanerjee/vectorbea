import "server-only";
import { Pool } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";

function getPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  return new Pool({ connectionString: url });
}

export interface NeonUser {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
}

/** Create a new user with hashed password. Returns the created user. */
export async function createUser(
  email: string,
  password: string,
  fullName?: string,
): Promise<NeonUser> {
  const pool = getPool();
  const hash = await bcrypt.hash(password, 12);
  const userId = crypto.randomUUID();

  const { rows } = await pool.query<NeonUser>(
    `INSERT INTO app_users
       (id, supabase_user_id, email, full_name, password_hash, status, email_verified)
     VALUES ($1, $1, $2, $3, $4, 'active', TRUE)
     RETURNING id, email, full_name, avatar_url`,
    [userId, email.toLowerCase().trim(), fullName ?? null, hash],
  );

  // Create a default workspace + environment + owner membership
  const slug = email.split("@")[0]!
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .slice(0, 40);

  const wsResult = await pool.query<{ id: string }>(
    `INSERT INTO workspaces (name, slug, owner_user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (slug) DO UPDATE SET slug = $2 || '-' || substr(md5(random()::text), 1, 6)
     RETURNING id`,
    [`${fullName ?? email.split("@")[0]}'s Workspace`, slug, userId],
  );
  const workspaceId = wsResult.rows[0]!.id;

  await pool.query(
    `INSERT INTO environments (workspace_id, name, slug, type)
     VALUES ($1, 'Development', 'development', 'development')
     ON CONFLICT DO NOTHING`,
    [workspaceId],
  );

  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role, status)
     VALUES ($1, $2, 'owner', 'active')
     ON CONFLICT DO NOTHING`,
    [workspaceId, userId],
  );

  await pool.end();
  return rows[0]!;
}

/** Verify credentials. Returns the user if valid, null if wrong password/email. */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<NeonUser | null> {
  const pool = getPool();
  const { rows } = await pool.query<NeonUser & { password_hash: string | null }>(
    `SELECT id, email, full_name, avatar_url, password_hash
     FROM app_users
     WHERE LOWER(email) = LOWER($1) AND status = 'active'
     LIMIT 1`,
    [email.trim()],
  );
  await pool.end();

  const user = rows[0];
  if (!user || !user.password_hash) return null;

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;

  return { id: user.id, email: user.email, full_name: user.full_name, avatar_url: user.avatar_url };
}

/** Load a user by id for session hydration. */
export async function getUserById(id: string): Promise<NeonUser | null> {
  const pool = getPool();
  const { rows } = await pool.query<NeonUser>(
    `SELECT id, email, full_name, avatar_url
     FROM app_users WHERE id = $1 AND status = 'active' LIMIT 1`,
    [id],
  );
  await pool.end();
  return rows[0] ?? null;
}

/** Return all workspaces the user belongs to. */
export async function getUserWorkspaces(userId: string) {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string; name: string; slug: string; role: string;
  }>(
    `SELECT w.id, w.name, w.slug, wm.role
     FROM workspace_members wm
     JOIN workspaces w ON w.id = wm.workspace_id
     WHERE wm.user_id = $1 AND wm.status = 'active'
     ORDER BY w.name`,
    [userId],
  );
  await pool.end();
  return rows;
}
