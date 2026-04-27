/**
 * Notification preference logic tests.
 * Pure logic tests — no DB calls.
 */

type WorkspaceEventKey = "alerts" | "regressions" | "evaluations" | "rollout" | "quota";

interface WorkspaceNotificationPrefs {
  emailEnabled: boolean;
  slackEnabled: boolean;
  events: Record<WorkspaceEventKey, boolean>;
  slackEvents: Record<WorkspaceEventKey, boolean>;
}

const DEFAULT_PREFS: WorkspaceNotificationPrefs = {
  emailEnabled: true,
  slackEnabled: false,
  events: { alerts: true, regressions: true, evaluations: true, rollout: true, quota: true },
  slackEvents: { alerts: true, regressions: true, evaluations: false, rollout: true, quota: false },
};

function shouldEmail(prefs: WorkspaceNotificationPrefs, event: WorkspaceEventKey): boolean {
  return prefs.emailEnabled && (prefs.events[event] ?? true);
}

function shouldSlack(prefs: WorkspaceNotificationPrefs, event: WorkspaceEventKey): boolean {
  return prefs.slackEnabled && (prefs.slackEvents[event] ?? false);
}

function mergePrefs(
  current: WorkspaceNotificationPrefs,
  updates: Partial<WorkspaceNotificationPrefs>,
): WorkspaceNotificationPrefs {
  return {
    ...current,
    ...updates,
    events: { ...current.events, ...(updates.events ?? {}) },
    slackEvents: { ...current.slackEvents, ...(updates.slackEvents ?? {}) },
  };
}

describe("Workspace email preferences", () => {
  it("emails when enabled and event is enabled", () => {
    expect(shouldEmail(DEFAULT_PREFS, "alerts")).toBe(true);
  });

  it("does not email when emailEnabled=false", () => {
    const prefs = mergePrefs(DEFAULT_PREFS, { emailEnabled: false });
    expect(shouldEmail(prefs, "alerts")).toBe(false);
  });

  it("does not email when specific event is disabled", () => {
    const prefs = mergePrefs(DEFAULT_PREFS, { events: { ...DEFAULT_PREFS.events, evaluations: false } });
    expect(shouldEmail(prefs, "evaluations")).toBe(false);
  });

  it("still emails other events when one is disabled", () => {
    const prefs = mergePrefs(DEFAULT_PREFS, { events: { ...DEFAULT_PREFS.events, evaluations: false } });
    expect(shouldEmail(prefs, "alerts")).toBe(true);
  });
});

describe("Workspace Slack preferences", () => {
  it("does not Slack when slackEnabled=false (default)", () => {
    expect(shouldSlack(DEFAULT_PREFS, "alerts")).toBe(false);
  });

  it("Slacks when slackEnabled=true and event is enabled", () => {
    const prefs = mergePrefs(DEFAULT_PREFS, { slackEnabled: true });
    expect(shouldSlack(prefs, "alerts")).toBe(true);
  });

  it("does not Slack for evaluations even when slack enabled (default slackEvent=false)", () => {
    const prefs = mergePrefs(DEFAULT_PREFS, { slackEnabled: true });
    expect(shouldSlack(prefs, "evaluations")).toBe(false);
  });

  it("Slacks for evaluations if slackEvents.evaluations=true", () => {
    const prefs = mergePrefs(DEFAULT_PREFS, {
      slackEnabled: true,
      slackEvents: { ...DEFAULT_PREFS.slackEvents, evaluations: true },
    });
    expect(shouldSlack(prefs, "evaluations")).toBe(true);
  });
});

describe("Preference merging", () => {
  it("partial update preserves unchanged event flags", () => {
    const merged = mergePrefs(DEFAULT_PREFS, { events: { ...DEFAULT_PREFS.events, alerts: false } });
    expect(merged.events.regressions).toBe(true);
    expect(merged.events.alerts).toBe(false);
  });

  it("partial update preserves emailEnabled", () => {
    const merged = mergePrefs(DEFAULT_PREFS, { slackEnabled: true });
    expect(merged.emailEnabled).toBe(true);
  });
});
