import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import { getUserById } from "@/lib/auth/neon-auth";
import { neon } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";

function db() {
  const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  return neon(url);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: workspaceId } = await params;
    const cookieStore = await cookies();

    // Verify caller is authenticated and is a member of this workspace
    let user: { id: string; email: string } | null = null;
    try { user = await getAuthenticatedUserFromCookies(cookieStore); } catch {}
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // The JWT `sub` is app_users.id for password accounts but supabase_user_id
    // for OAuth accounts — resolve to the canonical app_users.id before
    // comparing against workspace_members.user_id, which is always app_users.id.
    const resolvedUser = await getUserById(user.id);
    if (!resolvedUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sql = db();

    // Verify membership
    const membership = await sql`
      SELECT role FROM workspace_members
      WHERE workspace_id = ${workspaceId} AND user_id = ${resolvedUser.id} AND status = 'active'
      LIMIT 1
    ` as { role: string }[];
    if (!membership[0]) return NextResponse.json({ error: "Not a member" }, { status: 403 });

    // Load all members with user info from Neon app_users
    const rows = await sql`
      SELECT wm.user_id as id, wm.role, wm.created_at as joined_at,
             au.email, au.full_name, au.avatar_url
      FROM workspace_members wm
      JOIN app_users au ON au.id = wm.user_id
      WHERE wm.workspace_id = ${workspaceId} AND wm.status = 'active'
      ORDER BY wm.created_at ASC
    ` as { id: string; role: string; joined_at: string; email: string; full_name: string | null; avatar_url: string | null }[];

    const members = rows.map(m => ({
      id:          m.id,
      email:       m.email,
      displayName: m.full_name ?? m.email,
      avatarUrl:   m.avatar_url,
      role:        m.role,
      joinedAt:    m.joined_at,
    }));

    return NextResponse.json(members);
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to load members" },
      { status: 500 },
    );
  }
}
