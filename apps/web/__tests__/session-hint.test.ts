import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { middleware } from "@/middleware";
import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";

/**
 * THE SESSION HINT.
 *
 * The session cookie is httpOnly, so the landing page and the docs — both
 * statically prerendered, both outside `SessionProvider` — had no way to tell a
 * signed-in visitor from a stranger. They offered "Sign in" and "Start free" to
 * people who had been signed in for a week, which reads as the product having
 * forgotten them.
 *
 * The middleware mirrors the session's PRESENCE into a readable boolean. These
 * tests pin the three properties that make that safe and cheap:
 *
 *   - it carries no identity, only "1";
 *   - it is written only when it disagrees with the session, so a page view does
 *     not drag a redundant Set-Cookie along; and
 *   - it is cleared the moment the session cookie is gone, so signing out does
 *     not leave a landing page claiming otherwise.
 *
 * It is NOT an authorisation input. `enforceAuth` is tested here against the
 * hint alone precisely to prove that forging it buys nothing.
 */

const HINT = "vb_signed_in";

function request(path: string, cookies: Record<string, string> = {}) {
  const req = new NextRequest(new URL(path, "https://vectorbea.test"));
  for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value);
  return req;
}

/** The hint the response sets, or `undefined` when it sets none. */
function hintWrite(response: Awaited<ReturnType<typeof middleware>>) {
  return response.cookies.get(HINT);
}

describe("session hint", () => {
  it("is set when a session cookie arrives without one", async () => {
    const response = await middleware(request("/", { [AUTH_COOKIE_NAME]: "jwt" }));

    const written = hintWrite(response);
    expect(written?.value).toBe("1");
    // Readable on purpose — a page has to be able to see it.
    expect(written?.httpOnly).toBe(false);
  });

  it("carries nothing but the boolean", async () => {
    const response = await middleware(request("/", { [AUTH_COOKIE_NAME]: "a.real.jwt" }));

    // The guarantee that makes a readable cookie acceptable at all: no user id,
    // no email, no fragment of the token.
    expect(hintWrite(response)?.value).toBe("1");
    expect(hintWrite(response)?.value).not.toContain("jwt");
  });

  it("is not written again when it already agrees with the session", async () => {
    const response = await middleware(
      request("/docs", { [AUTH_COOKIE_NAME]: "jwt", [HINT]: "1" }),
    );

    // Otherwise every page view and every asset request would carry a redundant
    // Set-Cookie for no change in state.
    expect(hintWrite(response)).toBeUndefined();
  });

  it("is not written for an anonymous visitor who never had one", async () => {
    const response = await middleware(request("/"));

    expect(hintWrite(response)).toBeUndefined();
  });

  it("is cleared when the session cookie is gone", async () => {
    const response = await middleware(request("/", { [HINT]: "1" }));

    const written = hintWrite(response);
    expect(written?.value).toBe("");
    expect(written?.maxAge).toBe(0);
  });

  it("is cleared on the redirect away from a protected path", async () => {
    // Signing out and landing back on /control produces a redirect, and that
    // response is the one carrying the stale hint. Clearing it only on the
    // non-redirect branch would leave the marketing site claiming a session
    // that had just ended.
    const response = await middleware(request("/control", { [HINT]: "1" }));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/signin");
    expect(hintWrite(response)?.value).toBe("");
  });

  it("grants nothing — a forged hint does not pass the auth gate", async () => {
    const response = await middleware(request("/workflows", { [HINT]: "1" }));

    // The gate reads the httpOnly cookie and only that.
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/signin");
  });
});
