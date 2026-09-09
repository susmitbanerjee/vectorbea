import { describe, expect, it } from "vitest";
import { emptySpec, inputSchema, setIn, specProblems } from "~/lib/tools/http-spec";

describe("HTTP request editor", () => {
  it("offers model arguments by agent name and excludes bound values, including false and zero", () => {
    const spec = setIn(emptySpec(), ["request", "inputs"], [
      { name: "customerId", wireName: "id", in: "path", type: "string", required: true },
      { name: "limit", in: "query", type: "integer", default: 25 },
      { name: "tenant", in: "header", constant: "my-tenant", required: true },
      { name: "includeDeleted", in: "query", constant: false },
      { name: "offset", in: "query", constant: 0 },
    ]);
    expect(inputSchema(spec)).toEqual({
      type: "object",
      properties: { customerId: { type: "string" }, limit: { type: "integer", default: 25 } },
      required: ["customerId"],
    });
  });

  it("detects missing path mappings and accepts the wire name", () => {
    const spec = setIn(emptySpec(), ["request", "path"], "/customers/{id}");
    expect(specProblems(spec)).toHaveLength(1);
    expect(specProblems(setIn(spec, ["request", "inputs"], [
      { name: "customerId", wireName: "id", in: "path", required: true },
    ]))).toEqual([]);
  });

  it("preserves newer resolver fields when editing a request", () => {
    const spec = { ...emptySpec(), async: { mode: "callback" }, request: { method: "POST", path: "/jobs", futureOption: true } };
    expect(setIn(spec, ["request", "path"], "/v2/jobs")).toEqual({
      ...spec, request: { ...spec.request, path: "/v2/jobs" },
    });
  });
});
