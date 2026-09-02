import { describe, expect, it } from "vitest";
import {
  budgetFormat, budgetLabel, diffLines,
} from "~/components/app/debug/iterations-view";

/**
 * The prompt diff.
 *
 * ── WHY THIS IS THE FASTEST ROUTE TO THE ANSWER ─────────────────────────────
 * "The model never got the data it needed" is the most common agent failure and
 * the hardest to see: the prompt looks plausible, the response looks plausible,
 * and the missing observation is one line among four hundred. Diffing two
 * iterations' prompts turns that into a single line of output.
 *
 * Which is why the SUMMARY matters as much as the diff: 400 unchanged lines
 * scrolled past is the same failure the diff was meant to fix.
 */

describe("prompt diff", () => {
  /**
   * ACCEPTANCE: the diff identifies a single changed observation between two
   * prompts.
   */
  it("finds the one observation that was added", () => {
    const before = [
      "SYSTEM: You are a research assistant.",
      "TASK: Find the account owner for A-8891.",
      "OBSERVATIONS:",
      "  1. THINK: I should look up the account.",
    ].join("\n");
    const after = [
      "SYSTEM: You are a research assistant.",
      "TASK: Find the account owner for A-8891.",
      "OBSERVATIONS:",
      "  1. THINK: I should look up the account.",
      "  2. CALL_TOOL crm.search: HTTP 403 token expired",
    ].join("\n");

    const d = diffLines(before, after);
    expect(d.added).toEqual(["  2. CALL_TOOL crm.search: HTTP 403 token expired"]);
    expect(d.removed).toEqual([]);
    expect(d.unchanged).toBe(4);
  });

  /**
   * The reverse case, which is the one that actually explains a failure: an
   * observation the earlier prompt had and the later one does not, because the
   * context assembler dropped it to fit.
   */
  it("finds the observation that was dropped", () => {
    const before = ["A", "B", "C", "D"].join("\n");
    const after = ["A", "C", "D"].join("\n");
    const d = diffLines(before, after);
    expect(d.removed).toEqual(["B"]);
    expect(d.added).toEqual([]);
  });

  /** Identical prompts say so, rather than rendering an empty diff. */
  it("reports identical prompts as unchanged", () => {
    const text = ["A", "B", "C"].join("\n");
    const d = diffLines(text, text);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.unchanged).toBe(3);
  });

  /**
   * Repeated lines are counted, not deduplicated.
   *
   * A prompt that lists the same observation twice and then once is a real
   * change — with a Set the second occurrence would vanish and the diff would
   * claim nothing happened.
   */
  it("counts duplicate lines rather than collapsing them", () => {
    const before = ["x", "x", "y"].join("\n");
    const after = ["x", "y"].join("\n");
    const d = diffLines(before, after);
    expect(d.removed).toEqual(["x"]);
    expect(d.added).toEqual([]);
    expect(d.unchanged).toBe(2);
  });

  /** A moved line is unchanged content, not an add and a remove. */
  it("treats a reordered line as unchanged", () => {
    const d = diffLines("A\nB\nC", "C\nB\nA");
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.unchanged).toBe(3);
  });

  /** Empty on either side degrades rather than throwing. */
  it("survives an empty prompt", () => {
    expect(diffLines("", "A")).toMatchObject({ added: ["A"], removed: [""] });
    expect(diffLines("A", "")).toMatchObject({ added: [""], removed: ["A"] });
  });

  /**
   * The summary is what the reader actually uses on a real prompt, so it has to
   * hold at real size: one line changed out of hundreds.
   */
  it("summarises a single change in a large prompt", () => {
    const base = Array.from({ length: 400 }, (_, i) => `line ${i}`);
    const changed = [...base];
    changed[271] = "line 271 — OBSERVATION: crm.search returned 403";

    const d = diffLines(base.join("\n"), changed.join("\n"));
    expect(d.added).toHaveLength(1);
    expect(d.removed).toHaveLength(1);
    expect(d.unchanged).toBe(399);
  });
});

// ── Budget labels and units ─────────────────────────────────────────────────

describe("budget gauges", () => {
  /**
   * The dimension names come from the worker's own JSON, so both `costCents`
   * and `max_iterations` turn up. "CostCents" on screen is a field name leaking
   * into the interface.
   */
  it("turns a field name into a label", () => {
    expect(budgetLabel("costCents")).toBe("Cost cents");
    expect(budgetLabel("toolCalls")).toBe("Tool calls");
    expect(budgetLabel("max_iterations")).toBe("Max iterations");
    expect(budgetLabel("tokens")).toBe("Tokens");
  });

  /**
   * ONE formatter for both halves of the ratio.
   *
   * "$0.21 / 40" was a cost against a bare count — two units on one line, which
   * reads as though the ceiling were 40 of something else.
   */
  it("formats the ceiling in the same unit as the usage", () => {
    const cost = budgetFormat("costCents");
    expect(cost(21)).toBe("$0.21");
    expect(cost(40)).toBe("$0.40");

    const tokens = budgetFormat("tokens");
    /* 18.45 is not representable, so toFixed(1) floors it — the point of the
       assertion is that BOTH halves are token-formatted, not the rounding. */
    expect(tokens(18_450)).toBe("18.4k");
    expect(tokens(24_000)).toBe("24.0k");

    const count = budgetFormat("iterations");
    expect(count(5)).toBe("5");
  });

  /** A time budget reads as time, not as a raw millisecond count. */
  it("formats a time budget as a duration", () => {
    expect(budgetFormat("timeMs")(220_000)).toBe("3m 40s");
  });
});
