import { describe, expect, it } from "vitest";

import { compileRunQuery, describeUnsupported } from "~/lib/api/query-compile";

/**
 * Query bar → API parameters.
 *
 * The assertions that matter are the negative ones: a term the server cannot
 * filter must end up in `unsupported`, NOT silently applied client-side. A
 * client-side filter over one server page produces a table that is wrong rather
 * than incomplete, and says nothing about it.
 */

const resolveWorkflowId = (fragment: string) =>
  fragment === "renewals" ? "3f2504e0-4f89-41d3-9a0c-0305e82c3301" : null;

describe("compileRunQuery", () => {
  it("pushes status down, translating the vocabulary", () => {
    // The query bar says `succeeded`; agent_runs.status says `completed`.
    expect(compileRunQuery("status:succeeded").params.status).toBe("completed");
    expect(compileRunQuery("status:awaiting-approval").params.status).toBe("awaiting_approval");
    expect(compileRunQuery("status:failed").params.status).toBe("failed");
  });

  it("resolves a workflow name to an id", () => {
    const compiled = compileRunQuery("workflow:renewals", { resolveWorkflowId });
    expect(compiled.params.workflowId).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
    expect(compiled.unsupported).toHaveLength(0);
  });

  it("reports an unresolvable workflow rather than dropping the filter", () => {
    const compiled = compileRunQuery("workflow:nope", { resolveWorkflowId });
    expect(compiled.params.workflowId).toBeUndefined();
    expect(compiled.unsupported.map((u) => u.key)).toEqual(["workflow"]);
  });

  it("does NOT apply filters the API cannot express", () => {
    // Note `cost>0.01`, not `cost:>0.01` — the latter is a syntax error in this
    // grammar and surfaces through `errors` instead.
    const compiled = compileRunQuery("since:24h cost>0.01 env:production trigger:schedule");

    // Nothing was invented.
    expect(compiled.params.status).toBeUndefined();
    expect(compiled.params.workflowId).toBeUndefined();

    // Everything was declared.
    expect(compiled.unsupported.map((u) => u.key).sort()).toEqual([
      "cost",
      "env",
      "since",
      "trigger",
    ]);
  });

  it("compiles the supported half of a mixed query and reports the rest", () => {
    const compiled = compileRunQuery("status:failed workflow:renewals since:24h", {
      resolveWorkflowId,
      page: 2,
      pageSize: 50,
    });

    expect(compiled.params).toEqual({
      page: 2,
      pageSize: 50,
      status: "failed",
      workflowId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });
    expect(compiled.unsupported.map((u) => u.key)).toEqual(["since"]);
  });

  it("treats bare text as unsupported, not as a client-side scan", () => {
    const compiled = compileRunQuery("renewals");
    expect(compiled.unsupported[0].key).toBe("text");
  });

  it("does not apply a term the parser rejected", () => {
    // `status` accepts only `:`. The parser catches this, so it reaches the user
    // as an inline syntax error rather than as an unsupported-filter notice —
    // two different problems, two different messages. What must NOT happen is
    // the filter being quietly applied as equality.
    const compiled = compileRunQuery("status>failed");
    expect(compiled.params.status).toBeUndefined();
    expect(compiled.errors.length).toBeGreaterThan(0);
  });

  it("passes parse errors through for highlighting", () => {
    const compiled = compileRunQuery("bogus:value");
    expect(compiled.errors.length).toBeGreaterThan(0);
  });

  it("names the missing filters in the sentence shown to the user", () => {
    const compiled = compileRunQuery("since:24h cost>0.01");
    const sentence = describeUnsupported(compiled.unsupported);
    expect(sentence).toContain("since");
    expect(sentence).toContain("cost");
    expect(describeUnsupported([])).toBeNull();
  });
});
