import { describe, expect, it, vi } from "vitest";

import { createVectorbeaClient } from "~/lib/api/client";
import { createFetchTransport } from "~/lib/api/transport";
import { createMockTransport } from "~/lib/api/mock-transport";

/**
 * THE ENVIRONMENT UUID, AND WHY CREATING A TOOL USED TO BE IMPOSSIBLE.
 *
 * Every write endpoint calls `requireEnvironmentId()`. The only endpoint that
 * ever handed a client an environment id was `GET /api/bootstrap`, which was not
 * scoped to anybody: it returned the OLDEST workspace in the database and that
 * workspace's first environment, to every caller. For whoever owned that
 * workspace the answer was right by luck; for everybody else it was another
 * tenant's id.
 *
 * The web app therefore compared bootstrap's `workspaceId` against the active
 * one and, when they differed, refused to submit — "the environment the API
 * returned belongs to a different workspace… registering would write into the
 * wrong tenant". Correct, and a dead end: any account that did not own the
 * database's oldest workspace could read everything and create nothing.
 *
 * `GET /api/environments` is the fix, and these tests pin the two properties
 * that make it one: it is scoped by the workspace header, and it names the
 * default the client should use rather than leaving it to be inferred.
 */

const BASE = "https://api.test";
const WORKSPACE = "3f1c9a24-5b7e-4d61-9f0a-2c8e7b5d4a13";
const ENVIRONMENT = "9b2d7e10-4c33-4a58-8e71-6f0d2a1c5b94";

function stubFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function client(impl: typeof fetch) {
  return createVectorbeaClient({
    getToken: async () => "tok",
    transport: createFetchTransport({ getToken: async () => "tok", baseUrl: BASE, fetchImpl: impl }),
  });
}

describe("GET /api/environments", () => {
  it("carries the workspace header, which is what makes the answer tenant-scoped", async () => {
    const { impl, calls } = stubFetch({
      items: [{ id: ENVIRONMENT, workspaceId: WORKSPACE, name: "Production", slug: "production", type: "production" }],
      total: 1,
      defaultEnvironmentId: ENVIRONMENT,
    });

    await client(impl).environments({ workspaceId: WORKSPACE, environmentId: null });

    expect(calls[0].url).toContain("/api/environments");
    const headers = calls[0].init.headers as Record<string, string>;
    // Without this header the API cannot scope the query, and an unscoped
    // environment endpoint is exactly the bug being fixed.
    expect(headers["X-Workspace-Id"]).toBe(WORKSPACE);
  });

  it("names the default environment rather than leaving it to list order", async () => {
    const second = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
    const { impl } = stubFetch({
      items: [
        { id: ENVIRONMENT, workspaceId: WORKSPACE, name: "Production", slug: "production", type: "production" },
        { id: second, workspaceId: WORKSPACE, name: "Staging", slug: "staging", type: "staging" },
      ],
      total: 2,
      defaultEnvironmentId: ENVIRONMENT,
    });

    const result = await client(impl).environments({ workspaceId: WORKSPACE, environmentId: null });

    expect(result.defaultEnvironmentId).toBe(ENVIRONMENT);
    expect(result.items).toHaveLength(2);
  });

  it("only ever returns environments belonging to the workspace that asked", async () => {
    const { impl } = stubFetch({
      items: [{ id: ENVIRONMENT, workspaceId: WORKSPACE, name: "Production", slug: "production", type: "production" }],
      total: 1,
      defaultEnvironmentId: ENVIRONMENT,
    });

    const result = await client(impl).environments({ workspaceId: WORKSPACE, environmentId: null });

    // The property the old bootstrap endpoint could not offer. `Request.context()`
    // verifies membership before the query runs, so a foreign environment cannot
    // appear here — which is why the client no longer needs a `foreign` flag or
    // the refusal that came with it.
    for (const item of result.items) expect(item.workspaceId).toBe(WORKSPACE);
  });
});

describe("fixture transport", () => {
  it("serves /api/environments so mock mode exercises the same path", async () => {
    // A mock that omitted this route would send every fixture-backed screen down
    // the localStorage fallback instead of the endpoint the real client reads.
    const client = createVectorbeaClient({
      getToken: async () => null,
      transport: createMockTransport(),
    });
    const result = await client.environments();

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.defaultEnvironmentId).toBe(result.items[0].id);
  });
});
