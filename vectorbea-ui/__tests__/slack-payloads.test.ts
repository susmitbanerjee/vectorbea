/**
 * Slack payload builder tests.
 * Verifies that message payloads contain required fields.
 * No network calls — pure function tests.
 */

import {
  slackAlertTriggered,
  slackEvaluationCompleted,
  slackEvaluationFailed,
  slackRegressionFailed,
  slackRolloutBlocked,
  slackPromptPromoted,
} from "../lib/server/slack";

describe("slackEvaluationCompleted", () => {
  const args = {
    workspaceName: "Acme",
    promptName: "assistant",
    versionTag: "v1",
    recommendation: "ready_for_rollout",
    score: 0.91,
    runUrl: "https://app.example.com/evaluations/run1",
  };

  it("text contains prompt name", () => {
    const { text } = slackEvaluationCompleted(args);
    expect(text).toContain("assistant");
  });

  it("text contains score percentage", () => {
    const { text } = slackEvaluationCompleted(args);
    expect(text).toContain("91%");
  });

  it("blocks array is non-empty", () => {
    const { blocks } = slackEvaluationCompleted(args);
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks!.length).toBeGreaterThan(0);
  });

  it("includes action button with runUrl", () => {
    const { blocks } = slackEvaluationCompleted(args);
    const json = JSON.stringify(blocks);
    expect(json).toContain(args.runUrl);
  });
});

describe("slackEvaluationFailed", () => {
  it("text indicates failure", () => {
    const { text } = slackEvaluationFailed({
      workspaceName: "Acme",
      promptName: "assistant",
      versionTag: "v2",
      reason: "Provider error",
      runUrl: "https://app.example.com/evaluations/x",
    });
    expect(text.toLowerCase()).toContain("failed");
  });
});

describe("slackAlertTriggered", () => {
  it("text contains rule name", () => {
    const { text } = slackAlertTriggered({
      workspaceName: "Acme",
      ruleName: "High latency",
      metricType: "latency_p95",
      metricValue: 2400,
      threshold: 2000,
      alertsUrl: "https://app.example.com/alerts",
    });
    expect(text).toContain("High latency");
  });

  it("blocks contain metric value", () => {
    const { blocks } = slackAlertTriggered({
      workspaceName: "Acme",
      ruleName: "High latency",
      metricType: "latency_p95",
      metricValue: 2400,
      threshold: 2000,
      alertsUrl: "https://app.example.com/alerts",
    });
    expect(JSON.stringify(blocks)).toContain("2400");
  });
});

describe("slackRegressionFailed", () => {
  it("text contains schedule name", () => {
    const { text } = slackRegressionFailed({
      workspaceName: "Acme",
      scheduleName: "Nightly check",
      reason: "No dataset",
      runUrl: null,
    });
    expect(text).toContain("Nightly check");
  });
});

describe("slackRolloutBlocked", () => {
  it("text contains prompt name", () => {
    const { text } = slackRolloutBlocked({
      workspaceName: "Acme",
      promptName: "assistant",
      versionTag: "v3",
      reasons: ["Score too low"],
      promptUrl: "https://app.example.com/prompts/1",
    });
    expect(text).toContain("assistant");
  });
});

describe("slackPromptPromoted", () => {
  it("text indicates promotion", () => {
    const { text } = slackPromptPromoted({
      workspaceName: "Acme",
      promptName: "assistant",
      versionTag: "v2",
      promotedBy: "Bob",
      promptUrl: "https://app.example.com/prompts/1",
    });
    expect(text.toLowerCase()).toContain("promoted");
    expect(text).toContain("assistant");
  });
});

describe("Slack encryption", () => {
  it("encryptSecret / decryptSecret round-trips correctly", async () => {
    const { encryptSecret, decryptSecret } = await import("../lib/server/slack");
    const plain = "https://hooks.slack.com/services/T00/B00/XXXX";
    const encrypted = await encryptSecret(plain);
    expect(encrypted).not.toBe(plain);
    expect(encrypted.length).toBeGreaterThan(20);
    const decrypted = await decryptSecret(encrypted);
    expect(decrypted).toBe(plain);
  });
});
