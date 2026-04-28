import {
  alertTriggeredEmail,
  evaluationCompletedEmail,
  evaluationFailedEmail,
  promptPromotedEmail,
  quotaWarningEmail,
  regressionFailedEmail,
  rolloutBlockedEmail,
  teamInvitationEmail,
} from "../lib/server/email-templates";

describe("email templates", () => {
  it("renders invitation with manageably safe details", () => {
    const res = teamInvitationEmail({
      inviterName: "Alice",
      workspaceName: "Acme",
      role: "editor",
      acceptUrl: "https://app.example.com/auth/accept-invite?token=abc",
      expiresAt: new Date().toISOString(),
    });
    expect(res.subject).toContain("Alice");
    expect(res.html).toContain("VectorBea");
    expect(res.html).toContain("Manage notification preferences");
    expect(res.text).toContain("Accept");
  });

  it("renders evaluation completed with score and verdict", () => {
    const res = evaluationCompletedEmail({
      workspaceName: "Acme",
      workspaceId: "w1",
      promptName: "support",
      versionTag: "v3",
      recommendation: "ready_for_rollout",
      score: 0.84,
      runUrl: "https://app.example.com/evaluations/1",
    });
    expect(res.subject).toContain("Evaluation completed");
    expect(res.html).toContain("84%");
    expect(res.html).toContain("Open evaluation run");
  });

  it("renders evaluation failed with failure reason", () => {
    const res = evaluationFailedEmail({
      workspaceName: "Acme",
      workspaceId: "w1",
      promptName: "support",
      versionTag: "v3",
      reason: "Provider timeout",
      runUrl: "https://app.example.com/evaluations/1",
    });
    expect(res.subject).toContain("failed");
    expect(res.html).toContain("Provider timeout");
  });

  it("renders regression failed", () => {
    const res = regressionFailedEmail({
      workspaceName: "Acme",
      workspaceId: "w1",
      scheduleName: "Nightly",
      promptName: "support",
      reason: "No dataset items",
      runUrl: null,
    });
    expect(res.subject).toContain("Nightly");
    expect(res.html).toContain("Regression check failed");
  });

  it("renders alert triggered with threshold details", () => {
    const res = alertTriggeredEmail({
      workspaceName: "Acme",
      workspaceId: "w1",
      ruleName: "Error rate high",
      metricType: "error_rate",
      metricValue: 9.4,
      threshold: 5,
      comparison: "gt",
      alertsUrl: "https://app.example.com/alerts",
    });
    expect(res.html).toContain("Error rate");
    expect(res.html).toContain("9.4%");
    expect(res.text).toContain("Threshold");
  });

  it("renders rollout blocked and includes reasons", () => {
    const res = rolloutBlockedEmail({
      workspaceName: "Acme",
      workspaceId: "w1",
      promptName: "support",
      versionTag: "v3",
      reasons: ["Critical check failed"],
      promptUrl: "https://app.example.com/prompts/1",
    });
    expect(res.html).toContain("Critical check failed");
    expect(res.subject).toContain("Rollout blocked");
  });

  it("renders quota warning and exceeded messaging", () => {
    const nearing = quotaWarningEmail({
      workspaceName: "Acme",
      workspaceId: "w1",
      usageType: "runtime_traces",
      used: 4500,
      limit: 5000,
      billingUrl: "https://app.example.com/settings/billing",
    });
    const exceeded = quotaWarningEmail({
      workspaceName: "Acme",
      workspaceId: "w1",
      usageType: "runtime_traces",
      used: 5500,
      limit: 5000,
      billingUrl: "https://app.example.com/settings/billing",
    });
    expect(nearing.subject).toContain("nearing");
    expect(exceeded.subject).toContain("exceeded");
  });

  it("renders promoted email", () => {
    const res = promptPromotedEmail({
      workspaceName: "Acme",
      workspaceId: "w1",
      promptName: "support",
      versionTag: "v3",
      promotedBy: "alice@acme.com",
      promptUrl: "https://app.example.com/prompts/1",
    });
    expect(res.subject).toContain("approved");
    expect(res.html).toContain("Prompt version is now active");
  });
});

