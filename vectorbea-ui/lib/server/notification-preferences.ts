import "server-only";

import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkspaceEventKey =
  | "alerts"
  | "regressions"
  | "evaluations"
  | "rollout"
  | "quota"
  | "providers"
  | "workspace";

export type UserEventKey =
  | "evaluation_failures"
  | "review_requests"
  | "invitations"
  | "rollout_decisions"
  | "alerts"
  | "evaluations"
  | "regressions"
  | "rollout"
  | "quota"
  | "providers"
  | "workspace";

export type NotificationSeverity = "info" | "warning" | "critical";

export interface NotificationEventContext {
  category: WorkspaceEventKey;
  severity?: NotificationSeverity;
  promptName?: string | null;
  environment?: string | null;
}

export interface RecipientPreferenceContext {
  role: string | null;
  userPrefs?: UserNotificationPrefs;
  workspacePrefs: WorkspaceNotificationPrefs;
}

export interface WorkspaceNotificationPrefs {
  workspaceId: string;
  emailEnabled: boolean;
  slackEnabled: boolean;
  events: Record<WorkspaceEventKey, boolean>;
  slackEvents: Record<WorkspaceEventKey, boolean>;
}

export interface UserNotificationPrefs {
  userId: string;
  events: Record<UserEventKey, boolean>;
  emailEnabled?: boolean;
  channels?: { email?: boolean; slack?: boolean };
  severityThreshold?: NotificationSeverity;
  filters?: {
    environments?: string[];
    prompts?: string[];
  };
}

const DEFAULT_WORKSPACE_EVENTS: Record<WorkspaceEventKey, boolean> = {
  alerts: true,
  regressions: true,
  evaluations: true,
  rollout: true,
  quota: true,
  providers: true,
  workspace: true,
};

const DEFAULT_SLACK_EVENTS: Record<WorkspaceEventKey, boolean> = {
  alerts: true,
  regressions: true,
  evaluations: false,
  rollout: true,
  quota: false,
  providers: true,
  workspace: false,
};

const DEFAULT_USER_EVENTS: Record<UserEventKey, boolean> = {
  evaluation_failures: true,
  review_requests: true,
  invitations: true,
  rollout_decisions: true,
  alerts: true,
  evaluations: true,
  regressions: true,
  rollout: true,
  quota: true,
  providers: true,
  workspace: true,
};

// ─── Workspace prefs ─────────────────────────────────────────────────────────

const DEFAULT_PREFS = (workspaceId: string): WorkspaceNotificationPrefs => ({
  workspaceId,
  emailEnabled: true,
  slackEnabled: false,
  events: { ...DEFAULT_WORKSPACE_EVENTS },
  slackEvents: { ...DEFAULT_SLACK_EVENTS },
});

export async function getWorkspaceNotificationPrefs(
  workspaceId: string,
): Promise<WorkspaceNotificationPrefs> {
  try {
    const supabase = createVectorBeaAdminClient();
    const { data, error } = await supabase
      .from("workspace_notification_prefs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    // If table doesn't exist or any DB error → use defaults so emails still go out
    if (error) return DEFAULT_PREFS(workspaceId);
    if (!data) return DEFAULT_PREFS(workspaceId);

    return {
      workspaceId,
      emailEnabled: data.email_enabled ?? true,
      slackEnabled: data.slack_enabled ?? false,
      events: { ...DEFAULT_WORKSPACE_EVENTS, ...(data.events as Record<WorkspaceEventKey, boolean> ?? {}) },
      slackEvents: { ...DEFAULT_SLACK_EVENTS, ...(data.slack_events as Record<WorkspaceEventKey, boolean> ?? {}) },
    };
  } catch {
    // Table doesn't exist yet — email is enabled by default so notifications go out
    return DEFAULT_PREFS(workspaceId);
  }
}

export async function upsertWorkspaceNotificationPrefs(
  workspaceId: string,
  updates: Partial<Omit<WorkspaceNotificationPrefs, "workspaceId">>,
): Promise<WorkspaceNotificationPrefs> {
  const current = await getWorkspaceNotificationPrefs(workspaceId);
  const merged = {
    ...current,
    ...updates,
    events: { ...current.events, ...(updates.events ?? {}) },
    slackEvents: { ...current.slackEvents, ...(updates.slackEvents ?? {}) },
  };

  const supabase = createVectorBeaAdminClient();
  await supabase
    .from("workspace_notification_prefs")
    .upsert({
      workspace_id: workspaceId,
      email_enabled: merged.emailEnabled,
      slack_enabled: merged.slackEnabled,
      events: merged.events,
      slack_events: merged.slackEvents,
      updated_at: new Date().toISOString(),
    }, { onConflict: "workspace_id" });

  return merged;
}

// ─── User prefs ───────────────────────────────────────────────────────────────

export async function getUserNotificationPrefs(userId: string): Promise<UserNotificationPrefs> {
  const supabase = createVectorBeaAdminClient();
  const { data } = await supabase
    .from("user_notification_prefs")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) {
    return {
      userId,
      events: { ...DEFAULT_USER_EVENTS },
      emailEnabled: true,
      channels: { email: true, slack: false },
      severityThreshold: "warning",
      filters: {},
    };
  }

  const raw = (data.events as Record<string, unknown> | null) ?? {};
  const channelsRaw = typeof raw.channels === "object" && raw.channels ? (raw.channels as { email?: boolean; slack?: boolean }) : {};
  const severity = raw.severity_threshold;
  const filtersRaw = typeof raw.filters === "object" && raw.filters ? (raw.filters as { environments?: string[]; prompts?: string[] }) : {};

  return {
    userId,
    events: { ...DEFAULT_USER_EVENTS, ...(raw as Record<UserEventKey, boolean>) },
    emailEnabled: typeof raw.email_enabled === "boolean" ? raw.email_enabled : true,
    channels: {
      email: typeof channelsRaw.email === "boolean" ? channelsRaw.email : true,
      slack: typeof channelsRaw.slack === "boolean" ? channelsRaw.slack : false,
    },
    severityThreshold:
      severity === "critical" || severity === "warning" || severity === "info"
        ? severity
        : "warning",
    filters: {
      environments: Array.isArray(filtersRaw.environments) ? filtersRaw.environments : [],
      prompts: Array.isArray(filtersRaw.prompts) ? filtersRaw.prompts : [],
    },
  };
}

export async function upsertUserNotificationPrefs(
  userId: string,
  updates: Partial<Record<UserEventKey, boolean>>,
): Promise<UserNotificationPrefs> {
  const current = await getUserNotificationPrefs(userId);
  const merged = { ...current.events, ...updates };

  const supabase = createVectorBeaAdminClient();
  await supabase
    .from("user_notification_prefs")
    .upsert({
      user_id: userId,
      events: merged,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

  return { userId, events: merged };
}

// ─── Convenience helpers ──────────────────────────────────────────────────────

/** Should we send an email for this workspace-level event? */
export async function shouldEmailWorkspace(workspaceId: string, event: WorkspaceEventKey): Promise<boolean> {
  const prefs = await getWorkspaceNotificationPrefs(workspaceId);
  const enabled = prefs.emailEnabled && (prefs.events[event] ?? true);
  if (!enabled) console.log(`[notifications] email skipped — workspace=${workspaceId} event=${event} emailEnabled=${prefs.emailEnabled} eventEnabled=${prefs.events[event]}`);
  return enabled;
}

/** Should we send a Slack notification for this workspace-level event? */
export async function shouldSlackWorkspace(workspaceId: string, event: WorkspaceEventKey): Promise<boolean> {
  const prefs = await getWorkspaceNotificationPrefs(workspaceId);
  const enabled = prefs.slackEnabled && (prefs.slackEvents[event] ?? false);
  if (!enabled) console.log(`[notifications] slack skipped — workspace=${workspaceId} event=${event} slackEnabled=${prefs.slackEnabled} eventEnabled=${prefs.slackEvents[event]}`);
  return enabled;
}

function severityRank(severity: NotificationSeverity): number {
  if (severity === "critical") return 3;
  if (severity === "warning") return 2;
  return 1;
}

export function shouldNotifyRecipientByContext(
  ctx: RecipientPreferenceContext,
  event: NotificationEventContext,
): boolean {
  if (!ctx.workspacePrefs.emailEnabled) return false;
  if (!(ctx.workspacePrefs.events[event.category] ?? true)) return false;

  const userPrefs = ctx.userPrefs;
  if (!userPrefs) return true;

  if (userPrefs.emailEnabled === false) return false;
  if (userPrefs.channels?.email === false) return false;

  const userEventEnabled = userPrefs.events[event.category as UserEventKey];
  if (typeof userEventEnabled === "boolean" && !userEventEnabled) return false;

  const threshold = userPrefs.severityThreshold ?? "warning";
  const severity = event.severity ?? "warning";
  if (severityRank(severity) < severityRank(threshold)) return false;

  const environmentFilters = userPrefs.filters?.environments ?? [];
  if (environmentFilters.length > 0 && event.environment) {
    if (!environmentFilters.includes(event.environment)) return false;
  }

  const promptFilters = userPrefs.filters?.prompts ?? [];
  if (promptFilters.length > 0 && event.promptName) {
    if (!promptFilters.includes(event.promptName)) return false;
  }

  if (event.category === "quota") {
    const role = (ctx.role ?? "").toLowerCase();
    if (role && role !== "owner" && role !== "admin") return false;
  }

  return true;
}
