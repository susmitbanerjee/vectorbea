import { describe, expect, it, vi } from "vitest";

import { createFetchTransport } from "~/lib/api/transport";
import { VectorbeaApiError } from "~/lib/api/errors";

/**
 * Transport behaviour.
 *
 * These cover the rules that are easy to state and easy to get wrong: what gets
 * retried, what does not, and what happens around a 401. They are the reason
 * the retry policy can live in one layer and be trusted there.
 */

const BASE = "https://api.test";

/** A fetch stub that replays a queue of responses and records every call. */
function stubFetch(responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("stubFetch: ran out of queued responses");
    if (next instanceof Error) throw next;
    return next;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function errorBody(code: string, message: string, requestId = "req-1", details?: unknown) {
  return { error: { code, message, requestId, details } };
}

/** A real UUID: the transport sends the environment header only for these. */
const ENVIRONMENT_UUID = "3f1c9a24-5b7e-4d61-9f0a-2c8e7b5d4a13";

describe("fetch transport", () => {
  it("attaches the bearer token, request id and scope headers", async () => {
    const { impl, calls } = stubFetch([json({ ok: true })]);
    const transport = createFetchTransport({
      getToken: async () => "tok_abc",
      baseUrl: BASE,
      fetchImpl: impl,
    });

    await transport.request("/api/runs", {
      workspaceId: "ws_1",
      environmentId: ENVIRONMENT_UUID,
    });

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok_abc");
    expect(headers["X-Workspace-Id"]).toBe("ws_1");
    expect(headers["X-Environment-Id"]).toBe(ENVIRONMENT_UUID);
    expect(headers["X-Request-Id"]).toBeTruthy();
  });

  /**
   * THE ENVIRONMENT HEADER IS UUID-GATED, AND THAT IS LOAD-BEARING.
   *
   * The workspace provider carries the environment as a SLUG ("development")
   * for display and URL state. Sending that verbatim made the API reject every
   * workspace-scoped request with `400 X-Environment-Id must be a valid UUID`,
   * so the transport omits anything that is not one.
   *
   * The consequence is easy to trip over and was: omitting the header is fine
   * on a read, which degrades to workspace scope, and fatal on a write, because
   * `requireEnvironmentId()` refuses outright. A caller that needs to write must
   * resolve a real UUID first — see `useEnvironmentUuid`. Both halves are
   * asserted here so neither can drift.
   */
  it("omits the environment header unless it is a UUID", async () => {
    const { impl, calls } = stubFetch([json({ ok: true }), json({ ok: true })]);
    const transport = createFetchTransport({
      getToken: async () => "tok_abc",
      baseUrl: BASE,
      fetchImpl: impl,
    });

    // A slug, which is what the provider holds for display.
    await transport.request("/api/runs", { workspaceId: "ws_1", environmentId: "development" });
    expect((calls[0].init.headers as Record<string, string>)["X-Environment-Id"]).toBeUndefined();

    // Nothing resolved at all.
    await transport.request("/api/runs", { workspaceId: "ws_1", environmentId: null });
    expect((calls[1].init.headers as Record<string, string>)["X-Environment-Id"]).toBeUndefined();
  });

  it("maps API error codes to UI intent, not to status", async () => {
    const cases: [string, number, string][] = [
      ["UNAUTHORIZED", 401, "unauthenticated"],
      ["FORBIDDEN", 403, "forbidden"],
      ["NOT_FOUND", 404, "not_found"],
      ["VALIDATION_ERROR", 400, "validation"],
      ["CONFLICT", 409, "validation"],
      ["TOO_MANY_REQUESTS", 429, "rate_limited"],
      ["WORKSPACE_CONCURRENCY_LIMIT", 429, "quota_exceeded"],
      ["QUEUE_SATURATED", 503, "upstream_unavailable"],
      ["INTERNAL_ERROR", 500, "unknown"],
    ];

    for (const [code, status, intent] of cases) {
      // 502/503/504 are retried on GET, so queue enough responses to let the
      // budget run out and the real error surface rather than a stub underrun.
      const attempts = status === 503 ? 3 : 1;
      const { impl } = stubFetch(
        Array.from({ length: attempts }, () => json(errorBody(code, "nope"), status)),
      );
      const transport = createFetchTransport({
        // No refresh available, so a 401 surfaces rather than looping.
        getToken: async () => null,
        baseUrl: BASE,
        fetchImpl: impl,
      });

      await expect(transport.request("/api/runs")).rejects.toMatchObject({
        code,
        intent,
        requestId: "req-1",
      });
    }
  });

  it("never retries a 4xx", async () => {
    const { impl, calls } = stubFetch([json(errorBody("VALIDATION_ERROR", "bad"), 400)]);
    const transport = createFetchTransport({
      getToken: async () => "tok",
      baseUrl: BASE,
      fetchImpl: impl,
    });

    await expect(transport.request("/api/runs")).rejects.toBeInstanceOf(VectorbeaApiError);
    expect(calls).toHaveLength(1);
  });

  it("retries a 503 on GET and succeeds on a later attempt", async () => {
    const { impl, calls } = stubFetch([
      json(errorBody("SERVICE_UNAVAILABLE", "down"), 503),
      json(errorBody("SERVICE_UNAVAILABLE", "down"), 503),
      json({ runs: [], total: 0 }),
    ]);
    const transport = createFetchTransport({
      getToken: async () => "tok",
      baseUrl: BASE,
      fetchImpl: impl,
    });

    await expect(transport.request("/api/runs")).resolves.toEqual({ runs: [], total: 0 });
    expect(calls).toHaveLength(3);
  });

  it("does not retry a POST unless the caller opts in", async () => {
    const { impl, calls } = stubFetch([json(errorBody("SERVICE_UNAVAILABLE", "down"), 503)]);
    const transport = createFetchTransport({
      getToken: async () => "tok",
      baseUrl: BASE,
      fetchImpl: impl,
    });

    await expect(
      transport.request("/api/workflows/w1/run", { method: "POST", body: {} }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(calls).toHaveLength(1);
  });

  it("retries a POST when the caller opts in", async () => {
    const { impl, calls } = stubFetch([
      json(errorBody("SERVICE_UNAVAILABLE", "down"), 503),
      json({ runId: "run_1" }),
    ]);
    const transport = createFetchTransport({
      getToken: async () => "tok",
      baseUrl: BASE,
      fetchImpl: impl,
    });

    await expect(
      transport.request("/api/workflows/w1/run", {
        method: "POST",
        body: {},
        retryOnMutation: true,
      }),
    ).resolves.toEqual({ runId: "run_1" });
    expect(calls).toHaveLength(2);
  });

  it("refreshes once on 401 and replays with the new token", async () => {
    const { impl, calls } = stubFetch([
      json(errorBody("UNAUTHORIZED", "expired"), 401),
      json({ ok: true }),
    ]);

    const tokens = ["stale", "fresh"];
    const getToken = vi.fn(async ({ forceRefresh }: { forceRefresh: boolean }) =>
      forceRefresh ? tokens[1] : tokens[0],
    );

    const onSessionExpired = vi.fn();
    const transport = createFetchTransport({
      getToken,
      onSessionExpired,
      baseUrl: BASE,
      fetchImpl: impl,
    });

    await expect(transport.request("/api/me")).resolves.toEqual({ ok: true });

    expect(calls).toHaveLength(2);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer stale");
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe("Bearer fresh");
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("ends the session when a second 401 follows a refresh", async () => {
    const { impl, calls } = stubFetch([
      json(errorBody("UNAUTHORIZED", "expired"), 401),
      json(errorBody("UNAUTHORIZED", "still expired"), 401),
    ]);

    const onSessionExpired = vi.fn();
    const transport = createFetchTransport({
      getToken: async () => "tok",
      onSessionExpired,
      baseUrl: BASE,
      fetchImpl: impl,
    });

    await expect(transport.request("/api/me")).rejects.toMatchObject({
      intent: "unauthenticated",
    });
    expect(calls).toHaveLength(2);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("surfaces a network fault as upstream_unavailable after exhausting retries", async () => {
    const { impl, calls } = stubFetch([
      new TypeError("fetch failed"),
      new TypeError("fetch failed"),
      new TypeError("fetch failed"),
    ]);
    const transport = createFetchTransport({
      getToken: async () => "tok",
      baseUrl: BASE,
      fetchImpl: impl,
    });

    await expect(transport.request("/api/runs")).rejects.toMatchObject({
      kind: "network",
      intent: "upstream_unavailable",
    });
    expect(calls).toHaveLength(3);
  });

  it("carries Retry-After and structured details onto the error", async () => {
    const { impl } = stubFetch([
      json(
        errorBody("WORKSPACE_CONCURRENCY_LIMIT", "at capacity", "req-9", {
          limit: 8,
          active: 8,
          queued: 12,
        }),
        429,
        { "Retry-After": "30" },
      ),
    ]);
    const transport = createFetchTransport({
      getToken: async () => "tok",
      baseUrl: BASE,
      fetchImpl: impl,
    });

    await expect(transport.request("/api/runs")).rejects.toMatchObject({
      intent: "quota_exceeded",
      retryAfterSeconds: 30,
      requestId: "req-9",
      details: { limit: 8, active: 8, queued: 12 },
    });
  });
});
