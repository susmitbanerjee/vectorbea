import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearAccessToken, getAccessToken, peekAccessToken, primeAccessToken } from "~/lib/auth/token";

/**
 * Single-flight refresh.
 *
 * The requirement is that concurrent 401s trigger exactly ONE refresh. With
 * twenty queries on a dashboard, the naive version fires twenty refreshes,
 * twenty rows hit the session endpoint, and nineteen of them are wasted work
 * racing each other to write the same token.
 */

const ORIGINAL_FETCH = globalThis.fetch;

function tokenResponse(token: string, expiresInMs = 3_600_000): Response {
  return new Response(
    JSON.stringify({
      token,
      expiresAt: Date.now() + expiresInMs,
      user: { id: "usr_1", email: "a@b.test" },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("access token provider", () => {
  beforeEach(() => {
    clearAccessToken();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("collapses concurrent refreshes into one fetch", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const gate = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });

    const spy = vi.fn(() => gate);
    globalThis.fetch = spy as unknown as typeof fetch;

    // Twenty callers arrive while nothing is cached — the 401 stampede.
    const callers = Array.from({ length: 20 }, () => getAccessToken({ forceRefresh: true }));

    resolveFetch(tokenResponse("tok_fresh"));
    const results = await Promise.all(callers);

    expect(spy).toHaveBeenCalledTimes(1);
    for (const result of results) expect(result?.token).toBe("tok_fresh");
  });

  it("serves a fresh cached token without fetching", async () => {
    const spy = vi.fn(async () => tokenResponse("tok_never_used"));
    globalThis.fetch = spy as unknown as typeof fetch;

    primeAccessToken({
      token: "tok_primed",
      expiresAt: Date.now() + 3_600_000,
      user: { id: "usr_1", email: "a@b.test" },
    });

    const result = await getAccessToken();
    expect(result?.token).toBe("tok_primed");
    expect(spy).not.toHaveBeenCalled();
  });

  it("refetches when the cached token is inside the refresh skew", async () => {
    const spy = vi.fn(async () => tokenResponse("tok_renewed"));
    globalThis.fetch = spy as unknown as typeof fetch;

    // Ten seconds left — inside the 60s skew, so it must not be served.
    primeAccessToken({
      token: "tok_expiring",
      expiresAt: Date.now() + 10_000,
      user: { id: "usr_1", email: "a@b.test" },
    });

    const result = await getAccessToken();
    expect(result?.token).toBe("tok_renewed");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("returns null on 401 rather than throwing, and caches nothing", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    await expect(getAccessToken({ forceRefresh: true })).resolves.toBeNull();
    expect(peekAccessToken()).toBeNull();
  });

  it("does not wedge future callers after a failed refresh", async () => {
    let call = 0;
    globalThis.fetch = (async () => {
      call += 1;
      if (call === 1) throw new TypeError("network down");
      return tokenResponse("tok_recovered");
    }) as unknown as typeof fetch;

    // The in-flight promise must be cleared in `finally`, or every later caller
    // awaits a permanently rejected promise.
    await expect(getAccessToken({ forceRefresh: true })).rejects.toThrow();
    await expect(getAccessToken({ forceRefresh: true })).resolves.toMatchObject({
      token: "tok_recovered",
    });
  });
});
