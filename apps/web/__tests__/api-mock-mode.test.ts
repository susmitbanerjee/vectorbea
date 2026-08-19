import { afterEach, describe, expect, it, vi } from "vitest";

import { createVectorbeaClient } from "~/lib/api/client";

/**
 * Mock mode swaps the TRANSPORT and nothing else.
 *
 * The claim these tests defend is the one that keeps `if (isMock)` out of
 * component code: the client's surface, types and call sites are identical in
 * both modes, and the only thing that changes is what answers the request.
 */

describe("mock mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("serves fixtures without ever calling fetch", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "mock");

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const client = createVectorbeaClient({ getToken: async () => null });

    const runs = await client.runs.list({ pageSize: 5 });
    expect(runs.items.length).toBeGreaterThan(0);
    expect(runs.items.length).toBeLessThanOrEqual(5);
    expect(runs.total).toBeGreaterThan(0);
    // The mock is validated against the same contract as a live response, so a
    // passing call here proves the fixtures still match the schema.
    expect(runs.items[0].workflowId).toMatch(/^[0-9a-f-]{36}$/);

    const workflows = await client.workflows.list();
    expect(workflows.items.length).toBeGreaterThan(0);

    // The whole point: no network, no token, no API URL required.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns a single record by id, and 404s an unknown one through the taxonomy", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "mock");
    const client = createVectorbeaClient({ getToken: async () => null });

    const { items } = await client.runs.list();
    const first = items[0];

    await expect(client.runs.get(first.id)).resolves.toMatchObject({ id: first.id });

    // Failure shape matches live mode, so not-found states are exercised too.
    await expect(client.runs.get("run_does_not_exist")).rejects.toMatchObject({
      intent: "not_found",
      code: "NOT_FOUND",
    });
  });

  it("uses the network transport when the mode is live", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "live");
    vi.stubEnv("NEXT_PUBLIC_VECTORBEA_API_URL", "https://api.test");

    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 20 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const client = createVectorbeaClient({ getToken: async () => "tok" });
    await client.runs.list();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("https://api.test/api/runs");
  });
});
