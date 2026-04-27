import "server-only";

import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkspaceEventKey =
  | "alerts"
  | "regressions"
  | "evaluations"
  | "rollout"
  | "quota";

export type UserEventKey =
  | "evaluation_failures"
  | "review_requests"
  | "invitations"
  | "rollout_decisions";

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
}

const DEFAULT_WORKSPACE_EVENTS: Record<WorkspaceEventKey, boolean> = {
  alerts: true,
  regressions: true,
  evaluations: true,
  rollout: true,
  quota: true,
};

const DEFAULT_SLACK_EVENTS: Record<WorkspaceEventKey, boolean> = {
  alerts: true,
  regressions: true,
  evaluations: false,
  rollout: true,
  quota: false,
};

const DEFAULT_USER_EVENTS: Record<UserEventKey, boolean> = {
  evaluation_failures: true,
  review_requests: true,
  invitations: true,
  rollout_decisions: true,
};

// ─── Workspace prefs ─────────────────────────────────────────────────────────

export async function getWorkspaceNotificationPrefs(
  workspaceId: string,
): Promise<WorkspaceNotificationPrefs> {
  const supabase = createVectorBeaAdminClient();
  const { data } = await supabase
    .schema("vectorbea")
    .from("workspace_notification_prefs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!data) {
    return {
      workspaceId,
      emailEnabled: true,
      slackEnabled: false,
      events: { ...DEFAULT_WORKSPACE_EVENTS },
      slackEvents: { ...DEFAULT_SLACK_EVENTS },
    };
  }

  return {
    workspaceId,
    emailEnabled: data.email_enabled ?? true,
    slackEnabled: data.slack_enabled ?? false,
    events: { ...DEFAULT_WORKSPACE_EVENTS, ...(data.events as Record<WorkspaceEventKey, boolean> ?? {}) },
    slackEvents: { ...DEFAULT_SLACK_EVENTS, ...(data.slack_events as Record<WorkspaceEventKey, boolean> ?? {}) },
  };
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
    .schema("vectorbea")
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
    .schema("vectorbea")
    .from("user_notification_prefs")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) {
    return { userId, events: { ...DEFAULT_USER_EVENTS } };
  }

  return {
    userId,
    events: { ...DEFAULT_USER_EVENTS, ...(data.events as Record<UserEventKey, boolean> ?? {}) },
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
    .schema("vectorbea")
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
  return prefs.emailEnabled && (prefs.events[event] ?? true);
}

/** Should we send a Slack notification for this workspace-level event? */
export async function shouldSlackWorkspace(workspaceId: string, event: WorkspaceEventKey): Promise<boolean> {
  const prefs = await getWorkspaceNotificationPrefs(workspaceId);
  return prefs.slackEnabled && (prefs.slackEvents[event] ?? false);
}
