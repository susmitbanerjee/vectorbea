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
  promptPromotedEmail,
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
import { createSupabaseAdminClient, createVectorBeaAdminClient } from "@/lib/supabase-admin";

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
    // Get all admin members (roles: admin, owner, editor — not viewer-only)
    const supabase = createVectorBeaAdminClient();
    const { data: members, error: memberError } = await supabase
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", workspaceId)
      .in("role", ["admin", "owner", "editor"]);

    if (memberError) {
      console.error("[notifications] workspace_members query failed:", memberError.message);
      return [];
    }
    if (!members?.length) {
      console.warn("[notifications] No members found for workspace:", workspaceId);
      return [];
    }

    // Look up emails from auth.users via the service-role admin client
    const adminClient = createSupabaseAdminClient();
    const emails: string[] = [];
    for (const member of members) {
      const { data, error } = await adminClient.auth.admin.getUserById(member.user_id as string);
      if (error) {
        console.warn("[notifications] getUserById failed for", member.user_id, error.message);
        continue;
      }
      if (data?.user?.email) emails.push(data.user.email);
    }
    console.log(`[notifications] Resolved ${emails.length} recipient(s) for workspace ${workspaceId}:`, emails);
    return emails;
  } catch (err) {
    console.error("[notifications] getWorkspaceAdminEmails error:", err instanceof Error ? err.message : err);
    return [];
  }
}

async function safeRun(label: string, fn: () => Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    console.log(`[notifications] ✓ ${label} sent (${Date.now() - start}ms)`);
  } catch (err) {
    console.error(`[notifications] ✗ ${label} failed (${Date.now() - start}ms):`, err instanceof Error ? err.message : err);
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

  await safeRun("email:prompt_promoted", async () => {
    if (!(await shouldEmailWorkspace(args.workspaceId, "rollout"))) return;
    const [wn, emails] = await Promise.all([getWorkspaceName(args.workspaceId), getWorkspaceAdminEmails(args.workspaceId)]);
    const tmpl = promptPromotedEmail({ ...args, workspaceName: wn, promptUrl });
    await Promise.all(emails.map((to) => sendEmail({ ...tmpl, to })));
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
