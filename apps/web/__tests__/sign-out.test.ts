import { beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";

/**
 * SIGN OUT.
 *
 * The shell's "Sign out" was `<Link href="/signin">Sign out</Link>`. It
 * navigated and cleared nothing — not the httpOnly cookie, not the in-memory
 * token, not the localStorage copy the legacy layer keeps. The session survived
 * every sign-out in the product, and once /signin began redirecting a live
 * session onward the button became visibly inert: click it, land back in the
 * app.
 *
 * `DELETE /api/auth/session` is the one thing that actually ends a session, so
 * these pin its contract. The client half — clearing both token caches and
 * landing on the marketing page rather than the sign-in form — lives in
 * `SessionProvider.signOut`.
 */

const authenticatedUser = vi.fn();
const postLoginRedirect = vi.fn();
const profile = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  getAuthenticatedUserFromCookies: async () => authenticatedUser(),
  getPostLoginRedirectForUser: async (id: string) => postLoginRedirect(id),
  loadProfileForUser: async (id: string) => profile(id),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const { GET, DELETE } = await import("@/app/api/auth/session/route");

beforeEach(() => {
  authenticatedUser.mockReset();
  postLoginRedirect.mockReset();
  profile.mockReset();
});

describe("DELETE /api/auth/session", () => {
  it("expires the session cookie", async () => {
    const response = await DELETE();

    const written = response.cookies.get(AUTH_COOKIE_NAME);
    expect(written?.value).toBe("");
    expect(written?.maxAge).toBe(0);
    // Still httpOnly on the way out: an expired cookie that JS could read would
    // be a downgrade for no gain.
    expect(written?.httpOnly).toBe(true);
    // Path matters — a cookie cleared at a narrower path leaves the original
    // in place and the user stays signed in.
    expect(written?.path).toBe("/");
  });
});

describe("GET /api/auth/session", () => {
  it("answers 401 for a visitor with no session", async () => {
    authenticatedUser.mockResolvedValue(null);

    const response = await GET();

    // Not an error: it is what tells the marketing nav to render Sign in and
    // Start free, and what makes a stale session hint self-heal.
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ authenticated: false });
  });

  it("returns the identity the account avatar renders", async () => {
    authenticatedUser.mockResolvedValue({ id: "user-1", email: "a@b.test" });
    postLoginRedirect.mockResolvedValue({ redirectTo: "/control?org=ws-1" });
    profile.mockResolvedValue({ full_name: "Ada Lovelace", avatar_url: "https://cdn.test/a.png" });

    const body = await (await GET()).json();

    expect(body).toMatchObject({
      authenticated: true,
      redirectTo: "/control?org=ws-1",
      user: { email: "a@b.test", fullName: "Ada Lovelace", avatarUrl: "https://cdn.test/a.png" },
    });
  });

  it("stays authenticated when the profile lookup fails", async () => {
    // THE POINT. Both lookups reach the database and used to sit in a bare
    // `Promise.all`, so a transient fault turned a perfectly valid session into
    // a 500 — which every caller reads as "not signed in", and which would have
    // shown a signed-in user the Sign in button. The session is proven by the
    // verified cookie; the name and picture are decoration on top of it.
    authenticatedUser.mockResolvedValue({ id: "user-1", email: "a@b.test" });
    postLoginRedirect.mockRejectedValue(new Error("db unreachable"));
    profile.mockRejectedValue(new Error("db unreachable"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.authenticated).toBe(true);
    expect(body.user.email).toBe("a@b.test");
    // /control resolves the workspace itself, so it is the safe fallback for an
    // account whose memberships could not be read.
    expect(body.redirectTo).toBe("/control");
    expect(body.user.fullName).toBeNull();
  });
});
