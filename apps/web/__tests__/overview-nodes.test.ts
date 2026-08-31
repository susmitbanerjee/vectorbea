import { describe, expect, it } from "vitest";
import { collectNodes, labelFor, widthFor } from "~/components/app/debug/overview-view";
import type { TraceSpan } from "~/lib/api/trace";

/**
 * Rule 1 and rule 3 of the Debug tab rules, as tests.
 *
 * Both were violated by code that looked right: the run map iterated the span
 * array to produce cards, so a node that yielded twice appeared three times; and
 * every card was `w-44`, so a 1ms transform and a 65s model call were the same
 * size. Neither is visible in a screenshot of a healthy single-tick run, which
 * is why they survived — and why the grouping and the scale are pulled out as
 * pure functions and asserted here rather than eyeballed.
 */

let n = 0;
function span(p: Partial<TraceSpan> & { kind: string }): TraceSpan {
  n += 1;
  return {
    spanId: p.spanId ?? `span-${n}`,
    parentSpanId: p.parentSpanId ?? null,
    kind: p.kind as TraceSpan["kind"],
    name: p.name ?? "node",
    status: (p.status ?? "ok") as TraceSpan["status"],
    stepId: p.stepId ?? null,
    iterationIndex: null,
    startedAt: p.startedAt ?? "2026-08-31T10:00:00.000Z",
    endedAt: null,
    durationMs: p.durationMs ?? null,
    selfMs: null,
    failureClass: null,
    isRootCause: false,
    hasInput: false,
    hasOutput: false,
    tokensIn: null,
    tokensOut: null,
    costCents: null,
    childCount: p.children?.length ?? 0,
    children: p.children ?? [],
    truncated: false,
  };
}

describe("collectNodes — one card per graph node", () => {
  /**
   * The bug, precisely. A cooperative yield ends the tick and the node resumes
   * on the next one; each execution is its own `step` span with its own span id
   * but the SAME `stepId`. Rendering the array gave three cards.
   */
  it("folds every execution of one node into a single entry", () => {
    const tree = [
      span({
        kind: "tick",
        children: [
          span({ kind: "step", stepId: "n-agent-1", name: "Research", durationMs: 900,
                 startedAt: "2026-08-31T10:00:00.000Z" }),
        ],
      }),
      span({
        kind: "tick",
        children: [
          span({ kind: "step", stepId: "n-agent-1", name: "Research", durationMs: 1_100,
                 startedAt: "2026-08-31T10:00:05.000Z" }),
        ],
      }),
      span({
        kind: "tick",
        children: [
          span({ kind: "step", stepId: "n-agent-1", name: "Research", durationMs: 400,
                 startedAt: "2026-08-31T10:00:09.000Z" }),
        ],
      }),
    ];

    const nodes = collectNodes(tree);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.attempts).toBe(3);
    /* Summed: the node cost the run 2.4s across its three executions, and the
       map is where somebody looks to find where the time went. */
    expect(nodes[0]!.totalMs).toBe(2_400);
    // Selection and root-cause matching have to cover every attempt, not just one.
    expect(nodes[0]!.spanIds).toHaveLength(3);
  });

  it("keeps distinct nodes distinct and in execution order", () => {
    const nodes = collectNodes([
      span({ kind: "step", stepId: "n-1", name: "Fetch", durationMs: 10 }),
      span({ kind: "step", stepId: "n-2", name: "Transform", durationMs: 20 }),
      span({ kind: "step", stepId: "n-1", name: "Fetch", durationMs: 30 }),
    ]);
    expect(nodes.map((x) => x.nodeKey)).toEqual(["n-1", "n-2"]);
    expect(nodes[0]!.attempts).toBe(2);
  });

  /**
   * Merging two unrelated nodes is a worse failure than an ungrouped duplicate:
   * the duplicate is visible, the merge silently attributes one node's time and
   * status to another.
   */
  it("never merges spans that have no stepId", () => {
    const nodes = collectNodes([
      span({ kind: "step", stepId: null, name: "A", durationMs: 5 }),
      span({ kind: "step", stepId: null, name: "B", durationMs: 5 }),
    ]);
    expect(nodes).toHaveLength(2);
  });

  it("takes status from the last attempt, not the first", () => {
    const nodes = collectNodes([
      span({ kind: "step", stepId: "n-1", status: "error", durationMs: 9_000,
             startedAt: "2026-08-31T10:00:00.000Z" }),
      span({ kind: "step", stepId: "n-1", status: "ok", durationMs: 1_000,
             startedAt: "2026-08-31T10:00:10.000Z" }),
    ]);
    expect(nodes[0]!.span.status).toBe("ok");
    expect(nodes[0]!.recovered).toBe(true);
    expect(nodes[0]!.totalMs).toBe(10_000);
  });

  it("does not claim recovery when the node ended up failing", () => {
    const nodes = collectNodes([
      span({ kind: "step", stepId: "n-1", status: "error", startedAt: "2026-08-31T10:00:00.000Z" }),
      span({ kind: "step", stepId: "n-1", status: "error", startedAt: "2026-08-31T10:00:10.000Z" }),
    ]);
    expect(nodes[0]!.recovered).toBe(false);
    expect(nodes[0]!.attempts).toBe(2);
  });

  /** A node that ran once and was skipped on a later pass WAS reached. */
  it("only calls a node unreached when no attempt ran", () => {
    expect(
      collectNodes([
        span({ kind: "step", stepId: "n-1", status: "skipped" }),
        span({ kind: "step", stepId: "n-1", status: "skipped" }),
      ])[0]!.unreached,
    ).toBe(true);

    expect(
      collectNodes([
        span({ kind: "step", stepId: "n-1", status: "ok", startedAt: "2026-08-31T10:00:00.000Z" }),
        span({ kind: "step", stepId: "n-1", status: "skipped", startedAt: "2026-08-31T10:00:10.000Z" }),
      ])[0]!.unreached,
    ).toBe(false);
  });

  it("collects the model and tool calls from every attempt", () => {
    const nodes = collectNodes([
      span({
        kind: "step", stepId: "n-1", startedAt: "2026-08-31T10:00:00.000Z",
        children: [span({ kind: "llm_call", name: "gpt-4o" }), span({ kind: "iteration" })],
      }),
      span({
        kind: "step", stepId: "n-1", startedAt: "2026-08-31T10:00:10.000Z",
        children: [span({ kind: "tool_call", name: "search" })],
      }),
    ]);
    expect(nodes[0]!.children.map((c) => c.kind)).toEqual(["llm_call", "tool_call"]);
  });

  it("has nothing to show for a run with no steps", () => {
    expect(collectNodes([span({ kind: "run", children: [span({ kind: "tick" })] })])).toEqual([]);
  });
});

describe("widthFor — duration is spatial", () => {
  /** The rule, stated as the assertion: these must not be the same size. */
  it("a 1ms step and a 65s step are different sizes", () => {
    const slow = widthFor(65_000, false, 65_000);
    const fast = widthFor(1, false, 65_000);
    expect(slow).toBeGreaterThan(fast);
    expect(slow - fast).toBeGreaterThanOrEqual(96);
  });

  /**
   * The reason it is a square root. Under a linear map against a dominant node,
   * everything below it collapses onto the floor and is the same size again —
   * which is the failure the rule exists to prevent, reintroduced.
   */
  it("keeps small steps separable under one dominant step", () => {
    const slowest = 600_000; // ten minutes
    const a = widthFor(3, false, slowest);
    const b = widthFor(400, false, slowest);
    const c = widthFor(4_000, false, slowest);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it("clamps at both ends and never leaves the 4px lattice", () => {
    for (const ms of [0, 1, 250, 9_999, 600_000]) {
      const w = widthFor(ms, false, 600_000);
      expect(w).toBeGreaterThanOrEqual(96);
      expect(w).toBeLessThanOrEqual(288);
      expect(w % 4).toBe(0);
    }
  });

  /** An unreached node has no duration to encode, and must stay clickable. */
  it("gives unreached and unmeasured steps the readable minimum", () => {
    expect(widthFor(null, false, 1_000)).toBe(96);
    expect(widthFor(5_000, true, 5_000)).toBe(96);
    expect(widthFor(500, false, 0)).toBe(96);
  });
});

describe("labelFor — never a bare type", () => {
  /** The builder named the node. Nothing else is consulted. */
  it("prefers the node's own label", () => {
    const s = span({ kind: "step", stepId: "1a2b3c4d-9999", name: "Enrich the lead" });
    expect(labelFor(s, [span({ kind: "activation", name: "researcher" })])).toBe(
      "Enrich the lead",
    );
  });

  /**
   * The common case for an agent node: the builder never named it, so the worker
   * fell back to `agent:1a2b3c4d`. "Agent" tells nobody which agent — the
   * activation span hanging under this step does.
   */
  it("falls back to the agent name when the worker generated the label", () => {
    const s = span({ kind: "step", stepId: "1a2b3c4d-9999", name: "agent:1a2b3c4d" });
    expect(labelFor(s, [span({ kind: "activation", name: "Lead researcher" })])).toBe(
      "Lead researcher",
    );
  });

  it("falls back to type and id when there is no agent either", () => {
    const s = span({ kind: "step", stepId: "1a2b3c4d-9999", name: "http:1a2b3c4d" });
    // type AND id, per the rule. A bare "http" identifies nothing on a workflow
    // with four HTTP nodes, which is the case that makes the rule matter.
    expect(labelFor(s, [])).toBe("http · 1a2b3c4d");
    expect(labelFor(s, [])).not.toBe("http");
  });

  /**
   * A real label that happens to end in a colon-and-eight-characters must not be
   * mistaken for the generated one — which is why the match is against the
   * node's OWN id rather than a regex for the shape.
   */
  it("does not mistake a real label for the generated one", () => {
    const s = span({ kind: "step", stepId: "1a2b3c4d-9999", name: "Notify: everyone" });
    expect(labelFor(s, [span({ kind: "activation", name: "agent" })])).toBe("Notify: everyone");
  });

  it("leaves the name alone when there is no stepId to compare against", () => {
    expect(labelFor(span({ kind: "step", stepId: null, name: "whatever" }), [])).toBe("whatever");
  });
});
