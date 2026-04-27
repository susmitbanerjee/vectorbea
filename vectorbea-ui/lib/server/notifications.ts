import "server-only";

/**
 * Unified notification dispatcher.
 * Checks workspace preferences before sending email or Slack.
 * All errors are caught — notifications must never break the main flow.
 */

import { sendEmail } from "@/lib/server/email";
import {
  alertTriggeredEmail,
  evaluationCompletedEmail,
  evaluationFailedEmail,
  quotaWarningEmail,
  regressionFailedEmail,
  rolloutBlockedEmail,
} from "@/lib/server/email-templates";
import {
  sendSlackNotification,
  slackAlertTriggered,
  slackEvaluationCompleted,
  slackEvaluationFailed,
  slackRegressionFailed,
  slackRolloutBlocked,
  slackPromptPromoted,
} from "@/lib/server/slack";
import { shouldEmailWorkspace, shouldSlackWorkspace } from "@/lib/server/notification-preferences";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

const appUrl = () => process.env.APP_URL ?? "https://app.vectorbea.app";

async function getWorkspaceName(workspaceId: string): Promise<string> {
  try {
    const supabase = createVectorBeaAdminClient();
    const { data } = await supabase
      .from("workspaces")
      .select("name")
      .eq("id", workspaceId)
      .maybeSingle();
    return data?.name ?? workspaceId;
  } catch {
    return workspaceId;
  }
}

async function getWorkspaceAdminEmails(workspaceId: string): Promise<string[]> {
  try {
    const supabase = createVectorBeaAdminClient();
    const { data: members } = await supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .in("role", ["admin", "owner"]);
    if (!members?.length) return [];
    const userIds = members.map((m) => m.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("email")
      .in("id", userIds);
    return (profiles ?? []).map((p) => p.email).filter(Boolean) as string[];
  } catch {
    return [];
  }
}

async function safeRun(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    console.warn(`[notifications] ${label} failed:`, err instanceof Error ? err.message : err);
  }
}

// ─── Public dispatch functions ────────────────────────────────────────────────

export async function notifyEvaluationCompleted(args: {
  workspaceId: string;
  promptName: string;
  versionTag: string;
  recommendation: string;
  score: number | null;
  runId: string;
}) {
  const runUrl = `${appUrl()}/evaluations/${args.runId}?org=${encodeURIComponent(args.workspaceId)}`;

  await safeRun("slack:evaluation_completed", async () => {
    if (!(await shouldSlackWorkspace(args.workspaceId, "evaluations"))) return;
    const wn = await getWorkspaceName(args.workspaceId);
    await sendSlackNotification(args.workspaceId, slackEvaluationCompleted({ ...args, workspaceName: wn, runUrl }));
  });

  await safeRun("email:evaluation_completed", async () => {
    if (!(await shouldEmailWorkspace(args.workspaceId, "evaluations"))) return;
    const [wn, emails] = await Promise.all([getWorkspaceName(args.workspaceId), getWorkspaceAdminEmails(args.workspaceId)]);
    const tmpl = evaluationCompletedEmail({ ...args, workspaceName: wn, runUrl });
    await Promise.all(emails.map((to) => sendEmail({ ...tmpl, to })));
  });
}

export async function notifyEvaluationFailed(args: {
  workspaceId: string;
  promptName: string;
  versionTag: string;
  reason: string;
  runId: string;
}) {
  const runUrl = `${appUrl()}/evaluations/${args.runId}?org=${encodeURIComponent(args.workspaceId)}`;

  await safeRun("slack:evaluation_failed", async () => {
    if (!(await shouldSlackWorkspace(args.workspaceId, "evaluations"))) return;
    const wn = await getWorkspaceName(args.workspaceId);
    await sendSlackNotification(args.workspaceId, slackEvaluationFailed({ ...args, workspaceName: wn, runUrl }));
  });

  await safeRun("email:evaluation_failed", async () => {
    if (!(await shouldEmailWorkspace(args.workspaceId, "evaluations"))) return;
    const [wn, emails] = await Promise.all([getWorkspaceName(args.workspaceId), getWorkspaceAdminEmails(args.workspaceId)]);
    const tmpl = evaluationFailedEmail({ ...args, workspaceName: wn, runUrl });
    await Promise.all(emails.map((to) => sendEmail({ ...tmpl, to })));
  });
}

export async function notifyRegressionFailed(args: {
  workspaceId: string;
  scheduleName: string;
  promptName: string | null;
  reason: string;
  runId: string | null;
}) {
  const runUrl = args.runId ? `${appUrl()}/evaluations/${args.runId}?org=${encodeURIComponent(args.workspaceId)}` : null;

  await safeRun("slack:regression_failed", async () => {
    if (!(await shouldSlackWorkspace(args.workspaceId, "regressions"))) return;
    const wn = await getWorkspaceName(args.workspaceId);
    await sendSlackNotification(args.workspaceId, slackRegressionFailed({ ...args, workspaceName: wn, runUrl }));
  });

  await safeRun("email:regression_failed", async () => {
    if (!(await shouldEmailWorkspace(args.workspaceId, "regressions"))) return;
    const [wn, emails] = await Promise.all([getWorkspaceName(args.workspaceId), getWorkspaceAdminEmails(args.workspaceId)]);
    const tmpl = regressionFailedEmail({ ...args, workspaceName: wn, runUrl });
    await Promise.all(emails.map((to) => sendEmail({ ...tmpl, to })));
  });
}

export async function notifyAlertTriggered(args: {
  workspaceId: string;
  ruleName: string;
  metricType: string;
  metricValue: number;
  threshold: number;
  comparison: string;
}) {
  const alertsUrl = `${appUrl()}/alerts?org=${encodeURIComponent(args.workspaceId)}`;

  await safeRun("slack:alert_triggered", async () => {
    if (!(await shouldSlackWorkspace(args.workspaceId, "alerts"))) return;
    const wn = await getWorkspaceName(args.workspaceId);
    await sendSlackNotification(args.workspaceId, slackAlertTriggered({ ...args, workspaceName: wn, alertsUrl }));
  });

  await safeRun("email:alert_triggered", async () => {
    if (!(await shouldEmailWorkspace(args.workspaceId, "alerts"))) return;
    const [wn, emails] = await Promise.all([getWorkspaceName(args.workspaceId), getWorkspaceAdminEmails(args.workspaceId)]);
    const tmpl = alertTriggeredEmail({ ...args, workspaceName: wn, alertsUrl });
    await Promise.all(emails.map((to) => sendEmail({ ...tmpl, to })));
  });
}

export async function notifyRolloutBlocked(args: {
  workspaceId: string;
  promptName: string;
  promptId: string;
  versionTag: string;
  reasons: string[];
}) {
  const promptUrl = `${appUrl()}/prompts/${args.promptId}?org=${encodeURIComponent(args.workspaceId)}`;

  await safeRun("slack:rollout_blocked", async () => {
    if (!(await shouldSlackWorkspace(args.workspaceId, "rollout"))) return;
    const wn = await getWorkspaceName(args.workspaceId);
    await sendSlackNotification(args.workspaceId, slackRolloutBlocked({ ...args, workspaceName: wn, promptUrl }));
  });

  await safeRun("email:rollout_blocked", async () => {
    if (!(await shouldEmailWorkspace(args.workspaceId, "rollout"))) return;
    const [wn, emails] = await Promise.all([getWorkspaceName(args.workspaceId), getWorkspaceAdminEmails(args.workspaceId)]);
    const tmpl = rolloutBlockedEmail({ ...args, workspaceName: wn, promptUrl });
    await Promise.all(emails.map((to) => sendEmail({ ...tmpl, to })));
  });
}

export async function notifyPromptPromoted(args: {
  workspaceId: string;
  promptName: string;
  promptId: string;
  versionTag: string;
  promotedBy: string;
}) {
  const promptUrl = `${appUrl()}/prompts/${args.promptId}?org=${encodeURIComponent(args.workspaceId)}`;

  await safeRun("slack:prompt_promoted", async () => {
    if (!(await shouldSlackWorkspace(args.workspaceId, "rollout"))) return;
    const wn = await getWorkspaceName(args.workspaceId);
    await sendSlackNotification(args.workspaceId, slackPromptPromoted({ ...args, workspaceName: wn, promptUrl }));
  });
}

export async function notifyQuotaWarning(args: {
  workspaceId: string;
  usageType: string;
  used: number;
  limit: number;
}) {
  const billingUrl = `${appUrl()}/settings/billing?org=${encodeURIComponent(args.workspaceId)}`;
  const pct = Math.round((args.used / args.limit) * 100);

  await safeRun("email:quota_warning", async () => {
    if (!(await shouldEmailWorkspace(args.workspaceId, "quota"))) return;
    const [wn, emails] = await Promise.all([getWorkspaceName(args.workspaceId), getWorkspaceAdminEmails(args.workspaceId)]);
    const tmpl = quotaWarningEmail({ ...args, workspaceName: wn, billingUrl });
    await Promise.all(emails.map((to) => sendEmail({ ...tmpl, to })));
  });

  await safeRun("slack:quota_warning", async () => {
    if (!(await shouldSlackWorkspace(args.workspaceId, "quota"))) return;
    const { slackQuotaWarning } = await import("@/lib/server/slack");
    const wn = await getWorkspaceName(args.workspaceId);
    await sendSlackNotification(args.workspaceId, slackQuotaWarning({ workspaceName: wn, usageType: args.usageType, pct, billingUrl }));
  });
}
