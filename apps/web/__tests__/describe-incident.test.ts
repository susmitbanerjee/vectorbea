import { describeIncident, failureReason } from "~/lib/incidents/describe-incident";
import type { contracts } from "@vectorbea/shared";

function incident(over: Partial<contracts.FailureIncident>): contracts.FailureIncident {
  return { code: "UNKNOWN", technicalSummary: null, summary: null, ...over } as contracts.FailureIncident;
}

describe("describeIncident", () => {
  it("names a truncated tool result instead of a generic agent stop", () => {
    const words = describeIncident(incident({
      technicalSummary:
        "Step 'Review changes' failed: Agent 'Code reviewer' failed: The agent stopped and reported: Fetched source file content for src/main/java/com/qrx/service/impl/QrServiceImpl.java is truncated (contains an ellipsis … [truncated]), so I cannot determine exact line numbers. (stopReason=AGENT_FAILED, iterations=6)",
    }));
    expect(words.title).toBe("Agent was shown only part of a tool result");
    expect(words.kind).toBe("Limit reached");
    expect(words.where).toBe("Review changes");
    expect(words.fix).toContain("AGENT_TOOL_RESULT_MAX_CHARS");
  });

  it("still reports an agent stop that has no truncation in it", () => {
    const words = describeIncident(incident({
      technicalSummary: "Step 'Review changes' failed: The agent stopped and reported: I need the repository URL.",
    }));
    expect(words.title).toBe("Agent could not complete its task");
  });

  it("prefers an explicit code over the message", () => {
    expect(describeIncident(incident({
      code: "AGENT_TOKEN_BUDGET_EXCEEDED",
      technicalSummary: "Agent 'Code reviewer' failed: Budget exceeded: … truncated",
    })).title).toBe("Agent ran out of token budget");
  });

  it("strips the step and agent prefixes from the reason", () => {
    expect(failureReason(incident({
      technicalSummary: "Step 'Review changes' failed: Agent 'Code reviewer' failed: It broke. (stopReason=AGENT_FAILED, iterations=4)",
    }))).toBe("It broke.");
  });
});
