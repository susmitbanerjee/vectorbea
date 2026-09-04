import { describe, expect, it } from "vitest";
import type { Iteration, StepBaseline } from "~/lib/api/trace";
import {
  buildActivity, headlineOf, outcomeOf, significanceOf, stepHealth,
  type ActivityGroup, type ActivityStep,
} from "~/components/app/debug/activity";

/**
 * The Activity view's model.
 *
 * Every assertion here is one of the acceptance criteria, written as a test
 * rather than as a claim:
 *
 *   - a reader who has never seen the runtime reads what the agent did
 *   - a 40-step activation renders under 10 rows with every failure visible
 *   - 14 steps against a baseline of 3 is flagged on a SUCCESSFUL run
 *   - nothing is lost, only defaulted away
 */

let seq = 0;
function iter(p: Partial<Iteration> = {}): Iteration {
  seq += 1;
  return {
    id: `i${seq}`,
    number: p.number ?? seq,
    status: "completed",
    actionType: "CALL_TOOL",
    thought: null,
    observation: null,
    observationSuccess: true,
    startedAt: "2026-08-31T10:00:00Z",
    completedAt: "2026-08-31T10:00:01Z",
    durationMs: 1_200,
    tokensDelta: 400,
    costDeltaCents: 1,
    actionJson: null,
    actionRepaired: false,
    selectedToolId: null,
    toolName: null,
    toolResultCached: null,
    recalled: false,
    context: null,
    llmCall: null,
    toolCall: null,
    ...p,
  };
}

const steps = (rows: ReturnType<typeof buildActivity>): ActivityStep[] =>
  rows.filter((r): r is ActivityStep => r.kind === "step");
const groups = (rows: ReturnType<typeof buildActivity>): ActivityGroup[] =>
  rows.filter((r): r is ActivityGroup => r.kind === "group");

describe("the sentence", () => {
  it("uses the agent's own reasoning summary when it left one", () => {
    const row = headlineOf(iter({ thought: "Looked up account A-8891 in Salesforce" }));
    expect(row.text).toBe("Looked up account A-8891 in Salesforce");
    expect(row.generated).toBe(false);
  });

  it("names the tool rather than the action type when reasoning is absent", () => {
    const row = headlineOf(iter({ thought: null, toolName: "Salesforce account lookup" }));
    expect(row.text).toBe("Called Salesforce account lookup.");
    expect(row.generated).toBe(true);
  });

  it("never renders a uuid or a runtime action type at the reader", () => {
    const all = ["CALL_TOOL", "THINK", "FINAL", "DELEGATE", "ASK_APPROVAL", "FAIL"]
      .map((actionType) => headlineOf(iter({ actionType, selectedToolId: "8f14e45f-1234-4a2b-9c3d-1a2b3c4d5e6f" })).text);
    for (const text of all) {
      expect(text).not.toMatch(/CALL_TOOL|ASK_APPROVAL|THINK|8f14e45f/);
      /* A sentence, not a label: starts with a capital and ends with a stop. */
      expect(text).toMatch(/^[A-Z].*\.$/);
    }
  });

  it("drops the pre-contract shape summary, which describes the envelope", () => {
    expect(outcomeOf(iter({ observation: "Tool returned 3 field(s): status, body, headers" })))
      .toBeNull();
  });

  it("keeps a result contract's summary and an error contract's sentence", () => {
    expect(outcomeOf(iter({ observation: "Returned 47 results, showing 5." })))
      .toBe("Returned 47 results, showing 5.");
    expect(outcomeOf(iter({
      observation: "Salesforce rejected the credentials. Retrying will NOT help. To fix: reconnect the account.",
      observationSuccess: false,
    }))).toContain("reconnect the account");
  });
});

describe("what counts as needing attention", () => {
  it("treats an unsuccessful observation, a repair and a truncated context as failures", () => {
    expect(significanceOf(iter({ observationSuccess: false }))).toBe("failure");
    expect(significanceOf(iter({ status: "failed" }))).toBe("failure");
    expect(significanceOf(iter({ actionRepaired: true }))).toBe("failure");
    expect(significanceOf(iter({
      context: { truncated: true, droppedSections: ["instructions"], charsUsed: 9, charBudget: 8, overBudget: true },
    }))).toBe("failure");
  });

  it("does NOT treat a cached result as a failure — it is unusual, not wrong", () => {
    expect(significanceOf(iter({ toolResultCached: true }))).toBe("routine");
  });
});

describe("collapsing", () => {
  it("folds a 40-step activation under 10 rows", () => {
    const rows = buildActivity(
      Array.from({ length: 40 }, (_, i) =>
        iter({ number: i + 1, toolName: "Ticket search", thought: `Checked page ${i + 1}` })),
    );
    expect(rows.length).toBeLessThan(10);
  });

  it("leaves every failure visible in that same activation", () => {
    const iterations = Array.from({ length: 40 }, (_, i) =>
      iter({ number: i + 1, toolName: "Ticket search" }));
    iterations[7] = iter({ number: 8, observationSuccess: false, observation: "Could not reach Salesforce — token expired." });
    iterations[29] = iter({ number: 30, status: "failed", observation: "The query timed out." });

    const rows = buildActivity(iterations);
    expect(rows.length).toBeLessThan(10);

    const visible = steps(rows);
    expect(visible.map((s) => s.iteration.number)).toEqual([8, 30]);
    for (const s of visible) expect(s.significance).toBe("failure");
  });

  it("folds two consecutive THINKs but keeps a lone routine step in place", () => {
    const rows = buildActivity([
      iter({ number: 1, actionType: "THINK" }),
      iter({ number: 2, actionType: "THINK" }),
      iter({ number: 3, actionType: "FINAL" }),
    ]);
    expect(groups(rows)).toHaveLength(1);
    /* Lower case and countless-of-its-own: the view renders it after the step
       range, as "Steps 1-2 · planned its next move 2 times." */
    expect(groups(rows)[0].headline).toBe("planned its next move 2 times.");

    const short = buildActivity([iter({ number: 1 }), iter({ number: 2, actionType: "FINAL" })]);
    expect(groups(short)).toHaveLength(0);
  });

  it("never folds recalled steps together with steps that actually ran", () => {
    /* Ten steps, so folding is in play at all — see FOLD_ABOVE. */
    const rows = buildActivity([
      ...Array.from({ length: 5 }, (_, i) => iter({ number: i + 1, recalled: true })),
      ...Array.from({ length: 5 }, (_, i) => iter({ number: i + 6, recalled: false })),
    ]);
    const g = groups(rows);
    expect(g).toHaveLength(2);
    expect(g[0].recalled).toBe(true);
    expect(g[1].recalled).toBe(false);
  });

  it("keeps every step reachable — collapsing hides nothing", () => {
    const iterations = Array.from({ length: 40 }, (_, i) => iter({ number: i + 1 }));
    const rows = buildActivity(iterations);
    const reachable = rows.flatMap((r) => (r.kind === "group" ? r.steps : [r]));
    expect(reachable.map((s) => s.iteration.number)).toEqual(iterations.map((i) => i.number));
  });

  it("names the steps a folded stretch covers, so the sequence stays readable", () => {
    const rows = buildActivity([
      iter({ number: 1, actionType: "FINAL" }),
      ...Array.from({ length: 10 }, (_, i) => iter({ number: i + 2 })),
      iter({ number: 12, status: "failed" }),
    ]);
    expect(groups(rows)[0].range).toEqual([2, 11]);
  });

  /**
   * A short activation folds nothing but deliberation.
   *
   * The four-step case is the one the view exists for — "Looked up account
   * A-8891 in Salesforce", "Searched related tickets, found none" — and folding
   * it to "Steps 1-3 · all successful" removed exactly those sentences.
   */
  it("leaves a short activation expanded, because there is no noise to remove", () => {
    const rows = buildActivity([
      iter({ number: 1, actionType: "THINK", thought: "Read the ticket." }),
      iter({ number: 2, thought: "Looked up account A-8891 in Salesforce." }),
      iter({ number: 3, thought: "Searched related tickets, found none." }),
      iter({ number: 4, actionType: "FINAL", thought: "Replied with the renewal date." }),
    ]);
    expect(groups(rows)).toHaveLength(0);
    expect(steps(rows).map((s) => s.headline)).toEqual([
      "Read the ticket.",
      "Looked up account A-8891 in Salesforce.",
      "Searched related tickets, found none.",
      "Replied with the renewal date.",
    ]);
  });

  it("names the tools a folded stretch used", () => {
    const rows = buildActivity([
      iter({ number: 1, toolName: "Salesforce lookup" }),
      iter({ number: 2, toolName: "Ticket search" }),
      ...Array.from({ length: 8 }, (_, i) =>
        iter({ number: i + 3, toolName: "Salesforce lookup" })),
    ]);
    expect(groups(rows)[0].tools).toEqual(["Salesforce lookup", "Ticket search"]);
  });
});

describe("the step count as a health signal", () => {
  const baseline = (typicalSteps: number): StepBaseline => ({ typicalSteps, sampleRuns: 12 });

  it("flags 14 steps against a typical 3", () => {
    const h = stepHealth(14, baseline(3));
    expect(h.level).toBe("high");
    expect(h.text).toBe("14 steps — typical for this agent is 3.");
  });

  it("does not flag twice as many steps when twice is still small", () => {
    expect(stepHealth(2, baseline(1)).level).toBe("typical");
  });

  it("does not flag a small absolute margin on a long-running agent", () => {
    expect(stepHealth(24, baseline(20)).level).toBe("typical");
  });

  it("says nothing at all when the agent has no successful history", () => {
    const h = stepHealth(14, null);
    expect(h.level).toBe("unknown");
    expect(h.text).toBeNull();
  });
});
