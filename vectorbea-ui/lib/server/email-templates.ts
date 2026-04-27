import "server-only";

const APP_URL = () => process.env.APP_URL ?? "https://app.vectorbea.app";

// ─── Shared layout wrapper (table-based, email-client safe) ──────────────────

function layout({
  preheader = "",
  headerAccent = "linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%)",
  body,
}: {
  preheader?: string;
  headerAccent?: string;
  body: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="X-UA-Compatible" content="IE=edge"/>
<title>VectorBea</title>
</head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>` : ""}
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#09090b;min-height:100vh;">
<tr><td align="center" style="padding:40px 16px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#0f0f14;border:1px solid #1e1e2e;border-radius:16px;overflow:hidden;">

  <!-- Header -->
  <tr>
    <td style="background:${headerAccent};padding:24px 32px;">
      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          <!-- Bee logo icon -->
          <td style="padding-right:14px;vertical-align:middle;">
            <div style="width:44px;height:44px;background:rgba(255,255,255,0.15);border-radius:12px;display:flex;align-items:center;justify-content:center;padding:6px;box-sizing:border-box;">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g stroke="#F8D36A" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <ellipse cx="7.5" cy="8" rx="3.2" ry="2.2" opacity="0.8" fill="#F8D36A" fill-opacity="0.3"/>
                  <ellipse cx="16.5" cy="8" rx="3.2" ry="2.2" opacity="0.8" fill="#F8D36A" fill-opacity="0.3"/>
                  <ellipse cx="12" cy="14" rx="4.2" ry="5.2" fill="#F5B942" fill-opacity="0.25"/>
                  <path d="M8.4 12.6h7.2"/>
                  <path d="M8.1 15.2h7.8"/>
                  <path d="M8.6 17.8h6.8"/>
                  <path d="M10.4 9.2 L9.2 6.4"/>
                  <path d="M13.6 9.2 L14.8 6.4"/>
                  <circle cx="9.2" cy="6.2" r="0.6" fill="#F8D36A"/>
                  <circle cx="14.8" cy="6.2" r="0.6" fill="#F8D36A"/>
                </g>
              </svg>
            </div>
          </td>
          <!-- Brand text -->
          <td style="vertical-align:middle;">
            <p style="margin:0;font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">VectorBea</p>
            <p style="margin:3px 0 0;font-size:10px;font-weight:500;color:rgba(255,255,255,0.55);text-transform:uppercase;letter-spacing:0.15em;">AI Release Control</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Body -->
  <tr><td style="padding:36px 36px 28px;">${body}</td></tr>

  <!-- Footer -->
  <tr>
    <td style="background:#09090b;border-top:1px solid #1e1e2e;padding:18px 36px;">
      <p style="margin:0;font-size:11px;color:#3f3f46;text-align:center;">
        VectorBea — AI Release Control &nbsp;·&nbsp;
        <a href="${APP_URL()}" style="color:#4f46e5;text-decoration:none;">${APP_URL()}</a>
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body></html>`;
}

/** Render a key-value info card */
function infoCard(rows: { label: string; value: string; highlight?: boolean }[]): string {
  const rowsHtml = rows.map(({ label, value, highlight }) => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #1e1e2e;width:40%;">
        <p style="margin:0;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:#71717a;">${label}</p>
      </td>
      <td style="padding:10px 16px;border-bottom:1px solid #1e1e2e;">
        <p style="margin:0;font-size:13px;font-weight:600;color:${highlight ? "#a78bfa" : "#f4f4f5"};">${value}</p>
      </td>
    </tr>`).join("");
  return `
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0a0f;border:1px solid #1e1e2e;border-radius:10px;overflow:hidden;margin-bottom:24px;">
    ${rowsHtml}
  </table>`;
}

/** Render a CTA button */
function ctaButton(label: string, url: string, color = "linear-gradient(135deg,#4f46e5,#7c3aed)"): string {
  return `
  <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
    <tr>
      <td style="background:${color};border-radius:10px;">
        <a href="${url}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:-0.1px;">${label}</a>
      </td>
    </tr>
  </table>`;
}

/** Render a status badge pill */
function badge(text: string, color: string, bg: string): string {
  return `<span style="display:inline-block;padding:3px 10px;background:${bg};border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.08em;color:${color};text-transform:uppercase;">${text}</span>`;
}

/** Format metric type for display */
function formatMetricType(raw: string): string {
  const map: Record<string, string> = {
    latency_p95: "P95 Latency",
    error_rate: "Error Rate",
    eval_score_avg: "Avg Eval Score",
    cache_hit_rate: "Cache Hit Rate",
  };
  return map[raw] ?? raw.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Format comparison operator */
function formatComparison(op: string): string {
  const map: Record<string, string> = { gt: ">", lt: "<", gte: "≥", lte: "≤" };
  return map[op] ?? op;
}

/** Format metric value with unit */
function formatMetricValue(metricType: string, value: number): string {
  if (metricType === "latency_p95") return `${Math.round(value)} ms`;
  if (metricType === "error_rate" || metricType === "cache_hit_rate") return `${(Math.round(value * 10) / 10).toFixed(1)}%`;
  if (metricType === "eval_score_avg") return `${(Math.round(value * 100) / 100).toFixed(2)}`;
  return String(value);
}

// ─── Team invitation ──────────────────────────────────────────────────────────

export function teamInvitationEmail(args: {
  inviterName: string;
  workspaceName: string;
  role: string;
  acceptUrl: string;
  expiresAt: string;
}) {
  const subject = `You've been invited to join ${args.workspaceName} on VectorBea`;
  const expiryDate = new Date(args.expiresAt).toLocaleDateString("en-US", { dateStyle: "long" });
  const roleCapitalized = args.role.charAt(0).toUpperCase() + args.role.slice(1);

  const body = `
    <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f4f4f5;letter-spacing:-0.3px;">You're invited!</p>
    <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#a1a1aa;">
      <strong style="color:#e4e4e7;">${args.inviterName}</strong> has invited you to join the
      <strong style="color:#e4e4e7;">${args.workspaceName}</strong> workspace.
    </p>
    ${infoCard([
      { label: "Workspace", value: args.workspaceName },
      { label: "Your role", value: roleCapitalized, highlight: true },
      { label: "Expires", value: expiryDate },
    ])}
    ${ctaButton("Accept invitation →", args.acceptUrl)}
    <p style="margin:0 0 6px;font-size:12px;color:#71717a;">If the button doesn't work, copy this link:</p>
    <p style="margin:0 0 24px;font-size:11px;font-family:'Courier New',monospace;color:#6366f1;word-break:break-all;">${args.acceptUrl}</p>
    <hr style="border:none;border-top:1px solid #1e1e2e;margin:0 0 20px;"/>
    <p style="margin:0;font-size:12px;color:#52525b;">🔒 If you didn't expect this invite, you can safely ignore this email.</p>
  `;

  const html = layout({ preheader: `${args.inviterName} invited you to ${args.workspaceName} — accept before ${expiryDate}`, body });
  const text = `You've been invited to join ${args.workspaceName} on VectorBea\n\n${args.inviterName} invited you as ${args.role}.\n\nAccept: ${args.acceptUrl}\n\nExpires: ${expiryDate}`;
  return { subject, html, text };
}

// ─── Evaluation completed ─────────────────────────────────────────────────────

export function evaluationCompletedEmail(args: {
  workspaceName: string;
  promptName: string;
  versionTag: string;
  recommendation: string;
  score: number | null;
  runUrl: string;
}) {
  const label = args.recommendation.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const isPass = args.recommendation.toLowerCase().includes("pass") || args.recommendation.toLowerCase().includes("promote");
  const subject = `Evaluation complete: ${args.promptName}@${args.versionTag} — ${label}`;

  const scoreRow = args.score != null
    ? [{ label: "Score", value: `${Math.round(args.score * 100)}%`, highlight: true }]
    : [];

  const body = `
    <p style="margin:0 0 6px;font-size:22px;font-weight:700;color:#f4f4f5;letter-spacing:-0.3px;">Evaluation Complete</p>
    <p style="margin:0 0 20px;">${badge(label, isPass ? "#4ade80" : "#f87171", isPass ? "rgba(74,222,128,0.12)" : "rgba(248,113,113,0.12)")}</p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#a1a1aa;">
      The evaluation run for <strong style="color:#e4e4e7;">${args.promptName}</strong>
      <code style="background:#1e1e2e;padding:2px 6px;border-radius:4px;font-size:12px;color:#a78bfa;">${args.versionTag}</code> has completed.
    </p>
    ${infoCard([
      { label: "Workspace", value: args.workspaceName },
      { label: "Prompt", value: args.promptName },
      { label: "Version", value: args.versionTag, highlight: true },
      { label: "Verdict", value: label, highlight: true },
      ...scoreRow,
    ])}
    ${ctaButton("View evaluation report →", args.runUrl)}
  `;

  const html = layout({ preheader: `${label}: ${args.promptName}@${args.versionTag}`, body });
  const text = `Evaluation complete: ${args.promptName}@${args.versionTag}\nVerdict: ${label}${args.score != null ? `\nScore: ${Math.round(args.score * 100)}%` : ""}\n\nView: ${args.runUrl}`;
  return { subject, html, text };
}

// ─── Evaluation failed ────────────────────────────────────────────────────────

export function evaluationFailedEmail(args: {
  workspaceName: string;
  promptName: string;
  versionTag: string;
  reason: string;
  runUrl: string;
}) {
  const subject = `Evaluation failed: ${args.promptName}@${args.versionTag}`;

  const body = `
    <p style="margin:0 0 6px;font-size:22px;font-weight:700;color:#f4f4f5;letter-spacing:-0.3px;">Evaluation Failed</p>
    <p style="margin:0 0 20px;">${badge("Failed", "#f87171", "rgba(248,113,113,0.12)")}</p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#a1a1aa;">
      The evaluation run for <strong style="color:#e4e4e7;">${args.promptName}</strong>
      <code style="background:#1e1e2e;padding:2px 6px;border-radius:4px;font-size:12px;color:#a78bfa;">${args.versionTag}</code> encountered an error.
    </p>
    ${infoCard([
      { label: "Workspace", value: args.workspaceName },
      { label: "Prompt", value: args.promptName },
      { label: "Version", value: args.versionTag, highlight: true },
      { label: "Reason", value: args.reason },
    ])}
    ${ctaButton("View details →", args.runUrl)}
  `;

  const html = layout({
    preheader: `Evaluation failed for ${args.promptName}@${args.versionTag}`,
    headerAccent: "linear-gradient(135deg,#dc2626 0%,#991b1b 100%)",
    body,
  });
  const text = `Evaluation failed: ${args.promptName}@${args.versionTag}\nReason: ${args.reason}\n\nView: ${args.runUrl}`;
  return { subject, html, text };
}

// ─── Regression failed ───────────────────────────────────────────────────────

export function regressionFailedEmail(args: {
  workspaceName: string;
  scheduleName: string;
  promptName: string | null;
  reason: string;
  runUrl: string | null;
}) {
  const subject = `Regression schedule failed: ${args.scheduleName}`;
  const promptRow = args.promptName ? [{ label: "Prompt", value: args.promptName }] : [];

  const body = `
    <p style="margin:0 0 6px;font-size:22px;font-weight:700;color:#f4f4f5;letter-spacing:-0.3px;">Regression Failed</p>
    <p style="margin:0 0 20px;">${badge("Schedule Error", "#f87171", "rgba(248,113,113,0.12)")}</p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#a1a1aa;">
      A scheduled regression run has failed for schedule <strong style="color:#e4e4e7;">${args.scheduleName}</strong>.
    </p>
    ${infoCard([
      { label: "Workspace", value: args.workspaceName },
      { label: "Schedule", value: args.scheduleName, highlight: true },
      ...promptRow,
      { label: "Reason", value: args.reason },
    ])}
    ${args.runUrl ? ctaButton("View evaluation run →", args.runUrl) : ""}
  `;

  const html = layout({
    preheader: `Regression failed: ${args.scheduleName}`,
    headerAccent: "linear-gradient(135deg,#dc2626 0%,#991b1b 100%)",
    body,
  });
  const text = `Regression failed: ${args.scheduleName}\nReason: ${args.reason}${args.runUrl ? `\n\nView: ${args.runUrl}` : ""}`;
  return { subject, html, text };
}

// ─── Alert triggered ─────────────────────────────────────────────────────────

export function alertTriggeredEmail(args: {
  workspaceName: string;
  ruleName: string;
  metricType: string;
  metricValue: number;
  threshold: number;
  comparison: string;
  alertsUrl: string;
}) {
  const metricLabel = formatMetricType(args.metricType);
  const metricDisplay = formatMetricValue(args.metricType, args.metricValue);
  const thresholdDisplay = formatMetricValue(args.metricType, args.threshold);
  const comparisonLabel = formatComparison(args.comparison);
  const subject = `🚨 Alert triggered: ${args.ruleName} — ${metricLabel} is ${metricDisplay}`;

  const body = `
    <p style="margin:0 0 6px;font-size:22px;font-weight:700;color:#f4f4f5;letter-spacing:-0.3px;">Alert Triggered</p>
    <p style="margin:0 0 20px;">${badge("Threshold Breached", "#fbbf24", "rgba(251,191,36,0.12)")}</p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#a1a1aa;">
      An alert rule has been triggered in workspace <strong style="color:#e4e4e7;">${args.workspaceName}</strong>.
      The metric <strong style="color:#e4e4e7;">${metricLabel}</strong> has breached its configured threshold.
    </p>

    <!-- Metric highlight card -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(135deg,rgba(220,38,38,0.12),rgba(153,27,27,0.08));border:1px solid rgba(220,38,38,0.3);border-radius:12px;overflow:hidden;margin-bottom:24px;">
      <tr>
        <td style="padding:20px 24px;" align="center">
          <p style="margin:0 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.14em;color:#f87171;">${metricLabel}</p>
          <p style="margin:0;font-size:36px;font-weight:800;color:#fca5a5;letter-spacing:-1px;">${metricDisplay}</p>
          <p style="margin:4px 0 0;font-size:12px;color:#ef4444;">Threshold: ${comparisonLabel} ${thresholdDisplay}</p>
        </td>
      </tr>
    </table>

    ${infoCard([
      { label: "Workspace", value: args.workspaceName },
      { label: "Rule", value: args.ruleName, highlight: true },
      { label: "Metric", value: metricLabel },
      { label: "Current value", value: metricDisplay, highlight: true },
      { label: "Threshold", value: `${comparisonLabel} ${thresholdDisplay}` },
    ])}
    ${ctaButton("View alerts →", args.alertsUrl, "linear-gradient(135deg,#dc2626,#b91c1c)")}
    <p style="margin:0;font-size:12px;color:#52525b;">You received this because alert notifications are enabled for your workspace.</p>
  `;

  const html = layout({
    preheader: `Alert: ${args.ruleName} — ${metricLabel} is ${metricDisplay} (threshold: ${comparisonLabel} ${thresholdDisplay})`,
    headerAccent: "linear-gradient(135deg,#dc2626 0%,#7f1d1d 100%)",
    body,
  });
  const text = `Alert triggered: ${args.ruleName}\nMetric: ${metricLabel} = ${metricDisplay}\nThreshold: ${comparisonLabel} ${thresholdDisplay}\n\nView alerts: ${args.alertsUrl}`;
  return { subject, html, text };
}

// ─── Rollout blocked ─────────────────────────────────────────────────────────

export function rolloutBlockedEmail(args: {
  workspaceName: string;
  promptName: string;
  versionTag: string;
  reasons: string[];
  promptUrl: string;
}) {
  const subject = `Rollout blocked: ${args.promptName}@${args.versionTag}`;
  const reasonsList = args.reasons.map((r) =>
    `<tr><td style="padding:6px 16px;border-bottom:1px solid #1e1e2e;"><p style="margin:0;font-size:13px;color:#fca5a5;">⚠ ${r}</p></td></tr>`
  ).join("");

  const body = `
    <p style="margin:0 0 6px;font-size:22px;font-weight:700;color:#f4f4f5;letter-spacing:-0.3px;">Rollout Blocked</p>
    <p style="margin:0 0 20px;">${badge("Promotion Blocked", "#fbbf24", "rgba(251,191,36,0.12)")}</p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#a1a1aa;">
      The rollout of <strong style="color:#e4e4e7;">${args.promptName}</strong>
      <code style="background:#1e1e2e;padding:2px 6px;border-radius:4px;font-size:12px;color:#a78bfa;">${args.versionTag}</code>
      was blocked in workspace <strong style="color:#e4e4e7;">${args.workspaceName}</strong>.
    </p>
    ${infoCard([
      { label: "Workspace", value: args.workspaceName },
      { label: "Prompt", value: args.promptName },
      { label: "Version", value: args.versionTag, highlight: true },
    ])}
    <p style="margin:0 0 10px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#71717a;">Blocking reasons</p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0a0f;border:1px solid rgba(220,38,38,0.3);border-radius:10px;overflow:hidden;margin-bottom:24px;">
      ${reasonsList}
    </table>
    ${ctaButton("View prompt →", args.promptUrl)}
  `;

  const html = layout({
    preheader: `Rollout blocked: ${args.promptName}@${args.versionTag}`,
    headerAccent: "linear-gradient(135deg,#d97706 0%,#92400e 100%)",
    body,
  });
  const text = `Rollout blocked: ${args.promptName}@${args.versionTag}\nReasons:\n${args.reasons.map((r) => `- ${r}`).join("\n")}\n\nView: ${args.promptUrl}`;
  return { subject, html, text };
}

// ─── Quota warning ───────────────────────────────────────────────────────────

export function quotaWarningEmail(args: {
  workspaceName: string;
  usageType: string;
  used: number;
  limit: number;
  billingUrl: string;
}) {
  const pct = Math.round((args.used / args.limit) * 100);
  const usageLabel = args.usageType.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const subject = `Usage warning: ${usageLabel} at ${pct}%`;
  const barFilled = Math.min(pct, 100);
  const barColor = pct >= 90 ? "#ef4444" : pct >= 75 ? "#f59e0b" : "#6366f1";

  const body = `
    <p style="margin:0 0 6px;font-size:22px;font-weight:700;color:#f4f4f5;letter-spacing:-0.3px;">Usage Warning</p>
    <p style="margin:0 0 20px;">${badge(`${pct}% used`, pct >= 90 ? "#f87171" : "#fbbf24", pct >= 90 ? "rgba(248,113,113,0.12)" : "rgba(251,191,36,0.12)")}</p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#a1a1aa;">
      Workspace <strong style="color:#e4e4e7;">${args.workspaceName}</strong> is approaching its
      <strong style="color:#e4e4e7;">${usageLabel}</strong> limit.
    </p>

    <!-- Progress bar -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0a0f;border:1px solid #1e1e2e;border-radius:10px;padding:20px 24px;margin-bottom:24px;">
      <tr>
        <td>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;">
            <tr>
              <td><p style="margin:0;font-size:13px;font-weight:600;color:#f4f4f5;">${usageLabel}</p></td>
              <td align="right"><p style="margin:0;font-size:13px;font-weight:700;color:${barColor};">${args.used.toLocaleString()} / ${args.limit.toLocaleString()}</p></td>
            </tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#1e1e2e;border-radius:4px;overflow:hidden;height:8px;">
            <tr>
              <td width="${barFilled}%" style="background:${barColor};height:8px;border-radius:4px;"></td>
              <td></td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    ${ctaButton("Upgrade plan →", args.billingUrl, `linear-gradient(135deg,${barColor},${pct >= 90 ? "#b91c1c" : "#d97706"})`)}
    <p style="margin:0;font-size:12px;color:#52525b;">Upgrade your plan to increase limits and avoid service interruptions.</p>
  `;

  const html = layout({
    preheader: `You've used ${pct}% of your ${usageLabel} quota`,
    headerAccent: pct >= 90
      ? "linear-gradient(135deg,#dc2626 0%,#7f1d1d 100%)"
      : "linear-gradient(135deg,#d97706 0%,#92400e 100%)",
    body,
  });
  const text = `Usage warning: ${usageLabel} at ${pct}% (${args.used.toLocaleString()}/${args.limit.toLocaleString()})\n\nUpgrade: ${args.billingUrl}`;
  return { subject, html, text };
}

// ─── Prompt promoted ──────────────────────────────────────────────────────────

export function promptPromotedEmail(args: {
  workspaceName: string;
  promptName: string;
  versionTag: string;
  promotedBy: string;
  promptUrl: string;
}) {
  const subject = `🚀 Prompt promoted: ${args.promptName}@${args.versionTag}`;

  const body = `
    <p style="margin:0 0 6px;font-size:22px;font-weight:700;color:#f4f4f5;letter-spacing:-0.3px;">Prompt Promoted</p>
    <p style="margin:0 0 20px;">${badge("Promoted to Production", "#4ade80", "rgba(74,222,128,0.12)")}</p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#a1a1aa;">
      Prompt <strong style="color:#e4e4e7;">${args.promptName}</strong>
      <code style="background:#1e1e2e;padding:2px 6px;border-radius:4px;font-size:12px;color:#a78bfa;">${args.versionTag}</code>
      has been approved and promoted to production in workspace <strong style="color:#e4e4e7;">${args.workspaceName}</strong>.
    </p>
    ${infoCard([
      { label: "Workspace", value: args.workspaceName },
      { label: "Prompt", value: args.promptName },
      { label: "Version", value: args.versionTag, highlight: true },
      { label: "Promoted by", value: args.promotedBy },
    ])}
    ${ctaButton("View prompt →", args.promptUrl, "linear-gradient(135deg,#16a34a,#15803d)")}
  `;

  const html = layout({
    preheader: `${args.promptName}@${args.versionTag} promoted to production by ${args.promotedBy}`,
    headerAccent: "linear-gradient(135deg,#16a34a 0%,#166534 100%)",
    body,
  });
  const text = `Prompt promoted: ${args.promptName}@${args.versionTag}\nPromoted by: ${args.promotedBy}\n\nView: ${args.promptUrl}`;
  return { subject, html, text };
}
