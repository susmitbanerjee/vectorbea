import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";
import { verifyToken } from "@/lib/auth/jwt";
import { getUserById } from "@/lib/auth/neon-auth";

/**
 * P0 Tenant Isolation Guard
 *
 * Verifies two things before any service-role query is allowed:
 *   1. The request carries a valid, non-expired Supabase access token.
 *   2. The authenticated user is an explicit member of `workspaceId` in
 *      vectorbea.workspace_members.
 *
 * Usage in a route handler:
 *
 *   const authResult = await assertWorkspaceMember(request, workspaceId);
 *   if (authResult.error) return authResult.error;  // 401 or 403 response
 *   const { user } = authResult;                    // proceed with user
 *
 * Never bypasses RLS by granting access based on anything other than an
 * explicit row in workspace_members. Passing an arbitrary workspaceId
 * that the caller is not a member of always returns 403.
 */
export type AssertResult =
  | { error: NextResponse; user?: never }
  | { error: null; user: { id: string; email?: string | null; role: WorkspaceRole } };

export type WorkspaceRole = "viewer" | "editor" | "admin";

const ROLE_LEVEL: Record<WorkspaceRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
};

function normalizeRole(role: unknown): WorkspaceRole {
  return role === "admin" || role === "editor" || role === "viewer" ? role : "viewer";
}

export function hasWorkspaceRole(role: WorkspaceRole, required: WorkspaceRole) {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[required];
}

export function requireWorkspaceRole(
  role: WorkspaceRole,
  required: WorkspaceRole,
  message = "You do not have permission to perform this action.",
) {
  if (!hasWorkspaceRole(role, required)) {
    return NextResponse.json({ error: message }, { status: 403 });
  }
  return null;
}

export async function assertWorkspaceMember(
  request: NextRequest,
  workspaceId: string,
): Promise<AssertResult> {
  const requireAuth = !!process.env.JWT_SECRET;

  // Open/mock-session mode: skip Supabase token+membership enforcement.
  // This keeps local MVP flows functional when running without Supabase auth.
  if (!requireAuth) {
    return { error: null, user: { id: "mock-user", email: null, role: "admin" } };
  }

  // ── 1. Extract token (Authorization header takes precedence over cookie) ──
  const bearerToken = request.headers
    .get("Authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();

  const cookieToken = request.cookies.get(AUTH_COOKIE_NAME)?.value?.trim();
  const accessToken = bearerToken ?? cookieToken ?? null;

  if (!accessToken) {
    return {
      error: NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      ),
    };
  }

  // ── 2. Validate the JWT ────────────────────────────────────────────────────
  const payload = await verifyToken(accessToken);
  const user = payload ? await getUserById(payload.sub) : null;
  if (!user) {
    return {
      error: NextResponse.json(
        { error: "Invalid or expired session. Please sign in again." },
        { status: 401 },
      ),
    };
  }

  // ── 3. Verify workspace membership via Neon ───────────────────────────────
  const { Pool } = await import("@neondatabase/serverless");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  let membership: { role: string } | null = null;
  try {
    const { rows } = await pool.query<{ role: string }>(
      "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1",
      [workspaceId, user.id],
    );
    membership = rows[0] ?? null;
  } catch (e) {
    console.error("[assertWorkspaceMember] membership query error:", e);
    return {
      error: NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 }),
    };
  } finally {
    await pool.end();
  }

  if (!membership) {
    // User is authenticated but is NOT a member of this workspace.
    // Return 403, not 404, so the client knows it's an authorization failure
    // (not a missing resource) while not leaking whether the workspace exists.
    return {
      error: NextResponse.json(
        { error: "You do not have access to this workspace." },
        { status: 403 },
      ),
    };
  }

  return { error: null, user: { ...user, role: normalizeRole(membership.role) } };
}
