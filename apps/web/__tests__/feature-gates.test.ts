/**
 * Feature gate policy tests.
 * Tests the static FEATURE_POLICY table — no DB calls.
 */

type PlanTier = "free" | "team" | "pro" | "enterprise";
type FeatureKey =
  | "evaluations"
  | "scheduled_regressions"
  | "rollout"
  | "alerts"
  | "metrics_dashboard"
  | "enterprise_gateway"
  | "slack_notifications"
  | "email_notifications"
  | "team_invitations"
  | "auto_evaluations";

const FEATURE_POLICY: Record<FeatureKey, Record<PlanTier, boolean>> = {
  evaluations: { free: false, team: true, pro: true, enterprise: true },
  scheduled_regressions: { free: false, team: true, pro: true, enterprise: true },
  rollout: { free: false, team: true, pro: true, enterprise: true },
  alerts: { free: false, team: true, pro: true, enterprise: true },
  metrics_dashboard: { free: true, team: true, pro: true, enterprise: true },
  enterprise_gateway: { free: false, team: false, pro: false, enterprise: true },
  slack_notifications: { free: false, team: true, pro: true, enterprise: true },
  email_notifications: { free: false, team: true, pro: true, enterprise: true },
  team_invitations: { free: true, team: true, pro: true, enterprise: true },
  auto_evaluations: { free: false, team: true, pro: true, enterprise: true },
};

function canUse(feature: FeatureKey, plan: PlanTier): boolean {
  return FEATURE_POLICY[feature][plan] ?? false;
}

describe("Free plan feature gates", () => {
  it("cannot use evaluations on free", () => {
    expect(canUse("evaluations", "free")).toBe(false);
  });

  it("cannot use alerts on free", () => {
    expect(canUse("alerts", "free")).toBe(false);
  });

  it("cannot use slack on free", () => {
    expect(canUse("slack_notifications", "free")).toBe(false);
  });

  it("can use metrics_dashboard on free", () => {
    expect(canUse("metrics_dashboard", "free")).toBe(true);
  });

  it("can invite team members on free (basic seats)", () => {
    expect(canUse("team_invitations", "free")).toBe(true);
  });
});

describe("Team plan feature gates", () => {
  it("can use evaluations on team", () => {
    expect(canUse("evaluations", "team")).toBe(true);
  });

  it("can use scheduled regressions on team", () => {
    expect(canUse("scheduled_regressions", "team")).toBe(true);
  });

  it("can use Slack notifications on team", () => {
    expect(canUse("slack_notifications", "team")).toBe(true);
  });

  it("cannot use enterprise_gateway on team", () => {
    expect(canUse("enterprise_gateway", "team")).toBe(false);
  });
});

describe("Enterprise plan feature gates", () => {
  it("can use all features on enterprise", () => {
    const features = Object.keys(FEATURE_POLICY) as FeatureKey[];
    for (const feature of features) {
      expect(canUse(feature, "enterprise")).toBe(true);
    }
  });
});

describe("Usage limits for pricing", () => {
  const USAGE_LIMITS = {
    free: { evaluation_runs: 20, regression_runs: 0, alert_rules: 0, team_seats: 3 },
    team: { evaluation_runs: 1_000, regression_runs: 100, alert_rules: 20, team_seats: 15 },
    pro: { evaluation_runs: 2_500, regression_runs: 500, alert_rules: 50, team_seats: 50 },
    enterprise: { evaluation_runs: null, regression_runs: null, alert_rules: null, team_seats: null },
  };

  it("free plan has zero regression runs", () => {
    expect(USAGE_LIMITS.free.regression_runs).toBe(0);
  });

  it("enterprise plan has null (unlimited) for all usage types", () => {
    for (const [key, val] of Object.entries(USAGE_LIMITS.enterprise)) {
      expect(val).toBeNull();
    }
  });

  it("team plan has more seats than free", () => {
    expect(USAGE_LIMITS.team.team_seats).toBeGreaterThan(USAGE_LIMITS.free.team_seats!);
  });

  it("pro plan allows more evaluation runs than team", () => {
    expect(USAGE_LIMITS.pro.evaluation_runs!).toBeGreaterThan(USAGE_LIMITS.team.evaluation_runs!);
  });
});
