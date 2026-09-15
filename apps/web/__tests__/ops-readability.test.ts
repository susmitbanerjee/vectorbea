import { describe, expect, it } from "vitest";
import type { contracts } from "@vectorbea/shared";
import { logMessage } from "~/components/app/run-detail/log-stream";
import { describeIncident, failureReason } from "~/lib/incidents/describe-incident";
import { formatClock, formatDateTime, isValidTimeZone } from "~/lib/time/time-zone";

describe("run log lines", () => {
  it("say what happened with the model, attempt and duration, and never the source", () => {
    expect(logMessage({ type: "LLM_CALL_COMPLETED", modelName: "gpt-4o", durationMs: 12_400, retryAttempt: 2 }))
      .toBe("Model replied · gpt-4o · attempt 2 · 12.4s");
    expect(logMessage({ type: "STEP_STARTED", modelName: null, durationMs: null, retryAttempt: 1 })).toBe("Step started");
  });
});

function incident(overrides: Partial<contracts.FailureIncident>): contracts.FailureIncident {
  return {
    id: "i", runId: "r", workflowId: "w", category: "UNKNOWN", code: "UNKNOWN", severity: "medium",
    summary: "An unexpected error occurred. Manual investigation is recommended.",
    retryable: false, autoReplaySafe: false, requiresHumanApproval: false,
    detectedAt: "2026-09-15T10:00:00Z", resolutionStatus: "open",
    ...overrides,
  } as contracts.FailureIncident;
}

describe("incident wording", () => {
  it("names an UNKNOWN record from its stored message", () => {
    const record = incident({
      failedNodeId: "n-new-agent-2",
      technicalSummary: "Node n-new-agent-2 (agent) failed: Agent 'Code reviewer' failed: Budget exceeded: Agent exceeded max token budget (16384) (stopReason=BUDGET_EXCEEDED, iterations=5)",
    });
    const words = describeIncident(record);
    expect(words.title).toBe("Agent ran out of token budget");
    expect(words.where).toBe("Code reviewer");
    expect(words.fix).toContain("Total tokens");
    expect(failureReason(record)).toBe("Budget exceeded: Agent exceeded max token budget (16384)");
  });

  it("uses the classification when there is one, and the step name from newer messages", () => {
    const words = describeIncident(incident({
      code: "LLM_TIMEOUT", category: "TIMEOUT",
      technicalSummary: "Step 'Review changes' failed: LLM call exceeded its 120000ms budget",
    }));
    expect(words.title).toBe("Model call timed out");
    expect(words.where).toBe("Review changes");
  });
});

describe("time zone formatting", () => {
  it("renders the same instant in the viewer's zone", () => {
    const at = "2026-09-15T09:50:09Z";
    expect(formatClock(at, "Asia/Kolkata")).toBe("15:20:09");
    expect(formatClock(at, "UTC")).toBe("09:50:09");
    expect(formatDateTime(at, "Asia/Kolkata", { zone: false })).toBe("15 Sept 2026, 15:20:09");
    expect(isValidTimeZone("Nowhere/Else")).toBe(false);
  });
});
