import "server-only";

const APP_URL = () => process.env.APP_URL ?? "https://app.vectorbea.app";
const PREF_URL = (workspaceId: string) =>
  `${APP_URL()}/settings?tab=notifications${workspaceId ? `&org=${encodeURIComponent(workspaceId)}` : ""}`;

type StatusTone = "success" | "warning" | "failure" | "info" | "neutral";

const TOKENS = {
  page: "#F8F5EF",
  card: "#FFFFFF",
  border: "#E5E0D8",
  borderStrong: "#DED8CE",
  textPrimary: "#111827",
  textBody: "#1F2937",
  textMuted: "#4B5563",
  accent: "#2563EB",
  successText: "#047857",
  successBg: "#ECFDF5",
  successBorder: "#A7F3D0",
  warningText: "#D97706",
  warningBg: "#FFFBEB",
  warningBorder: "#FDE68A",
  failureText: "#DC2626",
  failureBg: "#FEF2F2",
  failureBorder: "#FECACA",
  infoText: "#1D4ED8",
  infoBg: "#EFF6FF",
  infoBorder: "#BFDBFE",
  neutralBg: "#FAF7F0",
} as const;

function calloutStyle(tone: StatusTone): { text: string; bg: string; border: string } {
  if (tone === "success") return { text: TOKENS.successText, bg: TOKENS.successBg, border: TOKENS.successBorder };
  if (tone === "warning") return { text: TOKENS.warningText, bg: TOKENS.warningBg, border: TOKENS.warningBorder };
  if (tone === "failure") return { text: TOKENS.failureText, bg: TOKENS.failureBg, border: TOKENS.failureBorder };
  if (tone === "info") return { text: TOKENS.infoText, bg: TOKENS.infoBg, border: TOKENS.infoBorder };
  return { text: TOKENS.textBody, bg: TOKENS.neutralBg, border: TOKENS.border };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function statusBadge(label: string, tone: StatusTone): string {
  const s = calloutStyle(tone);
  return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${s.bg};border:1px solid ${s.border};color:${s.text};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(label)}</span>`;
}

function keyValueTable(rows: Array<{ key: string; value: string }>): string {
  const body = rows
    .map(
      (row) => `<tr>
  <td style="padding:10px 14px;border-bottom:1px solid ${TOKENS.border};width:38%;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${TOKENS.textMuted};">${escapeHtml(row.key)}</td>
  <td style="padding:10px 14px;border-bottom:1px solid ${TOKENS.border};font-size:13px;font-weight:600;color:${TOKENS.textPrimary};">${escapeHtml(row.value)}</td>
</tr>`,
    )
    .join("");

  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${TOKENS.border};border-radius:12px;overflow:hidden;background:${TOKENS.card};margin:0 0 20px;">${body}</table>`;
}

function actionButton(label: string, href: string): string {
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">
  <tr>
    <td style="background:${TOKENS.accent};border-radius:10px;">
      <a href="${href}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;
}

function sectionHeading(text: string): string {
  return `<p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${TOKENS.textMuted};">${escapeHtml(text)}</p>`;
}

function hint(text: string): string {
  return `<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:${TOKENS.textMuted};">${escapeHtml(text)}</p>`;
}

function recommendation(text: string): string {
  return `<div style="margin:0 0 20px;padding:12px 14px;border-radius:10px;background:${TOKENS.neutralBg};border:1px solid ${TOKENS.border};">
  <p style="margin:0;font-size:13px;line-height:1.6;color:${TOKENS.textBody};">${escapeHtml(text)}</p>
</div>`;
}

function layout(args: {
  workspaceId?: string;
  workspaceName?: string;
  preheader?: string;
  body: string;
  reason?: string;
}) {
  const preheader = args.preheader ?? "";
  const workspaceName = args.workspaceName ? escapeHtml(args.workspaceName) : "VectorBea";
  const prefsLink = PREF_URL(args.workspaceId ?? "");
  const reason = args.reason ?? "You received this because notifications are enabled for this workspace";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>VectorBea notification</title>
</head>
<body style="margin:0;padding:0;background:${TOKENS.page};font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>` : ""}
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${TOKENS.page};padding:24px 12px;">
  <tr>
    <td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:${TOKENS.card};border:1px solid ${TOKENS.border};border-radius:18px;overflow:hidden;">
        <tr>
          <td style="padding:20px 24px;border-bottom:1px solid ${TOKENS.border};background:${TOKENS.neutralBg};">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="left" style="font-size:20px;font-weight:800;color:${TOKENS.textPrimary};">VectorBea</td>
                <td align="right" style="font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${TOKENS.textMuted};">${workspaceName}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:26px 24px 20px;">${args.body}</td>
        </tr>
        <tr>
          <td style="padding:16px 24px 22px;border-top:1px solid ${TOKENS.borderStrong};background:${TOKENS.neutralBg};">
            <p style="margin:0 0 8px;font-size:12px;color:${TOKENS.textMuted};">${escapeHtml(reason)}</p>
            <p style="margin:0 0 8px;font-size:12px;color:${TOKENS.textMuted};">
              Manage notification preferences
              <a href="${prefsLink}" style="color:${TOKENS.accent};text-decoration:none;font-weight:600;"> in VectorBea</a>
            </p>
            <p style="margin:0;font-size:11px;color:${TOKENS.textMuted};">${workspaceName}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function formatMetricType(raw: string): string {
  const map: Record<string, string> = {
    latency_p95: "P95 latency",
    error_rate: "Error rate",
    eval_score_avg: "Evaluation score",
    cache_hit_rate: "Cache hit rate",
  };
  return map[raw] ?? raw.replaceAll("_", " ");
}

function formatComparison(op: string): string {
  const map: Record<string, string> = { gt: ">", lt: "<", gte: ">=", lte: "<=" };
  return map[op] ?? op;
}

function formatMetricValue(metricType: string, value: number): string {
  if (metricType === "latency_p95") return `${Math.round(value)} ms`;
  if (metricType === "error_rate" || metricType === "cache_hit_rate") return `${(Math.round(value * 10) / 10).toFixed(1)}%`;
  if (metricType === "eval_score_avg") return `${(Math.round(value * 100) / 100).toFixed(2)}`;
  return String(value);
}

export function teamInvitationEmail(args: {
  inviterName: string;
  workspaceName: string;
  role: string;
  acceptUrl: string;
  expiresAt: string;
}) {
  const subject = `${args.inviterName} invited you to ${args.workspaceName} in VectorBea`;
  const expiryDate = new Date(args.expiresAt).toLocaleDateString("en-US", { dateStyle: "long" });
  const body = `
${statusBadge("Workspace invite", "info")}
<h1 style="margin:14px 0 8px;font-size:24px;line-height:1.2;color:${TOKENS.textPrimary};">You are invited to join ${escapeHtml(args.workspaceName)}</h1>
${hint(`${args.inviterName} invited you with role ${args.role}`)}
${keyValueTable([
  { key: "Workspace", value: args.workspaceName },
  { key: "Role", value: args.role },
  { key: "Expires", value: expiryDate },
])}
${actionButton("Accept invitation", args.acceptUrl)}
${recommendation("Use this invitation from a secure trusted session")}
`;

  return {
    subject,
    html: layout({
      workspaceName: args.workspaceName,
      preheader: `Invitation to ${args.workspaceName}`,
      body,
      reason: "You received this because a workspace admin invited your email address",
    }),
    text: `Invitation to ${args.workspaceName}\nInvited by ${args.inviterName}\nRole ${args.role}\nExpires ${expiryDate}\nAccept ${args.acceptUrl}`,
  };
}

export function evaluationCompletedEmail(args: {
  workspaceName: string;
  workspaceId?: string;
  promptName: string;
  versionTag: string;
  recommendation: string;
  score: number | null;
  runUrl: string;
}) {
  const verdict = args.recommendation.replaceAll("_", " ");
  const tone: StatusTone = verdict.includes("fail") ? "failure" : verdict.includes("review") ? "warning" : "success";
  const subject = `Evaluation completed for ${args.promptName}`;
  const scoreText = args.score == null ? "Unavailable" : `${Math.round(args.score * 100)}%`;
  const body = `
${statusBadge(verdict, tone)}
<h1 style="margin:14px 0 8px;font-size:24px;line-height:1.2;color:${TOKENS.textPrimary};">Evaluation completed</h1>
${hint(`Candidate version ${args.versionTag} for ${args.promptName} has finished`)}
${keyValueTable([
  { key: "Prompt", value: args.promptName },
  { key: "Candidate version", value: args.versionTag },
  { key: "Verdict", value: verdict },
  { key: "Score", value: scoreText },
])}
${actionButton("Open evaluation run", args.runUrl)}
${recommendation(
  tone === "success"
    ? "Review score breakdown then continue rollout when ready"
    : "Review failed checks and evidence before promoting this candidate",
)}
`;

  return {
    subject,
    html: layout({
      workspaceName: args.workspaceName,
      workspaceId: args.workspaceId,
      preheader: `${args.promptName} ${args.versionTag} ${verdict}`,
      body,
      reason: "You received this because evaluation notifications are enabled for this workspace",
    }),
    text: `Evaluation completed\nPrompt ${args.promptName}\nVersion ${args.versionTag}\nVerdict ${verdict}\nScore ${scoreText}\nOpen ${args.runUrl}`,
  };
}

export function evaluationFailedEmail(args: {
  workspaceName: string;
  workspaceId?: string;
  promptName: string;
  versionTag: string;
  reason: string;
  runUrl: string;
}) {
  const subject = `Evaluation failed for ${args.promptName}`;
  const body = `
${statusBadge("Evaluation failed", "failure")}
<h1 style="margin:14px 0 8px;font-size:24px;line-height:1.2;color:${TOKENS.textPrimary};">Evaluation failed</h1>
${hint(`Run for ${args.promptName} ${args.versionTag} failed and needs investigation`)}
${keyValueTable([
  { key: "Prompt", value: args.promptName },
  { key: "Version", value: args.versionTag },
  { key: "Failure reason", value: args.reason },
])}
${actionButton("Open evaluation details", args.runUrl)}
${recommendation("Inspect provider execution logs and failed checks then rerun evaluation")}
`;
  return {
    subject,
    html: layout({
      workspaceName: args.workspaceName,
      workspaceId: args.workspaceId,
      preheader: `Evaluation failed for ${args.promptName}`,
      body,
      reason: "You received this because evaluation failure notifications are enabled for this workspace",
    }),
    text: `Evaluation failed\nPrompt ${args.promptName}\nVersion ${args.versionTag}\nReason ${args.reason}\nOpen ${args.runUrl}`,
  };
}

export function regressionFailedEmail(args: {
  workspaceName: string;
  workspaceId?: string;
  scheduleName: string;
  promptName: string | null;
  reason: string;
  runUrl: string | null;
}) {
  const subject = `Regression failed for schedule ${args.scheduleName}`;
  const rows = [
    { key: "Schedule", value: args.scheduleName },
    ...(args.promptName ? [{ key: "Prompt", value: args.promptName }] : []),
    { key: "Result", value: "Failed" },
    { key: "Reason", value: args.reason },
  ];
  const body = `
${statusBadge("Regression failed", "failure")}
<h1 style="margin:14px 0 8px;font-size:24px;line-height:1.2;color:${TOKENS.textPrimary};">Regression check failed</h1>
${hint("Scheduled quality checks detected an issue that needs review")}
${keyValueTable(rows)}
${args.runUrl ? actionButton("Open regression run", args.runUrl) : ""}
${recommendation("Compare failed cases and inspect recent prompt or provider changes")}
`;
  return {
    subject,
    html: layout({
      workspaceName: args.workspaceName,
      workspaceId: args.workspaceId,
      preheader: `Regression failed ${args.scheduleName}`,
      body,
      reason: "You received this because regression notifications are enabled for this workspace",
    }),
    text: `Regression failed\nSchedule ${args.scheduleName}\nReason ${args.reason}${args.runUrl ? `\nOpen ${args.runUrl}` : ""}`,
  };
}

export function alertTriggeredEmail(args: {
  workspaceName: string;
  workspaceId?: string;
  ruleName: string;
  metricType: string;
  metricValue: number;
  threshold: number;
  comparison: string;
  alertsUrl: string;
}) {
  const metricLabel = formatMetricType(args.metricType);
  const metricValue = formatMetricValue(args.metricType, args.metricValue);
  const thresholdValue = formatMetricValue(args.metricType, args.threshold);
  const comparison = formatComparison(args.comparison);
  const subject = `Alert triggered ${args.ruleName}`;
  const body = `
${statusBadge("Alert triggered", "warning")}
<h1 style="margin:14px 0 8px;font-size:24px;line-height:1.2;color:${TOKENS.textPrimary};">Production alert triggered</h1>
${hint(`${metricLabel} crossed the configured threshold for this workspace`)}
${keyValueTable([
  { key: "Alert rule", value: args.ruleName },
  { key: "Metric", value: metricLabel },
  { key: "Current value", value: metricValue },
  { key: "Threshold", value: `${comparison} ${thresholdValue}` },
])}
${actionButton("View alert", args.alertsUrl)}
${recommendation("Review recent traces then compare against previous stable behavior")}
`;
  return {
    subject,
    html: layout({
      workspaceName: args.workspaceName,
      workspaceId: args.workspaceId,
      preheader: `${args.ruleName} ${metricValue}`,
      body,
      reason: "You received this because alert notifications are enabled for this workspace",
    }),
    text: `Alert triggered\nRule ${args.ruleName}\nMetric ${metricLabel}\nCurrent ${metricValue}\nThreshold ${comparison} ${thresholdValue}\nOpen ${args.alertsUrl}`,
  };
}

export function rolloutBlockedEmail(args: {
  workspaceName: string;
  workspaceId?: string;
  promptName: string;
  versionTag: string;
  reasons: string[];
  promptUrl: string;
}) {
  const subject = `Rollout blocked for ${args.promptName} ${args.versionTag}`;
  const reasonsList = args.reasons.map((r) => `<li style="margin:0 0 6px;color:${TOKENS.textBody};font-size:13px;line-height:1.5;">${escapeHtml(r)}</li>`).join("");
  const body = `
${statusBadge("Rollout blocked", "failure")}
<h1 style="margin:14px 0 8px;font-size:24px;line-height:1.2;color:${TOKENS.textPrimary};">Rollout blocked by safety gate</h1>
${hint(`Candidate version ${args.versionTag} for ${args.promptName} did not meet release criteria`)}
${keyValueTable([
  { key: "Prompt", value: args.promptName },
  { key: "Candidate version", value: args.versionTag },
  { key: "Status", value: "Blocked" },
])}
${sectionHeading("Blocking reasons")}
<ul style="margin:0 0 18px;padding:0 0 0 16px;">${reasonsList}</ul>
${actionButton("Review rollout block", args.promptUrl)}
${recommendation("Fix failed checks then rerun evaluation and regression before retrying rollout")}
`;
  return {
    subject,
    html: layout({
      workspaceName: args.workspaceName,
      workspaceId: args.workspaceId,
      preheader: `Rollout blocked ${args.promptName} ${args.versionTag}`,
      body,
      reason: "You received this because rollout notifications are enabled for this workspace",
    }),
    text: `Rollout blocked\nPrompt ${args.promptName}\nVersion ${args.versionTag}\nReasons ${args.reasons.join("; ")}\nOpen ${args.promptUrl}`,
  };
}

export function quotaWarningEmail(args: {
  workspaceName: string;
  workspaceId?: string;
  usageType: string;
  used: number;
  limit: number;
  billingUrl: string;
}) {
  const pct = Math.round((args.used / args.limit) * 100);
  const isExceeded = pct >= 100;
  const label = args.usageType.replaceAll("_", " ");
  const tone: StatusTone = isExceeded ? "failure" : "warning";
  const subject = isExceeded
    ? `Quota exceeded for ${args.workspaceName}`
    : `Quota nearing for ${args.workspaceName}`;
  const body = `
${statusBadge(isExceeded ? "Quota exceeded" : "Quota nearing", tone)}
<h1 style="margin:14px 0 8px;font-size:24px;line-height:1.2;color:${TOKENS.textPrimary};">${isExceeded ? "Workspace usage exceeded limit" : "Workspace usage nearing limit"}</h1>
${hint(`${label} usage is now ${pct}% of plan limit`)}
${keyValueTable([
  { key: "Usage type", value: label },
  { key: "Current usage", value: `${args.used.toLocaleString()}` },
  { key: "Limit", value: `${args.limit.toLocaleString()}` },
  { key: "Percent used", value: `${pct}%` },
])}
${actionButton("Manage usage", args.billingUrl)}
${recommendation("Review usage patterns and adjust plan or retention settings if needed")}
`;
  return {
    subject,
    html: layout({
      workspaceName: args.workspaceName,
      workspaceId: args.workspaceId,
      preheader: `${label} ${pct}%`,
      body,
      reason: "You received this because quota notifications are enabled and you are an admin or owner",
    }),
    text: `Usage notification\nWorkspace ${args.workspaceName}\nUsage type ${label}\nCurrent ${args.used}\nLimit ${args.limit}\nPercent ${pct}%\nManage ${args.billingUrl}`,
  };
}

export function promptPromotedEmail(args: {
  workspaceName: string;
  workspaceId?: string;
  promptName: string;
  versionTag: string;
  promotedBy: string;
  promptUrl: string;
}) {
  const subject = `Rollout approved for ${args.promptName} ${args.versionTag}`;
  const body = `
${statusBadge("Rollout approved", "success")}
<h1 style="margin:14px 0 8px;font-size:24px;line-height:1.2;color:${TOKENS.textPrimary};">Prompt version is now active</h1>
${hint(`Version ${args.versionTag} for ${args.promptName} has been approved for rollout`)}
${keyValueTable([
  { key: "Prompt", value: args.promptName },
  { key: "Version", value: args.versionTag },
  { key: "Approved by", value: args.promotedBy },
  { key: "Status", value: "Active" },
])}
${actionButton("View active version", args.promptUrl)}
${recommendation("Continue monitoring metrics alerts and regressions as traffic increases")}
`;
  return {
    subject,
    html: layout({
      workspaceName: args.workspaceName,
      workspaceId: args.workspaceId,
      preheader: `Rollout approved ${args.promptName} ${args.versionTag}`,
      body,
      reason: "You received this because rollout notifications are enabled for this workspace",
    }),
    text: `Rollout approved\nPrompt ${args.promptName}\nVersion ${args.versionTag}\nApproved by ${args.promotedBy}\nOpen ${args.promptUrl}`,
  };
}
