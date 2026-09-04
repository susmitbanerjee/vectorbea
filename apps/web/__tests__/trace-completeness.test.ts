import { describe, expect, it } from "vitest";
import { completenessPresentation } from "~/components/app/debug/states";
import { transportLabel } from "~/components/app/debug/debug-tab";
import type { TraceCompleteness } from "~/lib/api/trace";

/**
 * The banner that fired on healthy runs.
 *
 * The Debug tab showed amber text reading, in effect, "spans were dropped while
 * the writer was under pressure" — on a run the same page called complete and
 * successful. It came from `traceComplete`, a boolean meaning "the run span is
 * closed", which carries no information about drops at all and was false on
 * healthy finished runs because the run span was written twice.
 *
 * A warning that fires on healthy runs is worse than no warning: it teaches
 * people that amber means nothing, so the next one is ignored too. These tests
 * pin the mapping, because none of it is visible in a screenshot of whichever
 * run you happen to be looking at.
 */

const c = (p: Partial<TraceCompleteness>): TraceCompleteness => ({
  state: "complete", droppedSpans: 0, reason: null, ...p,
});

describe("completeness presentation", () => {
  /** Amber belongs to exactly one state: the one making a claim about loss. */
  it("reserves the warning colour for partial alone", () => {
    const amber = "status-waiting";
    expect(completenessPresentation(c({ state: "partial", droppedSpans: 3 })).tone.fill)
      .toContain(amber);

    for (const state of ["live", "unavailable"] as const) {
      const t = completenessPresentation(c({ state }));
      expect(`${t.tone.fill} ${t.tone.border} ${t.tone.text}`, `${state} must not be amber`)
        .not.toContain(amber);
    }
  });

  /** "This run is still going" is a status. Neutral surface, neutral text. */
  it("renders a live run neutrally, not as a warning", () => {
    const { tone, heading } = completenessPresentation(c({ state: "live" }));
    expect(tone.fill).toBe("bg-surface-raised");
    expect(tone.text).toBe("text-fg-secondary");
    expect(heading).toBe("This run is still going");
  });

  /**
   * The count is the point. "Some spans are missing" is unactionable; "16 spans
   * missing" tells you whether to trust the waterfall.
   */
  it("puts the real number in the heading", () => {
    expect(completenessPresentation(c({ state: "partial", droppedSpans: 16 })).heading)
      .toBe("16 spans missing");
    expect(completenessPresentation(c({ state: "partial", droppedSpans: 1 })).heading)
      .toBe("1 span missing");
  });

  /**
   * A trace that could not be READ is not a trace with nothing in it. Failure
   * colour, and wording that never claims the run did nothing.
   */
  it("distinguishes unavailable from partial", () => {
    const u = completenessPresentation(c({ state: "unavailable" }));
    expect(u.tone.text).toBe("text-status-failed");
    expect(u.heading).toBe("The trace could not be loaded");
    expect(u.heading).not.toMatch(/missing|dropped/i);
  });

  /**
   * Partial never blames a cause it cannot see. The heading states the fact —
   * spans are missing — and the server-supplied `reason` explains it. The old
   * banner hard-coded "under pressure", which was a guess.
   */
  it("never hard-codes a cause into the heading", () => {
    expect(completenessPresentation(c({ state: "partial", droppedSpans: 2 })).heading)
      .not.toMatch(/pressure|buffer|writer/i);
  });
});

describe("transport indicator", () => {
  /** Healthy SSE says nothing at all. */
  it("is silent when the stream is open", () => {
    expect(transportLabel("open")).toBeNull();
  });

  /**
   * Polling is not an error and must not read like one. Updates still arrive;
   * only the mechanism changed, and the trace is identical either way.
   */
  it("describes polling without implying data loss", () => {
    const label = transportLabel("polling")!;
    expect(label).toBe("Refreshing on a timer");
    expect(label).not.toMatch(/unavailable|failed|error|lost|missing|dropped/i);
  });

  it("names the remaining transport states", () => {
    expect(transportLabel("connecting")).toBe("Connecting…");
    expect(transportLabel("closed")).toBe("Updates stopped");
  });
});
