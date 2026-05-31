import "server-only";
import { neon } from "@neondatabase/serverless";
import { getUserWorkspaces } from "@/lib/auth/neon-auth";

/**
 * Upsert an OAuth user into Neon app_users.
 *
 * Handles the "same email, different OAuth provider" case:
 * If a user with this email already exists (e.g. signed up via GitHub),
 * we return that user's ID so they can log in — no duplicate created.
 *
 * Returns the supabase_user_id that should be used as the JWT sub.
 */
export async function upsertOAuthUser(
  oauthId: string,
  email: string,
  name?: string,
  picture?: string,
): Promise<string> {
  const sql = neon(process.env.DATABASE_URL!);

  // 1. Check if this exact provider ID already exists
  const byId = await sql`
    SELECT id, supabase_user_id FROM app_users
    WHERE supabase_user_id = ${oauthId} LIMIT 1` as { id: string; supabase_user_id: string }[];

  if (byId[0]) {
    // Already registered with this provider — update profile fields and return
    await sql`UPDATE app_users SET
      full_name  = COALESCE(${name ?? null}, full_name),
      avatar_url = COALESCE(${picture ?? null}, avatar_url),
      updated_at = now()
      WHERE supabase_user_id = ${oauthId}`;
    return byId[0].supabase_user_id;
  }

  // 2. Check if email already exists from a different provider (e.g. GitHub)
  const byEmail = await sql`
    SELECT id, supabase_user_id FROM app_users
    WHERE LOWER(email) = LOWER(${email}) LIMIT 1` as { id: string; supabase_user_id: string }[];

  if (byEmail[0]) {
    // Same person, different OAuth provider — return existing user's sub
    // Update their name/avatar if we have better data
    await sql`UPDATE app_users SET
      full_name  = COALESCE(${name ?? null}, full_name),
      avatar_url = COALESCE(${picture ?? null}, avatar_url),
      updated_at = now()
      WHERE id = ${byEmail[0].id}`;
    return byEmail[0].supabase_user_id;
  }

  // 3. Completely new user — insert
  await sql`INSERT INTO app_users (supabase_user_id, email, full_name, avatar_url, status, email_verified)
    VALUES (${oauthId}, ${email}, ${name ?? null}, ${picture ?? null}, 'active', TRUE)`;

  // Create default workspace
  const uid = (await sql`SELECT id FROM app_users WHERE supabase_user_id=${oauthId} LIMIT 1` as {id:string}[])[0]?.id;
  if (uid && (await getUserWorkspaces(uid)).length === 0) {
    const slug = email.split("@")[0]!.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 40);
    const wsName = (name ?? email.split("@")[0]) + "'s Workspace";
    const wr = await sql`INSERT INTO workspaces(name,slug,owner_user_id) VALUES(${wsName},${slug},${uid}) ON CONFLICT(slug) DO UPDATE SET slug=${slug}||'-'||substr(md5(random()::text),1,6) RETURNING id` as {id:string}[];
    const wid = wr[0]?.id;
    if (wid) {
      await sql`INSERT INTO environments(workspace_id,name,slug,type) VALUES(${wid},'Development','development','development') ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO workspace_members(workspace_id,user_id,role,status) VALUES(${wid},${uid},'owner','active') ON CONFLICT DO NOTHING`;
    }
  }

  return oauthId;
}
