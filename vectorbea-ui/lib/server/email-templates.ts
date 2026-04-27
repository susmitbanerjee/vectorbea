import "server-only";

/** Shared HTML wrapper */
function wrap(content: string, preheader = ""): string {
  const appName = "VectorBea";
  const appUrl = process.env.APP_URL ?? "https://app.vectorbea.app";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${appName}</title>
<style>
body{margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#e2e8f0}
.wrap{max-width:560px;margin:40px auto;background:#12131a;border:1px solid #1e2030;border-radius:12px;overflow:hidden}
.header{background:#6366f1;padding:24px 32px}
.header h1{margin:0;font-size:18px;font-weight:700;color:#fff;letter-spacing:-0.3px}
.body{padding:32px}
.body p{margin:0 0 16px;font-size:14px;line-height:1.6;color:#cbd5e1}
.cta{display:inline-block;margin:8px 0 24px;padding:12px 24px;background:#6366f1;color:#fff !important;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600}
.kv{background:#0d0e17;border:1px solid #1e2030;border-radius:8px;padding:12px 16px;margin:0 0 16px}
.kv dt{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#64748b;margin:0 0 2px}
.kv dd{margin:0;font-size:13px;font-weight:500;color:#f1f5f9}
.footer{padding:16px 32px;border-top:1px solid #1e2030;font-size:11px;color:#475569;text-align:center}
.footer a{color:#6366f1;text-decoration:none}
</style>
</head>
<body>
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${preheader}</div>` : ""}
<div class="wrap">
<div class="header"><h1>${appName}</h1></div>
<div class="body">${content}</div>
<div class="footer"><a href="${appUrl}">${appUrl}</a> · You received this because you have a VectorBea account.</div>
</div>
</body></html>`;
}

// ─── Team invitation — professional enterprise design ─────────────────────────

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

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="X-UA-Compatible" content="IE=edge"/>
<title>You've been invited to ${args.workspaceName}</title>
</head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${args.inviterName} invited you to join ${args.workspaceName} — accept before ${expiryDate}</div>

<!-- Outer wrapper -->
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#09090b;min-height:100vh;">
<tr><td align="center" style="padding:40px 16px;">

<!-- Card -->
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#0f0f14;border:1px solid #1e1e2e;border-radius:16px;overflow:hidden;">

  <!-- Header bar -->
  <tr>
    <td style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);padding:28px 36px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td>
            <p style="margin:0;font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">VectorBea</p>
            <p style="margin:4px 0 0;font-size:10px;font-weight:500;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:0.15em;">AI Release Control</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="padding:36px 36px 28px;">

      <!-- Headline -->
      <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f4f4f5;letter-spacing:-0.3px;">You're invited!</p>
      <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#a1a1aa;">
        <strong style="color:#e4e4e7;">${args.inviterName}</strong> has invited you to join the
        <strong style="color:#e4e4e7;"> ${args.workspaceName}</strong> workspace.
      </p>

      <!-- Role pill -->
      <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
        <tr>
          <td style="background:#1e1e2e;border:1px solid #2e2e3e;border-radius:8px;padding:12px 20px;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-right:20px;">
                  <p style="margin:0;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.14em;color:#71717a;">Workspace</p>
                  <p style="margin:3px 0 0;font-size:14px;font-weight:600;color:#f4f4f5;">${args.workspaceName}</p>
                </td>
                <td style="border-left:1px solid #2e2e3e;padding-left:20px;">
                  <p style="margin:0;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.14em;color:#71717a;">Your role</p>
                  <p style="margin:3px 0 0;font-size:14px;font-weight:600;color:#a78bfa;">${roleCapitalized}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- CTA button -->
      <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
        <tr>
          <td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);border-radius:10px;">
            <a href="${args.acceptUrl}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:-0.1px;">
              Accept invitation →
            </a>
          </td>
        </tr>
      </table>

      <!-- Fallback URL -->
      <p style="margin:0 0 6px;font-size:12px;color:#71717a;">If the button doesn't work, copy and paste this link:</p>
      <p style="margin:0 0 24px;font-size:11px;font-family:'Courier New',monospace;color:#6366f1;word-break:break-all;">${args.acceptUrl}</p>

      <!-- Divider -->
      <hr style="border:none;border-top:1px solid #1e1e2e;margin:0 0 24px;"/>

      <!-- Expiry + security -->
      <p style="margin:0 0 8px;font-size:12px;color:#71717a;">
        ⏱ This invitation expires on <strong style="color:#a1a1aa;">${expiryDate}</strong>.
      </p>
      <p style="margin:0;font-size:12px;color:#52525b;">
        🔒 Only accept this invitation if you expected it. If you didn't request access to ${args.workspaceName}, you can safely ignore this email.
      </p>

    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#09090b;border-top:1px solid #1e1e2e;padding:18px 36px;">
      <p style="margin:0;font-size:11px;color:#3f3f46;text-align:center;">
        VectorBea — AI Release Control &nbsp;·&nbsp;
        <a href="${process.env.APP_URL ?? "https://app.vectorbea.app"}" style="color:#4f46e5;text-decoration:none;">${process.env.APP_URL ?? "https://app.vectorbea.app"}</a>
      </p>
    </td>
  </tr>

</table>
<!-- /Card -->

</td></tr>
</table>
<!-- /Outer wrapper -->
</body>
</html>`;

  const text = `You've been invited to join ${args.workspaceName} on VectorBea

${args.inviterName} has invited you to join ${args.workspaceName} as ${args.role}.

Accept your invitation here:
${args.acceptUrl}

This invitation expires on ${expiryDate}.

Only accept this invitation if you expected it. If you didn't request access, you can safely ignore this email.

— VectorBea AI Release Control`;

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
  const label = args.recommendation.replaceAll("_", " ");
  const subject = `Evaluation complete: ${args.promptName}@${args.versionTag} — ${label}`;
  const html = wrap(
    `<p>An evaluation run has completed for <strong>${args.promptName}@${args.versionTag}</strong>.</p>
<dl class="kv">
  <dt>Workspace</dt><dd>${args.workspaceName}</dd>
  <dt>Verdict</dt><dd>${label}</dd>
  ${args.score != null ? `<dt>Average score</dt><dd>${Math.round(args.score * 100)}%</dd>` : ""}
</dl>
<a href="${args.runUrl}" class="cta">View evaluation report →</a>`,
    `${label}: ${args.promptName}@${args.versionTag}`,
  );
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
  const html = wrap(
    `<p>An evaluation run has <strong>failed</strong> for <strong>${args.promptName}@${args.versionTag}</strong>.</p>
<dl class="kv">
  <dt>Workspace</dt><dd>${args.workspaceName}</dd>
  <dt>Reason</dt><dd>${args.reason}</dd>
</dl>
<a href="${args.runUrl}" class="cta">View details →</a>`,
    `Evaluation failed for ${args.promptName}`,
  );
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
  const html = wrap(
    `<p>A scheduled regression run has <strong>failed</strong>.</p>
<dl class="kv">
  <dt>Workspace</dt><dd>${args.workspaceName}</dd>
  <dt>Schedule</dt><dd>${args.scheduleName}</dd>
  ${args.promptName ? `<dt>Prompt</dt><dd>${args.promptName}</dd>` : ""}
  <dt>Reason</dt><dd>${args.reason}</dd>
</dl>
${args.runUrl ? `<a href="${args.runUrl}" class="cta">View evaluation run →</a>` : ""}`,
    `Regression failed: ${args.scheduleName}`,
  );
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
  const subject = `Alert triggered: ${args.ruleName}`;
  const html = wrap(
    `<p>An alert rule has been triggered in <strong>${args.workspaceName}</strong>.</p>
<dl class="kv">
  <dt>Rule</dt><dd>${args.ruleName}</dd>
  <dt>Metric</dt><dd>${args.metricType.replaceAll("_", " ")}</dd>
  <dt>Value</dt><dd>${Math.round(args.metricValue * 100) / 100}</dd>
  <dt>Threshold</dt><dd>${args.comparison} ${args.threshold}</dd>
</dl>
<a href="${args.alertsUrl}" class="cta">View alerts →</a>`,
    `Alert: ${args.ruleName} — threshold breached`,
  );
  const text = `Alert triggered: ${args.ruleName}\nMetric: ${args.metricType} = ${args.metricValue} (threshold: ${args.comparison} ${args.threshold})\n\nView: ${args.alertsUrl}`;
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
  const html = wrap(
    `<p>A rollout promotion attempt was <strong>blocked</strong> for <strong>${args.promptName}@${args.versionTag}</strong>.</p>
<dl class="kv">
  <dt>Workspace</dt><dd>${args.workspaceName}</dd>
  <dt>Reasons</dt><dd>${args.reasons.join("<br/>")}</dd>
</dl>
<a href="${args.promptUrl}" class="cta">View prompt →</a>`,
    `Rollout blocked: ${args.promptName}`,
  );
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
  const subject = `Usage warning: ${args.usageType.replaceAll("_", " ")} at ${pct}%`;
  const html = wrap(
    `<p>Your workspace <strong>${args.workspaceName}</strong> is approaching its usage limit.</p>
<dl class="kv">
  <dt>Usage type</dt><dd>${args.usageType.replaceAll("_", " ")}</dd>
  <dt>Used</dt><dd>${args.used.toLocaleString()} / ${args.limit.toLocaleString()} (${pct}%)</dd>
</dl>
<a href="${args.billingUrl}" class="cta">Upgrade plan →</a>`,
    `You've used ${pct}% of your ${args.usageType} quota`,
  );
  const text = `Usage warning: ${args.usageType} at ${pct}% (${args.used}/${args.limit})\n\nUpgrade: ${args.billingUrl}`;
  return { subject, html, text };
}
