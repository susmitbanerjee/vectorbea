import "server-only";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";
import { verifyToken } from "@/lib/auth/jwt";
import { getUserById, getUserWorkspaces } from "@/lib/auth/neon-auth";

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
): Promise<{ redirectTo: string; organizations: { id: string; name: string }[] }> {
  const workspaces = await getUserWorkspaces(userId);
  const first = workspaces[0];
  const redirectTo = first
    ? `/dashboard?org=${encodeURIComponent(first.id)}`
    : "/dashboard";
  return {
    redirectTo,
    organizations: workspaces.map((w: { id: string; name: string; slug: string; role: string }) => ({ id: w.id, name: w.name })),
  };
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
export async function loadOrganizationsForUser(_userId: string): Promise<{ id: string; name: string; planTier: import("@/lib/api").PlanTier | null }[]> { return []; }
