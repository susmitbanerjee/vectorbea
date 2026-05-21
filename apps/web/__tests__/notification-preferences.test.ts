import {
  shouldNotifyRecipientByContext,
  type RecipientPreferenceContext,
  type WorkspaceNotificationPrefs,
} from "../lib/server/notification-preferences";

function baseWorkspacePrefs(): WorkspaceNotificationPrefs {
  return {
    workspaceId: "w1",
    emailEnabled: true,
    slackEnabled: false,
    events: {
      alerts: true,
      regressions: true,
      evaluations: true,
      rollout: true,
      quota: true,
      providers: true,
      workspace: true,
    },
    slackEvents: {
      alerts: true,
      regressions: true,
      evaluations: false,
      rollout: true,
      quota: false,
      providers: true,
      workspace: false,
    },
  };
}

describe("notification preference resolver", () => {
  it("allows workspace event by default", () => {
    const ctx: RecipientPreferenceContext = {
      workspacePrefs: baseWorkspacePrefs(),
      role: "editor",
    };
    expect(
      shouldNotifyRecipientByContext(ctx, { category: "alerts", severity: "warning" }),
    ).toBe(true);
  });

  it("blocks when workspace email disabled", () => {
    const prefs = baseWorkspacePrefs();
    prefs.emailEnabled = false;
    expect(
      shouldNotifyRecipientByContext(
        { workspacePrefs: prefs, role: "owner" },
        { category: "alerts", severity: "critical" },
      ),
    ).toBe(false);
  });

  it("blocks events below severity threshold", () => {
    const ctx: RecipientPreferenceContext = {
      workspacePrefs: baseWorkspacePrefs(),
      role: "owner",
      userPrefs: {
        userId: "u1",
        emailEnabled: true,
        channels: { email: true },
        severityThreshold: "critical",
        events: {
          alerts: true,
          regressions: true,
          evaluations: true,
          rollout: true,
          quota: true,
          providers: true,
          workspace: true,
          invitations: true,
          review_requests: true,
          rollout_decisions: true,
          evaluation_failures: true,
        },
      },
    };
    expect(shouldNotifyRecipientByContext(ctx, { category: "alerts", severity: "warning" })).toBe(false);
    expect(shouldNotifyRecipientByContext(ctx, { category: "alerts", severity: "critical" })).toBe(true);
  });

  it("enforces quota recipient roles", () => {
    const prefs = baseWorkspacePrefs();
    expect(
      shouldNotifyRecipientByContext(
        { workspacePrefs: prefs, role: "viewer" },
        { category: "quota", severity: "warning" },
      ),
    ).toBe(false);
    expect(
      shouldNotifyRecipientByContext(
        { workspacePrefs: prefs, role: "admin" },
        { category: "quota", severity: "warning" },
      ),
    ).toBe(true);
  });

  it("respects prompt and environment filters", () => {
    const ctx: RecipientPreferenceContext = {
      workspacePrefs: baseWorkspacePrefs(),
      role: "admin",
      userPrefs: {
        userId: "u1",
        emailEnabled: true,
        channels: { email: true },
        severityThreshold: "info",
        filters: { environments: ["production"], prompts: ["support"] },
        events: {
          alerts: true,
          regressions: true,
          evaluations: true,
          rollout: true,
          quota: true,
          providers: true,
          workspace: true,
          invitations: true,
          review_requests: true,
          rollout_decisions: true,
          evaluation_failures: true,
        },
      },
    };

    expect(
      shouldNotifyRecipientByContext(ctx, {
        category: "evaluations",
        severity: "info",
        environment: "staging",
        promptName: "support",
      }),
    ).toBe(false);
    expect(
      shouldNotifyRecipientByContext(ctx, {
        category: "evaluations",
        severity: "info",
        environment: "production",
        promptName: "support",
      }),
    ).toBe(true);
  });
});

