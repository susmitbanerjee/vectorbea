import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "ALREADY SIGNED IN — WHERE DO THEY GO?"
 *
 * `/signin`, `/signup` and `/login` each answered this themselves, and each got
 * it wrong the same way: the `redirect()` call sat inside a `try/catch` written
 * to tolerate a missing JWT_SECRET. `redirect()` works by THROWING an error
 * carrying the digest `NEXT_REDIRECT`, so the catch swallowed it and the page
 * rendered the sign-in form — to somebody who was already signed in.
 *
 * That is the re-login users hit after following a docs link out of the app and
 * coming back through an auth route. The pages now call `redirect()` outside any
 * handler, on a destination this function returns as a VALUE. These tests pin the
 * function, because it is the piece that has to be exhaustive: every path must
 * end in either a destination or a deliberate null, and never in a throw.
 */

const getAuthenticatedUser = vi.fn();
const getUserWorkspaces = vi.fn();

vi.mock("@/lib/auth/jwt", () => ({
  verifyToken: async (token: string) => getAuthenticatedUser(token),
}));

vi.mock("@/lib/auth/neon-auth", () => ({
  getUserById: async () => null,
  getUserWorkspaces: async (userId: string) => getUserWorkspaces(userId),
}));

const { resolveSignedInDestination } = await import("@/lib/auth/server");

/** A cookie jar shaped like `ReadonlyRequestCookies` for the one method used. */
function cookies(token?: string) {
  return { get: (name: string) => (token && name ? { name, value: token } : undefined) };
}

beforeEach(() => {
  getAuthenticatedUser.mockReset();
  getUserWorkspaces.mockReset();
});

describe("resolveSignedInDestination", () => {
  it("returns null when there is no session, so the form renders", async () => {
    expect(await resolveSignedInDestination(cookies())).toBeNull();
  });

  it("returns null when the token does not verify", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    expect(await resolveSignedInDestination(cookies("stale"))).toBeNull();
  });

  it("sends a signed-in visitor to their workspace rather than the form", async () => {
    getAuthenticatedUser.mockResolvedValue({ sub: "user-1", email: "a@b.test" });
    getUserWorkspaces.mockResolvedValue([{ id: "ws-1", name: "Acme", role: "owner" }]);

    expect(await resolveSignedInDestination(cookies("good"))).toBe("/control?org=ws-1");
  });

  it("still sends them into the app when the workspace lookup fails", async () => {
    // The subtle half of the bug. The SESSION is valid; only the membership
    // query failed. Falling back to the sign-in form here turns a transient
    // database blip into a forced re-login.
    getAuthenticatedUser.mockResolvedValue({ sub: "user-1", email: "a@b.test" });
    getUserWorkspaces.mockRejectedValue(new Error("db unreachable"));

    expect(await resolveSignedInDestination(cookies("good"))).toBe("/control");
  });

  it("honours a site-relative `next`, so the original destination is not lost", async () => {
    getAuthenticatedUser.mockResolvedValue({ sub: "user-1", email: "a@b.test" });

    expect(await resolveSignedInDestination(cookies("good"), "/tools?create=1")).toBe("/tools?create=1");
    // The workspace lookup is not even reached when `next` decides it.
    expect(getUserWorkspaces).not.toHaveBeenCalled();
  });

  it("refuses an off-site `next`, so this cannot become an open redirect", async () => {
    getAuthenticatedUser.mockResolvedValue({ sub: "user-1", email: "a@b.test" });
    getUserWorkspaces.mockResolvedValue([{ id: "ws-1", name: "Acme", role: "owner" }]);

    // `//host` is protocol-relative and leaves the site, which is exactly the
    // shape a `startsWith("/")` check alone would let through.
    expect(await resolveSignedInDestination(cookies("good"), "//evil.test")).toBe("/control?org=ws-1");
    expect(await resolveSignedInDestination(cookies("good"), "https://evil.test")).toBe("/control?org=ws-1");
  });

  it("never throws — the callers redirect on its return value", async () => {
    // The whole point: anything that can throw is contained here, so the page
    // can call `redirect()` where nothing will catch NEXT_REDIRECT.
    getAuthenticatedUser.mockImplementation(() => {
      throw new Error("JWT_SECRET is not configured");
    });

    await expect(resolveSignedInDestination(cookies("anything"))).resolves.toBeNull();
  });
});
