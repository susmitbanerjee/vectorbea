/**
 * Email template rendering tests.
 * Verifies that templates produce correct subjects and contain key fields.
 * No network calls — pure function tests.
 *
 * Run with jest or vitest once a test runner is configured.
 */

import {
  teamInvitationEmail,
  evaluationCompletedEmail,
  evaluationFailedEmail,
  regressionFailedEmail,
  alertTriggeredEmail,
  rolloutBlockedEmail,
  quotaWarningEmail,
} from "../lib/server/email-templates";

describe("teamInvitationEmail", () => {
  const args = {
    inviterName: "Alice",
    workspaceName: "Acme Corp",
    role: "editor",
    acceptUrl: "https://app.example.com/auth/accept-invite?token=abc123",
    expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
  };

  it("subject contains workspace name and inviter", () => {
    const { subject } = teamInvitationEmail(args);
    expect(subject).toContain("Alice");
    expect(subject).toContain("Acme Corp");
  });

  it("HTML contains accept link", () => {
    const { html } = teamInvitationEmail(args);
    expect(html).toContain(args.acceptUrl);
  });

  it("HTML contains role", () => {
    const { html } = teamInvitationEmail(args);
    expect(html).toContain("editor");
  });

  it("plain text contains accept link", () => {
    const { text } = teamInvitationEmail(args);
    expect(text).toContain(args.acceptUrl);
  });

  it("does not include raw token in logs (no direct secret exposure in subject)", () => {
    const { subject } = teamInvitationEmail(args);
    expect(subject).not.toContain("abc123");
  });
});

describe("evaluationCompletedEmail", () => {
  const args = {
    workspaceName: "Acme",
    promptName: "chat-assistant",
    versionTag: "v1.2",
    recommendation: "ready_for_rollout",
    score: 0.87,
    runUrl: "https://app.example.com/evaluations/run-id",
  };

  it("subject contains prompt name and version", () => {
    const { subject } = evaluationCompletedEmail(args);
    expect(subject).toContain("chat-assistant");
    expect(subject).toContain("v1.2");
  });

  it("subject normalises recommendation label", () => {
    const { subject } = evaluationCompletedEmail(args);
    expect(subject).toContain("ready for rollout");
  });

  it("HTML contains score percentage", () => {
    const { html } = evaluationCompletedEmail(args);
    expect(html).toContain("87%");
  });

  it("HTML contains run URL", () => {
    const { html } = evaluationCompletedEmail(args);
    expect(html).toContain(args.runUrl);
  });

  it("omits score block when score is null", () => {
    const { html } = evaluationCompletedEmail({ ...args, score: null });
    expect(html).not.toContain("<dt>Average score</dt>");
  });
});

describe("evaluationFailedEmail", () => {
  it("subject indicates failure", () => {
    const { subject } = evaluationFailedEmail({
      workspaceName: "Acme",
      promptName: "assistant",
      versionTag: "v2",
      reason: "Provider timeout",
      runUrl: "https://app.example.com/evaluations/x",
    });
    expect(subject).toMatch(/failed/i);
    expect(subject).toContain("assistant");
  });

  it("HTML contains reason", () => {
    const { html } = evaluationFailedEmail({
      workspaceName: "Acme",
      promptName: "assistant",
      versionTag: "v2",
      reason: "Provider timeout",
      runUrl: "https://app.example.com/evaluations/x",
    });
    expect(html).toContain("Provider timeout");
  });
});

describe("regressionFailedEmail", () => {
  it("subject contains schedule name", () => {
    const { subject } = regressionFailedEmail({
      workspaceName: "Acme",
      scheduleName: "Nightly GPT-4 regression",
      promptName: "summariser",
      reason: "Dataset missing",
      runUrl: null,
    });
    expect(subject).toContain("Nightly GPT-4 regression");
  });
});

describe("alertTriggeredEmail", () => {
  it("subject contains rule name", () => {
    const { subject } = alertTriggeredEmail({
      workspaceName: "Acme",
      ruleName: "High error rate",
      metricType: "error_rate",
      metricValue: 12.4,
      threshold: 5,
      comparison: "gt",
      alertsUrl: "https://app.example.com/alerts",
    });
    expect(subject).toContain("High error rate");
  });

  it("HTML contains metric value", () => {
    const { html } = alertTriggeredEmail({
      workspaceName: "Acme",
      ruleName: "High error rate",
      metricType: "error_rate",
      metricValue: 12.4,
      threshold: 5,
      comparison: "gt",
      alertsUrl: "https://app.example.com/alerts",
    });
    expect(html).toContain("12.4");
  });
});

describe("rolloutBlockedEmail", () => {
  it("HTML contains all blocking reasons", () => {
    const { html } = rolloutBlockedEmail({
      workspaceName: "Acme",
      promptName: "assistant",
      versionTag: "v3",
      reasons: ["Score below threshold", "Critical failure detected"],
      promptUrl: "https://app.example.com/prompts/p1",
    });
    expect(html).toContain("Score below threshold");
    expect(html).toContain("Critical failure detected");
  });
});

describe("quotaWarningEmail", () => {
  it("subject contains usage percentage", () => {
    const { subject } = quotaWarningEmail({
      workspaceName: "Acme",
      usageType: "runtime_traces",
      used: 4200,
      limit: 5000,
      billingUrl: "https://app.example.com/settings/billing",
    });
    expect(subject).toContain("84%");
  });

  it("plain text contains upgrade URL", () => {
    const { text } = quotaWarningEmail({
      workspaceName: "Acme",
      usageType: "evaluation_runs",
      used: 18,
      limit: 20,
      billingUrl: "https://app.example.com/billing",
    });
    expect(text).toContain("https://app.example.com/billing");
  });
});
