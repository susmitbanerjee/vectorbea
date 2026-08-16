import "server-only";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";
import { verifyToken } from "@/lib/auth/jwt";
import { getUserById, getUserWorkspaces, isEmailVerified, getUserBetaStatus } from "@/lib/auth/neon-auth";

export function getAccessTokenFromCookies(
  cookieStore: Pick<ReadonlyRequestCookies, "get">,
): string | null {
  return cookieStore.get(AUTH_COOKIE_NAME)?.value ?? null;
}

export async function getAuthenticatedUserFromCookies(
  cookieStore: Pick<ReadonlyRequestCookies, "get">,
): Promise<{ id: string; email: string } | null> {
  const token = getAccessTokenFromCookies(cookieStore);
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;
  return { id: payload.sub, email: payload.email };
}

export async function getPostLoginRedirectForUser(
  userId: string,
): Promise<{ redirectTo: string; organizations: import("@/lib/api").OrganizationView[] }> {
  // Gate ordering mirrors the (app) layout: verify email → beta approval → app.
  // Already-authenticated visits to /signin and /signup follow this path.
  try {
    if (!(await isEmailVerified(userId))) {
      return { redirectTo: "/verify-email", organizations: [] };
    }
    if (process.env.NEXT_PUBLIC_PRIVATE_BETA_MODE !== "false") {
      const bs = await getUserBetaStatus(userId);
      const approved = bs?.betaStatus === "approved" || bs?.isPlatformAdmin === true;
      if (!approved) return { redirectTo: "/beta", organizations: [] };
    }
  } catch {
    // DB hiccup — fall through to the control plane; the layout gates re-check there
  }

  const workspaces = await getUserWorkspaces(userId);
  const first = workspaces[0];
  // /control is the landing surface. The old /dashboard is no longer part of the
  // navigation, so sending people there after sign-in stranded them off the map.
  const redirectTo = first
    ? `/control?org=${encodeURIComponent(first.id)}`
    : "/control";

  // Map each Neon workspace into OrganizationView shape so the WorkspaceSwitcher
  // can list and switch between all workspaces the user belongs to.
  const organizations: import("@/lib/api").OrganizationView[] = workspaces.map((w) => ({
    id:         w.id,
    name:       w.name,
    createdAt:  null,
    role:       w.role as import("@/lib/api").WorkspaceRole,
    workspaces: [{
      id:               w.id,
      name:             w.name,
      role:             w.role as import("@/lib/api").WorkspaceRole,
      organizationId:   w.id,
      organizationName: w.name,
    }],
  }));

  return { redirectTo, organizations };
}

export async function loadProfileForUser(
  userId: string,
): Promise<{ email: string | null; full_name: string | null; avatar_url: string | null } | null> {
  const user = await getUserById(userId);
  if (!user) return null;
  return { email: user.email, full_name: user.full_name, avatar_url: user.avatar_url };
}

// ── Stubs for removed Supabase functions (keep callers compiling) ─────────────
/** @deprecated Supabase SSO removed — no-op stub */
export async function upsertProfile(_user: unknown): Promise<void> { return; }
/** @deprecated Supabase SSO removed — use getAuthenticatedUserFromCookies */
export const getAuthenticatedUserForAccessToken = getAuthenticatedUserFromCookies;
/** @deprecated Supabase org model removed */
export async function loadOrganizationsForUser(_userId: string): Promise<import("@/lib/api").OrganizationView[]> { return []; }
