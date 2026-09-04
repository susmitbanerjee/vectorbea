import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createFetchTransport } from "~/lib/api/transport";
import { onContractMismatch } from "~/lib/api/validate";

/**
 * Contract validation at the boundary.
 *
 * The failure this prevents: the API renames a field, the UI keeps reading the
 * old one, and the symptom is `undefined is not an object` inside a chart
 * component five layers from the fetch. These tests assert the mismatch is
 * caught at the boundary and names the field instead.
 */

const schema = z.object({
  id: z.string().uuid(),
  cost: z.number(),
});

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

function transportReturning(body: unknown, headers?: Record<string, string>) {
  return createFetchTransport({
    getToken: async () => "tok",
    baseUrl: "https://api.test",
    fetchImpl: (async () => jsonResponse(body, headers)) as unknown as typeof fetch,
  });
}

const VALID = { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", cost: 1.5 };

describe("contract validation", () => {
  it("passes a conforming response straight through", async () => {
    const transport = transportReturning(VALID);
    await expect(transport.request("/api/thing", { schema })).resolves.toEqual(VALID);
  });

  it("raises contract_mismatch, not a crash, when a field changes type", async () => {
    const transport = transportReturning({ ...VALID, cost: "1.50" });

    await expect(transport.request("/api/thing", { schema })).rejects.toMatchObject({
      code: "CONTRACT_MISMATCH",
      intent: "contract_mismatch",
      kind: "contract",
    });
  });

  it("names the offending field in the message", async () => {
    const transport = transportReturning({ ...VALID, cost: "1.50" });

    await expect(transport.request("/api/thing", { schema })).rejects.toThrow(/cost/);
  });

  it("is never retryable — a schema break does not heal on a second call", async () => {
    const transport = transportReturning({ ...VALID, cost: "1.50" });

    const error = await transport.request("/api/thing", { schema }).catch((e) => e);
    expect(error.isRetryable).toBe(false);
  });

  it("reports the full issue list with the server's request id", async () => {
    const seen: unknown[] = [];
    const unsubscribe = onContractMismatch((mismatch) => seen.push(mismatch));

    const transport = transportReturning(
      { id: "not-a-uuid", cost: "1.50" },
      { "X-Request-Id": "req-from-server" },
    );

    await transport.request("/api/thing", { schema }).catch(() => undefined);
    unsubscribe();

    expect(seen).toHaveLength(1);
    const mismatch = seen[0] as { requestId: string; issues: unknown[]; path: string };
    // The server's id, not the client-generated one: it is the id in the API's
    // own logs, which is where the mismatch actually gets diagnosed.
    expect(mismatch.requestId).toBe("req-from-server");
    expect(mismatch.path).toBe("GET /api/thing");
    expect(mismatch.issues.length).toBe(2); // both fields wrong, both reported
  });

  it("skips validation when no schema is supplied", async () => {
    const transport = transportReturning({ anything: true });
    await expect(transport.request("/api/thing")).resolves.toEqual({ anything: true });
  });

  it("does not fire the reporter on a conforming response", async () => {
    const reporter = vi.fn();
    const unsubscribe = onContractMismatch(reporter);

    await transportReturning(VALID).request("/api/thing", { schema });
    unsubscribe();

    expect(reporter).not.toHaveBeenCalled();
  });
});
