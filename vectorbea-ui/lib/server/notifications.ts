import "server-only";

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
  slackPromptPromoted,
  slackRegressionFailed,
  slackRolloutBlocked,
} from "@/lib/server/slack";
import {
  getUserNotificationPrefs,
  getWorkspaceNotificationPrefs,
  shouldNotifyRecipientByContext,
  shouldSlackWorkspace,
  type NotificationEventContext,
} from "@/lib/server/notification-preferences";
import { createSupabaseAdminClient, createVectorBeaAdminClient } from "@/lib/supabase-admin";

const appUrl = () => process.env.APP_URL ?? "https://app.vectorbea.app";

interface NotificationRecipient {
  userId: string;
  role: string | null;
  email: string;
}

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

async function getWorkspaceRecipients(workspaceId: string): Promise<NotificationRecipient[]> {
  try {
    const supabase = createVectorBeaAdminClient();
    const { data: members, error } = await supabase
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", workspaceId);
    if (error || !members?.length) return [];

    const admin = createSupabaseAdminClient();
    const recipients: NotificationRecipient[] = [];
    for (const member of members) {
      const { data, error: userError } = await admin.auth.admin.getUserById(member.user_id as string);
      if (userError || !data?.user?.email) continue;
      recipients.push({
        userId: member.user_id as string,
        role: (member.role as string | null) ?? null,
        email: data.user.email,
      });
    }
    return recipients;
  } catch {
    return [];
  }
}

async function resolveEmailRecipients(args: {
  workspaceId: string;
  event: NotificationEventContext;
}): Promise<string[]> {
  const [workspacePrefs, recipients] = await Promise.all([
    getWorkspaceNotificationPrefs(args.workspaceId),
    getWorkspaceRecipients(args.workspaceId),
  ]);
  if (!workspacePrefs.emailEnabled) return [];
  if (!(workspacePrefs.events[args.event.category] ?? true)) return [];

  const result: string[] = [];
  for (const recipient of recipients) {
    const userPrefs = await getUserNotificationPrefs(recipient.userId).catch(() => undefined);
    if (
      shouldNotifyRecipientByContext(
        { workspacePrefs, userPrefs, role: recipient.role },
        args.event,
      )
    ) {
      result.push(recipient.email);
    }
  }
  return result;
}

async function recordNotificationDelivery(args: {
  workspaceId: string;
  channel: "email" | "slack";
  eventType: string;
  recipient: string;
  status: "sent" | "failed";
  reason?: string;
}) {
  try {
    const supabase = createVectorBeaAdminClient();
    await supabase.schema("vectorbea").from("notification_deliveries").insert({
      workspace_id: args.workspaceId,
      channel: args.channel,
      event_type: args.eventType,
      recipient: args.recipient,
      status: args.status,
      reason: args.reason ?? null,
      created_at: new Date().toISOString(),
    });
  } catch {
    // optional table
  }
}

async function safeRun(label: string, fn: () => Promise<void>) {
  const startedAt = Date.now();
  try {
    await fn();
    console.log(`[notifications] ok ${label} ${Date.now() - startedAt}ms`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[notifications] failed ${label}: ${message}`);
  }
}

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
    const workspaceName = await getWorkspaceName(args.workspaceId);
    await sendSlackNotification(
      args.workspaceId,
      slackEvaluationCompleted({ ...args, workspaceName, runUrl }),
    );
  });

  await safeRun("email:evaluation_completed", async () => {
    const [workspaceName, recipients] = await Promise.all([
      getWorkspaceName(args.workspaceId),
      resolveEmailRecipients({
        workspaceId: args.workspaceId,
        event: { category: "evaluations", severity: "info", promptName: args.promptName },
      }),
    ]);
    const template = evaluationCompletedEmail({ ...args, workspaceId: args.workspaceId, workspaceName, runUrl });
    await Promise.all(
      recipients.map(async (email) => {
        const result = await sendEmail({ ...template, to: email });
        await recordNotificationDelivery({
          workspaceId: args.workspaceId,
          channel: "email",
          eventType: "EVALUATION_COMPLETED",
          recipient: email,
          status: result.ok ? "sent" : "failed",
          reason: result.error,
        });
      }),
    );
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
    const workspaceName = await getWorkspaceName(args.workspaceId);
    await sendSlackNotification(
      args.workspaceId,
      slackEvaluationFailed({ ...args, workspaceName, runUrl }),
    );
  });

  await safeRun("email:evaluation_failed", async () => {
    const [workspaceName, recipients] = await Promise.all([
      getWorkspaceName(args.workspaceId),
      resolveEmailRecipients({
        workspaceId: args.workspaceId,
        event: { category: "evaluations", severity: "critical", promptName: args.promptName },
      }),
    ]);
    const template = evaluationFailedEmail({ ...args, workspaceId: args.workspaceId, workspaceName, runUrl });
    await Promise.all(
      recipients.map(async (email) => {
        const result = await sendEmail({ ...template, to: email });
        await recordNotificationDelivery({
          workspaceId: args.workspaceId,
          channel: "email",
          eventType: "EVALUATION_FAILED",
          recipient: email,
          status: result.ok ? "sent" : "failed",
          reason: result.error,
        });
      }),
    );
  });
}

export async function notifyRegressionFailed(args: {
  workspaceId: string;
  scheduleName: string;
  promptName: string | null;
  reason: string;
  runId: string | null;
}) {
  const runUrl = args.runId
    ? `${appUrl()}/evaluations/${args.runId}?org=${encodeURIComponent(args.workspaceId)}`
    : null;

  await safeRun("slack:regression_failed", async () => {
    if (!(await shouldSlackWorkspace(args.workspaceId, "regressions"))) return;
    const workspaceName = await getWorkspaceName(args.workspaceId);
    await sendSlackNotification(
      args.workspaceId,
      slackRegressionFailed({ ...args, workspaceName, runUrl }),
    );
  });

  await safeRun("email:regression_failed", async () => {
    const [workspaceName, recipients] = await Promise.all([
      getWorkspaceName(args.workspaceId),
      resolveEmailRecipients({
        workspaceId: args.workspaceId,
        event: { category: "regressions", severity: "critical", promptName: args.promptName },
      }),
    ]);
    const template = regressionFailedEmail({ ...args, workspaceId: args.workspaceId, workspaceName, runUrl });
    await Promise.all(
      recipients.map(async (email) => {
        const result = await sendEmail({ ...template, to: email });
        await recordNotificationDelivery({
          workspaceId: args.workspaceId,
          channel: "email",
          eventType: "REGRESSION_FAILED",
          recipient: email,
          status: result.ok ? "sent" : "failed",
          reason: result.error,
        });
      }),
    );
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
  const severity: "warning" | "critical" =
    args.metricType === "error_rate" && args.metricValue >= args.threshold * 2
      ? "critical"
      : "warning";

  await safeRun("slack:alert_triggered", async () => {
    if (!(await shouldSlackWorkspace(args.workspaceId, "alerts"))) return;
    const workspaceName = await getWorkspaceName(args.workspaceId);
    await sendSlackNotification(
      args.workspaceId,
      slackAlertTriggered({ ...args, workspaceName, alertsUrl }),
    );
  });

  await safeRun("email:alert_triggered", async () => {
    const [workspaceName, recipients] = await Promise.all([
      getWorkspaceName(args.workspaceId),
      resolveEmailRecipients({
        workspaceId: args.workspaceId,
        event: { category: "alerts", severity },
      }),
    ]);
    const template = alertTriggeredEmail({ ...args, workspaceId: args.workspaceId, workspaceName, alertsUrl });
    await Promise.all(
      recipients.map(async (email) => {
        const result = await sendEmail({ ...template, to: email });
        await recordNotificationDelivery({
          workspaceId: args.workspaceId,
          channel: "email",
          eventType: "ALERT_TRIGGERED",
          recipient: email,
          status: result.ok ? "sent" : "failed",
          reason: result.error,
        });
      }),
    );
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
    const workspaceName = await getWorkspaceName(args.workspaceId);
    await sendSlackNotification(
      args.workspaceId,
      slackRolloutBlocked({ ...args, workspaceName, promptUrl }),
    );
  });

  await safeRun("email:rollout_blocked", async () => {
    const [workspaceName, recipients] = await Promise.all([
      getWorkspaceName(args.workspaceId),
      resolveEmailRecipients({
        workspaceId: args.workspaceId,
        event: { category: "rollout", severity: "critical", promptName: args.promptName },
      }),
    ]);
    const template = rolloutBlockedEmail({ ...args, workspaceId: args.workspaceId, workspaceName, promptUrl });
    await Promise.all(
      recipients.map(async (email) => {
        const result = await sendEmail({ ...template, to: email });
        await recordNotificationDelivery({
          workspaceId: args.workspaceId,
          channel: "email",
          eventType: "ROLLOUT_BLOCKED",
          recipient: email,
          status: result.ok ? "sent" : "failed",
          reason: result.error,
        });
      }),
    );
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
    const workspaceName = await getWorkspaceName(args.workspaceId);
    await sendSlackNotification(
      args.workspaceId,
      slackPromptPromoted({ ...args, workspaceName, promptUrl }),
    );
  });

  await safeRun("email:prompt_promoted", async () => {
    const [workspaceName, recipients] = await Promise.all([
      getWorkspaceName(args.workspaceId),
      resolveEmailRecipients({
        workspaceId: args.workspaceId,
        event: { category: "rollout", severity: "info", promptName: args.promptName },
      }),
    ]);
    const template = promptPromotedEmail({ ...args, workspaceId: args.workspaceId, workspaceName, promptUrl });
    await Promise.all(
      recipients.map(async (email) => {
        const result = await sendEmail({ ...template, to: email });
        await recordNotificationDelivery({
          workspaceId: args.workspaceId,
          channel: "email",
          eventType: "ROLLOUT_APPROVED",
          recipient: email,
          status: result.ok ? "sent" : "failed",
          reason: result.error,
        });
      }),
    );
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
    const [workspaceName, recipients] = await Promise.all([
      getWorkspaceName(args.workspaceId),
      resolveEmailRecipients({
        workspaceId: args.workspaceId,
        event: { category: "quota", severity: pct >= 100 ? "critical" : "warning" },
      }),
    ]);
    const template = quotaWarningEmail({ ...args, workspaceId: args.workspaceId, workspaceName, billingUrl });
    await Promise.all(
      recipients.map(async (email) => {
        const result = await sendEmail({ ...template, to: email });
        await recordNotificationDelivery({
          workspaceId: args.workspaceId,
          channel: "email",
          eventType: pct >= 100 ? "QUOTA_EXCEEDED" : "QUOTA_NEARING",
          recipient: email,
          status: result.ok ? "sent" : "failed",
          reason: result.error,
        });
      }),
    );
  });

  await safeRun("slack:quota_warning", async () => {
    if (!(await shouldSlackWorkspace(args.workspaceId, "quota"))) return;
    const { slackQuotaWarning } = await import("@/lib/server/slack");
    const workspaceName = await getWorkspaceName(args.workspaceId);
    await sendSlackNotification(
      args.workspaceId,
      slackQuotaWarning({ workspaceName, usageType: args.usageType, pct, billingUrl }),
    );
  });
}
