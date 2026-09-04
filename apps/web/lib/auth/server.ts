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
): Promise<{ redirectTo: string; organizations: import("@/lib/api").OrganizationView[] }> {
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

/* ══════════════════════════════════════════════════════════════════════════════
   "ALREADY SIGNED IN — WHERE DO THEY GO?"

   `/signin`, `/signup` and `/login` each answered this themselves, and each got
   it wrong in the same way: the `redirect()` call sat inside a `try/catch` that
   existed to tolerate a missing JWT_SECRET. `redirect()` works by THROWING an
   error carrying the digest `NEXT_REDIRECT`, so the catch swallowed it and the
   page went on to render the sign-in form — to somebody who was already signed
   in. Anything that took a user out of the app shell and back in through an auth
   route therefore demanded a fresh sign-in for a session they still had.

   One implementation, here, so the three pages cannot drift again: everything
   that can throw happens inside this function, the answer comes back as a value,
   and the page calls `redirect()` on it where nothing can intercept the throw.
══════════════════════════════════════════════════════════════════════════════ */
export async function resolveSignedInDestination(
  cookieStore: Pick<ReadonlyRequestCookies, "get">,
  next?: string,
): Promise<string | null> {
  try {
    const user = await getAuthenticatedUserFromCookies(cookieStore);
    if (!user) return null;
    // Site-relative only. `//host` is protocol-relative and would leave the site,
    // so it is rejected alongside absolute URLs.
    if (next && next.startsWith("/") && !next.startsWith("//")) return next;
    try {
      return (await getPostLoginRedirectForUser(user.id)).redirectTo;
    } catch {
      // The workspace lookup failed but the SESSION is valid, so the answer is
      // still "into the app". Falling back to the sign-in form here is what
      // turned a transient database blip into a forced re-login.
      return "/control";
    }
  } catch {
    // No JWT_SECRET, or the token is missing/invalid/expired. Genuinely signed
    // out: the caller should render the form.
    return null;
  }
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
