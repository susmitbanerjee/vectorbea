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

// ─── Internal types ───────────────────────────────────────────────────────────

interface NotificationRecipient {
  userId: string;
  role: string | null;
  email: string;
}

type DeliveryStatus = "sent" | "skipped" | "failed";

// ─── Workspace helpers ────────────────────────────────────────────────────────

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

    // Primary path: resolve member emails from profiles table.
    // This is more reliable than auth admin lookups in restricted environments.
    const memberIds = members.map((m) => String(m.user_id));
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", memberIds);
    const profileEmailById = new Map(
      (profiles ?? [])
        .filter((p) => typeof p.id === "string" && typeof p.email === "string" && p.email.trim().length > 0)
        .map((p) => [String(p.id), String(p.email)]),
    );

    const adminClient = createSupabaseAdminClient();
    const recipients: NotificationRecipient[] = [];
    for (const member of members) {
      const userId = String(member.user_id);
      let email = profileEmailById.get(userId) ?? null;
      if (!email) {
        const { data, error: userError } = await adminClient.auth.admin.getUserById(userId);
        if (!userError && data?.user?.email) {
          email = data.user.email;
        }
      }
      if (!email) continue;
      recipients.push({
        userId,
        role: (member.role as string | null) ?? null,
        email,
      });
    }
    return recipients;
  } catch {
    return [];
  }
}

// ─── Idempotency ─────────────────────────────────────────────────────────────

/** Returns true if this email has already been sent (prevents duplicate sends). */
async function alreadySent(args: {
  eventType: string;
  eventId: string | null | undefined;
  recipientEmail: string;
  channel: string;
}): Promise<boolean> {
  if (!args.eventId) return false;
  try {
    const supabase = createVectorBeaAdminClient();
    const { data } = await supabase
      .from("notification_deliveries")
      .select("id")
      .eq("event_type", args.eventType)
      .eq("event_id", args.eventId)
      .eq("recipient_email", args.recipientEmail)
      .eq("channel", args.channel)
      .eq("status", "sent")
      .maybeSingle();
    return Boolean(data);
  } catch {
    return false; // If we can't check, allow send (better to duplicate than miss)
  }
}

// ─── Audit log ───────────────────────────────────────────────────────────────

async function recordDelivery(args: {
  workspaceId: string;
  channel: "email" | "slack";
  eventType: string;
  eventId?: string | null;
  recipientUserId?: string | null;
  recipientEmail: string;
  status: DeliveryStatus;
  skipReason?: string;
  providerMessageId?: string;
  errorMessage?: string;
}) {
  try {
    const supabase = createVectorBeaAdminClient();
    await supabase.from("notification_deliveries").insert({
      workspace_id: args.workspaceId,
      channel: args.channel,
      event_type: args.eventType,
      event_id: args.eventId ?? null,
      recipient_user_id: args.recipientUserId ?? null,
      recipient_email: args.recipientEmail,
      status: args.status,
      skip_reason: args.skipReason ?? null,
      provider_message_id: args.providerMessageId ?? null,
      error_message: args.errorMessage ?? null,
      sent_at: args.status === "sent" ? new Date().toISOString() : null,
      created_at: new Date().toISOString(),
    });
  } catch {
    // Audit table may not exist yet — never fail the main flow
  }
}

// ─── Recipient / preference resolution ───────────────────────────────────────

interface ResolvedRecipient extends NotificationRecipient {
  skipReason?: string;
}

async function resolveEmailRecipients(args: {
  workspaceId: string;
  event: NotificationEventContext;
  /** Override: only consider these user IDs (in addition to normal resolution). */
  targetUserIds?: string[];
}): Promise<ResolvedRecipient[]> {
  const [workspacePrefs, recipients] = await Promise.all([
    getWorkspaceNotificationPrefs(args.workspaceId),
    getWorkspaceRecipients(args.workspaceId),
  ]);

  if (!workspacePrefs.emailEnabled) {
    console.log(`[notifications] email skipped — workspace=${args.workspaceId} emailEnabled=false`);
    return [];
  }
  if (!(workspacePrefs.events[args.event.category] ?? true)) {
    console.log(`[notifications] email skipped — workspace=${args.workspaceId} category=${args.event.category} disabled`);
    return [];
  }

  const result: ResolvedRecipient[] = [];
  for (const recipient of recipients) {
    // If targetUserIds is provided, skip members not in the target list
    if (args.targetUserIds && args.targetUserIds.length > 0) {
      if (!args.targetUserIds.includes(recipient.userId)) continue;
    }

    const userPrefs = await getUserNotificationPrefs(recipient.userId).catch(() => undefined);
    const allowed = shouldNotifyRecipientByContext(
      { workspacePrefs, userPrefs, role: recipient.role },
      args.event,
    );

    if (allowed) {
      result.push(recipient);
    } else {
      // Determine skip reason for audit
      let skipReason = "preference_filtered";
      if (!userPrefs) {
        skipReason = "no_user_prefs";
      } else if (userPrefs.emailEnabled === false) {
        skipReason = "email_channel_disabled";
      } else if (userPrefs.channels?.email === false) {
        skipReason = "email_channel_disabled";
      } else if (args.event.severity) {
        const sev = args.event.severity;
        const threshold = userPrefs.severityThreshold ?? "info";
        const rankMap = { info: 1, warning: 2, critical: 3 };
        if ((rankMap[sev] ?? 1) < (rankMap[threshold] ?? 1)) {
          skipReason = "severity_below_threshold";
        }
      }
      result.push({ ...recipient, skipReason });
    }
  }
  return result;
}

// ─── Safe wrapper ─────────────────────────────────────────────────────────────

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

// ─── Send with audit ──────────────────────────────────────────────────────────

async function sendWithAudit(args: {
  workspaceId: string;
  eventType: string;
  eventId?: string | null;
  recipients: ResolvedRecipient[];
  template: { subject: string; html: string; text: string };
  channel: "email";
}) {
  await Promise.all(
    args.recipients.map(async (recipient) => {
      if (recipient.skipReason) {
        await recordDelivery({
          workspaceId: args.workspaceId,
          channel: args.channel,
          eventType: args.eventType,
          eventId: args.eventId,
          recipientUserId: recipient.userId,
          recipientEmail: recipient.email,
          status: "skipped",
          skipReason: recipient.skipReason,
        });
        return;
      }

      // Idempotency check
      if (await alreadySent({ eventType: args.eventType, eventId: args.eventId, recipientEmail: recipient.email, channel: args.channel })) {
        console.log(`[notifications] idempotency skip ${args.eventType} → ${recipient.email}`);
        await recordDelivery({
          workspaceId: args.workspaceId,
          channel: args.channel,
          eventType: args.eventType,
          eventId: args.eventId,
          recipientUserId: recipient.userId,
          recipientEmail: recipient.email,
          status: "skipped",
          skipReason: "already_sent",
        });
        return;
      }

      const result = await sendEmail({ ...args.template, to: recipient.email });
      await recordDelivery({
        workspaceId: args.workspaceId,
        channel: args.channel,
        eventType: args.eventType,
        eventId: args.eventId,
        recipientUserId: recipient.userId,
        recipientEmail: recipient.email,
        status: result.ok ? "sent" : "failed",
        errorMessage: result.ok ? undefined : result.error,
      });

      if (!result.ok) {
        console.error(`[notifications] email failed ${args.eventType} → ${recipient.email}: ${result.error}`);
      } else {
        console.log(`[notifications] email sent ${args.eventType} → ${recipient.email}`);
      }
    }),
  );
}

// ─── Public notification functions ───────────────────────────────────────────

export async function notifyEvaluationCompleted(args: {
  workspaceId: string;
  promptName: string;
  versionTag: string;
  recommendation: string;
  score: number | null;
  runId: string;
  // Rich context — optional for backwards compatibility
  datasetName?: string | null;
  runType?: "baseline" | "behavioral" | "trace_set";
  passRate?: number | null;
  totalCount?: number;
  failedCount?: number;
  needsReviewCount?: number;
  hardFailureCount?: number;
  averageConfidence?: number | null;
  rubricName?: string | null;
  provider?: string | null;
  model?: string | null;
  durationMs?: number | null;
  startedBy?: string | null;
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
    const [workspaceName, resolved] = await Promise.all([
      getWorkspaceName(args.workspaceId),
      resolveEmailRecipients({
        workspaceId: args.workspaceId,
        // Use "warning" not "info" so the default threshold doesn't filter it out
        event: { category: "evaluations", severity: "warning", promptName: args.promptName },
      }),
    ]);
    const template = evaluationCompletedEmail({ ...args, workspaceId: args.workspaceId, workspaceName, runUrl });
    await sendWithAudit({
      workspaceId: args.workspaceId,
      eventType: "EVALUATION_COMPLETED",
      eventId: args.runId,
      recipients: resolved,
      template,
      channel: "email",
    });
  });
}

export async function notifyEvaluationFailed(args: {
  workspaceId: string;
  promptName: string;
  versionTag: string;
  reason: string;
  runId?: string;
  datasetName?: string | null;
  runType?: "baseline" | "behavioral" | "trace_set";
  provider?: string | null;
  model?: string | null;
  startedBy?: string | null;
}) {
  const runUrl = args.runId
    ? `${appUrl()}/evaluations/${args.runId}?org=${encodeURIComponent(args.workspaceId)}`
    : `${appUrl()}/evaluations?org=${encodeURIComponent(args.workspaceId)}`;

  await safeRun("slack:evaluation_failed", async () => {
    if (!(await shouldSlackWorkspace(args.workspaceId, "evaluations"))) return;
    const workspaceName = await getWorkspaceName(args.workspaceId);
    await sendSlackNotification(
      args.workspaceId,
      slackEvaluationFailed({ ...args, workspaceName, runUrl }),
    );
  });

  await safeRun("email:evaluation_failed", async () => {
    const [workspaceName, resolved] = await Promise.all([
      getWorkspaceName(args.workspaceId),
      resolveEmailRecipients({
        workspaceId: args.workspaceId,
        event: { category: "evaluations", severity: "critical", promptName: args.promptName },
      }),
    ]);
    const template = evaluationFailedEmail({ ...args, workspaceId: args.workspaceId, workspaceName, runUrl });
    await sendWithAudit({
      workspaceId: args.workspaceId,
      eventType: "EVALUATION_FAILED",
      eventId: args.runId,
      recipients: resolved,
      template,
      channel: "email",
    });
  });
}

export async function notifyRegressionFailed(args: {
  workspaceId: string;
  scheduleName: string;
  promptName: string | null;
  reason: string;
  runId: string | null;
  // Rich context
  previousScore?: number | null;
  currentScore?: number | null;
  failedCases?: number;
  datasetName?: string | null;
  promptVersion?: string | null;
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
    const [workspaceName, resolved] = await Promise.all([
      getWorkspaceName(args.workspaceId),
      resolveEmailRecipients({
        workspaceId: args.workspaceId,
        event: { category: "regressions", severity: "critical", promptName: args.promptName },
      }),
    ]);
    const template = regressionFailedEmail({ ...args, workspaceId: args.workspaceId, workspaceName, runUrl });
    await sendWithAudit({
      workspaceId: args.workspaceId,
      eventType: "REGRESSION_FAILED",
      eventId: args.runId,
      recipients: resolved,
      template,
      channel: "email",
    });
  });
}

export async function notifyAlertTriggered(args: {
  workspaceId: string;
  ruleName: string;
  metricType: string;
  metricValue: number;
  threshold: number;
  comparison: string;
  // Rich context
  alertEventId?: string | null;
  promptName?: string | null;
  environment?: string | null;
  provider?: string | null;
  model?: string | null;
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
    const [workspaceName, resolved] = await Promise.all([
      getWorkspaceName(args.workspaceId),
      resolveEmailRecipients({
        workspaceId: args.workspaceId,
        event: { category: "alerts", severity, promptName: args.promptName, environment: args.environment },
      }),
    ]);
    const template = alertTriggeredEmail({ ...args, workspaceId: args.workspaceId, workspaceName, alertsUrl });
    await sendWithAudit({
      workspaceId: args.workspaceId,
      eventType: "ALERT_TRIGGERED",
      eventId: args.alertEventId,
      recipients: resolved,
      template,
      channel: "email",
    });
  });
}

export async function notifyRolloutBlocked(args: {
  workspaceId: string;
  promptName: string;
  promptId: string;
  versionTag: string;
  reasons: string[];
  // Rich context
  rolloutCheckId?: string | null;
  requestedBy?: string | null;
  targetEnvironment?: string | null;
  rolloutPercentage?: number | null;
  gateResults?: Array<{ gate: string; status: "passed" | "failed" | "missing" | "not_required" }>;
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
    const [workspaceName, resolved] = await Promise.all([
      getWorkspaceName(args.workspaceId),
      resolveEmailRecipients({
        workspaceId: args.workspaceId,
        event: { category: "rollout", severity: "critical", promptName: args.promptName },
      }),
    ]);
    const template = rolloutBlockedEmail({ ...args, workspaceId: args.workspaceId, workspaceName, promptUrl });
    await sendWithAudit({
      workspaceId: args.workspaceId,
      eventType: "ROLLOUT_BLOCKED",
      eventId: args.rolloutCheckId,
      recipients: resolved,
      template,
      channel: "email",
    });
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
    const [workspaceName, resolved] = await Promise.all([
      getWorkspaceName(args.workspaceId),
      resolveEmailRecipients({
        workspaceId: args.workspaceId,
        event: { category: "rollout", severity: "info", promptName: args.promptName },
      }),
    ]);
    const template = promptPromotedEmail({ ...args, workspaceId: args.workspaceId, workspaceName, promptUrl });
    await sendWithAudit({
      workspaceId: args.workspaceId,
      eventType: "ROLLOUT_APPROVED",
      recipients: resolved,
      template,
      channel: "email",
    });
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
    const [workspaceName, resolved] = await Promise.all([
      getWorkspaceName(args.workspaceId),
      resolveEmailRecipients({
        workspaceId: args.workspaceId,
        event: { category: "quota", severity: pct >= 100 ? "critical" : "warning" },
      }),
    ]);
    const template = quotaWarningEmail({ ...args, workspaceId: args.workspaceId, workspaceName, billingUrl });
    await sendWithAudit({
      workspaceId: args.workspaceId,
      eventType: pct >= 100 ? "QUOTA_EXCEEDED" : "QUOTA_NEARING",
      recipients: resolved,
      template,
      channel: "email",
    });
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
