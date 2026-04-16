import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";
import {
  getAuthenticatedUserForAccessToken,
} from "@/lib/auth/server";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

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
  | { error: null; user: { id: string; email?: string | null } };

export async function assertWorkspaceMember(
  request: NextRequest,
  workspaceId: string,
): Promise<AssertResult> {
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

  // ── 2. Validate the token against Supabase Auth ────────────────────────────
  const user = await getAuthenticatedUserForAccessToken(accessToken);
  if (!user) {
    return {
      error: NextResponse.json(
        { error: "Invalid or expired session. Please sign in again." },
        { status: 401 },
      ),
    };
  }

  // ── 3. Verify workspace membership (admin client, but explicit row check) ──
  //
  // We use the admin client here intentionally: the membership table itself
  // has RLS, and we need a trusted read to enforce the isolation boundary.
  // The result of this query is the authorization decision — not a shortcut
  // around it.
  const supabase = createVectorBeaAdminClient();
  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    console.error("[assertWorkspaceMember] membership query error:", membershipError.message);
    return {
      error: NextResponse.json(
        { error: "Failed to verify workspace access" },
        { status: 500 },
      ),
    };
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

  return { error: null, user };
}
