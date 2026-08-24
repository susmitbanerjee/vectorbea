import "server-only";

/**
 * Where the links point.
 *
 * `NEXT_PUBLIC_APP_URL` first, because that is the variable the rest of the app
 * reads and the one that is actually set. `APP_URL` was read alone here, is set
 * nowhere, and its fallback was `app.vectorbea.app` — a host that does not
 * serve this product. Every link in every email pointed at it.
 */
const APP_URL = () =>
  (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "https://vectorbea.com").replace(/\/+$/, "");

const SETTINGS_URL = (workspaceId?: string) =>
  `${APP_URL()}/settings${workspaceId ? `?org=${encodeURIComponent(workspaceId)}` : ""}`;

type StatusTone = "success" | "warning" | "failure" | "info" | "neutral";

/* ─── Design tokens ───────────────────────────────────────────────────────────
   THE PRODUCT'S PALETTE, NOT A SECOND ONE.

   These were a warm cream page (`#F8F5EF`) over generic Tailwind greys and
   blues — the amber marketing identity, which is a different visual language
   from the app the recipient lands in. An email that looks like another product
   is the last thing somebody sees before deciding whether a link is genuine.

   Every value below is the literal resolution of a token in
   `src/styles/tokens/colour.css`, light theme, named in the comment. Email has
   no CSS variables, so this is the one place they are restated — the mapping is
   spelled out so a token change can be followed here.
─────────────────────────────────────────────────────────────────────────────── */
const T = {
  page:          "#f3f5f9", // --bg-canvas  (paper-100)
  card:          "#ffffff", // --bg-base    (paper-0)
  sunken:        "#f3f5f9", // --bg-sunken  (paper-100)
  border:        "#e9ecf3", // --border-subtle (paper-200)
  borderStrong:  "#d7dce7", // paper-300
  textMax:       "#0a0c12", // --fg-max       (paper-1000)
  textPrimary:   "#1b2030", // --fg-primary   (paper-900)
  textBody:      "#1b2030", // --fg-primary
  textSecondary: "#4a5266", // --fg-secondary (paper-700)
  textMuted:     "#5e6880", // --fg-muted     (paper-600)

  // Brand. Iris is the only hue permitted to mean "Vectorbea".
  accent:        "#4644d6", // --accent       (iris-600)
  accentDark:    "#3735ac", // --accent-hover (iris-700)
  accentSubtle:  "#eff0fe", // --accent-subtle(iris-50)

  successText:   "#0a7a4f", // --status-success        (verdant-700)
  successHeading:"#0a7a4f",
  successBg:     "#e6f7ef", // --status-success-subtle (verdant-50)
  successBorder: "#0e9c66", // --status-success-border (verdant-600)

  warningText:   "#94520f", // --status-waiting        (ember-700)
  warningHeading:"#94520f",
  warningBg:     "#ffe3bc", // --status-waiting-subtle (ember-200)
  warningBorder: "#94520f", // --status-waiting-border (ember-700)

  failureText:   "#ac1c33", // --status-failed        (signal-700)
  failureHeading:"#ac1c33",
  failureBg:     "#fdeaed", // --status-failed-subtle (signal-50)
  failureBorder: "#d62842", // --status-failed-border (signal-600)

  infoText:      "#0a748f", // --status-live        (pulse-700)
  infoBg:        "#e3f6fb", // --status-live-subtle (pulse-50)
  infoBorder:    "#0c93b4", // --status-live-border (pulse-600)

  neutralBg:     "#f3f5f9", // --bg-sunken
} as const;

function toneColors(tone: StatusTone) {
  if (tone === "success") return { text: T.successText, heading: T.successHeading, bg: T.successBg, border: T.successBorder };
  if (tone === "warning") return { text: T.warningText, heading: T.warningHeading, bg: T.warningBg, border: T.warningBorder };
  if (tone === "failure") return { text: T.failureText, heading: T.failureHeading, bg: T.failureBg, border: T.failureBorder };
  if (tone === "info")    return { text: T.infoText, heading: T.infoText, bg: T.infoBg, border: T.infoBorder };
  return { text: T.textBody, heading: T.textPrimary, bg: T.neutralBg, border: T.border };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function esc(value: string | number | null | undefined): string {
  const s = String(value ?? "");
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function statusBadge(label: string, tone: StatusTone): string {
  const c = toneColors(tone);
  return `<span style="display:inline-block;padding:4px 12px;border-radius:999px;background:${c.bg};border:1px solid ${c.border};color:${c.text};font-size:11px;font-weight:700;">${esc(label)}</span>`;
}

function kvTable(rows: Array<{ key: string; value: string | null | undefined }>): string {
  const filtered = rows.filter((r) => r.value != null && String(r.value).trim().length > 0);
  if (filtered.length === 0) return "";
  const body = filtered
    .map(
      (row) => `<tr>
  <td style="padding:9px 14px;border-bottom:1px solid ${T.border};width:36%;font-size:11px;font-weight:700;color:${T.textMuted};vertical-align:top;">${esc(row.key)}</td>
  <td style="padding:9px 14px;border-bottom:1px solid ${T.border};font-size:13px;font-weight:600;color:${T.textPrimary};word-break:break-word;">${esc(row.value ?? "")}</td>
</tr>`,
    )
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${T.border};border-radius:12px;overflow:hidden;background:${T.card};margin:0 0 20px;">${body}</table>`;
}

function actionButton(label: string, href: string): string {
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">
  <tr>
    <td style="background:${T.accent};border-radius:10px;">
      <a href="${href}" style="display:inline-block;padding:13px 24px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;line-height:1;">${esc(label)}</a>
    </td>
  </tr>
</table>`;
}

function calloutBox(text: string, tone: StatusTone): string {
  const c = toneColors(tone);
  return `<div style="margin:0 0 20px;padding:12px 16px;border-radius:10px;background:${c.bg};border:1px solid ${c.border};">
  <p style="margin:0;font-size:13px;line-height:1.6;color:${c.heading};font-weight:600;">${esc(text)}</p>
</div>`;
}

function nextStep(text: string): string {
  return `<div style="margin:0 0 20px;padding:12px 16px;border-radius:10px;background:${T.neutralBg};border:1px solid ${T.border};">
  <p style="margin:0 0 3px;font-size:11px;font-weight:700;color:${T.textMuted};">Recommended next step</p>
  <p style="margin:0;font-size:13px;line-height:1.6;color:${T.textBody};">${esc(text)}</p>
</div>`;
}

/**
 * The same destination as the button, in copyable plain text.
 *
 * Corporate mail clients and security gateways routinely strip or rewrite
 * styled anchors, and a recipient staring at a dead button has no way to
 * proceed. On an invitation this is the difference between joining and giving
 * up, so it is not optional decoration.
 */
function linkFallback(href: string): string {
  return `<p style="margin:0 0 4px;font-size:12px;color:${T.textMuted};line-height:1.5;">Or paste this into your browser:</p>
<p style="margin:0 0 20px;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${href}" style="color:${T.accent};text-decoration:none;">${esc(href)}</a></p>`;
}

/** One line of facts, comma-separated. Lighter than a table when there are two or three. */
function metaLine(parts: Array<{ label: string; value: string | null | undefined }>): string {
  const filtered = parts.filter((part) => part.value != null && String(part.value).trim().length > 0);
  if (filtered.length === 0) return "";
  const body = filtered
    .map(
      (part) =>
        `<span style="white-space:nowrap;"><span style="color:${T.textMuted};">${esc(part.label)}</span> <span style="color:${T.textPrimary};font-weight:600;">${esc(part.value ?? "")}</span></span>`,
    )
    .join(`<span style="color:${T.borderStrong};padding:0 8px;">·</span>`);
  return `<p style="margin:0 0 22px;font-size:13px;line-height:1.9;">${body}</p>`;
}

function sectionHeading(text: string): string {
  return `<p style="margin:20px 0 8px;font-size:11px;font-weight:700;color:${T.textMuted};">${esc(text)}</p>`;
}

function divider(): string {
  return `<hr style="border:0;border-top:1px solid ${T.border};margin:20px 0;" />`;
}

function gateRow(gate: string, status: "passed" | "failed" | "missing" | "not_required"): string {
  const icons: Record<string, string> = {
    passed: "✓",
    failed: "✗",
    missing: "—",
    not_required: "·",
  };
  const colors: Record<string, string> = {
    passed: T.successText,
    failed: T.failureText,
    missing: T.textMuted,
    not_required: T.textMuted,
  };
  const icon = icons[status] ?? "?";
  const color = colors[status] ?? T.textBody;
  return `<tr>
  <td style="padding:7px 14px;border-bottom:1px solid ${T.border};font-size:13px;color:${T.textSecondary};">${esc(gate)}</td>
  <td style="padding:7px 14px;border-bottom:1px solid ${T.border};font-size:13px;font-weight:700;color:${color};text-align:right;">${icon} ${esc(status.replaceAll("_", " "))}</td>
</tr>`;
}

// ─── Layout ───────────────────────────────────────────────────────────────────

function layout(args: {
  workspaceId?: string;
  workspaceName?: string;
  preheader?: string;
  body: string;
  reason?: string;
  /**
   * The one link in the footer. Defaults to this workspace's settings.
   *
   * It used to be a hardcoded "Manage notification preferences" pointing at
   * `/settings?tab=notifications` — a tab that does not exist. A dead link in
   * the footer of every email the product sends is the sort of detail that
   * decides whether the rest of it is believed.
   */
  footerLink?: { label: string; href: string } | null;
}) {
  const preheader = args.preheader ?? "";
  const workspaceName = args.workspaceName ? esc(args.workspaceName) : "Vectorbea";
  const footerLink =
    args.footerLink === null
      ? null
      : (args.footerLink ?? { label: "Workspace settings", href: SETTINGS_URL(args.workspaceId) });
  const reason = args.reason ?? "You received this because notifications are enabled for this workspace";

  /*
   * The mark: a hosted PNG, not an inline SVG.
   *
   * The previous logo was a base64 `data:image/svg+xml` of the amber bee — two
   * problems in one line. It was the marketing identity rather than the
   * product's, and GMAIL STRIPS SVG ENTIRELY, data URIs included, so for most
   * recipients there was no logo at all.
   *
   * `/email/vectorbea-mark.png` is the checkpoint cell from `app/icon.svg`,
   * rasterised at 128px for retina and served over https. Remote images can be
   * blocked by default in some clients, which is exactly why the wordmark
   * beside it is REAL TEXT: with images off the lockup still reads "Vectorbea"
   * in the brand colour rather than collapsing to a broken-image box.
   */
  const LOGO_URI = `${APP_URL()}/email/vectorbea-mark.png`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>Vectorbea notification</title>
<!--[if !mso]><!-->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<!--<![endif]-->
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  body, table, td, a { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif !important; }
</style>
</head>
<body style="margin:0;padding:0;background:${T.page};font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;mso-hide:all;">${esc(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>` : ""}
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${T.page};padding:28px 12px;">
  <tr>
    <td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;">

        <!-- Header / logo row -->
        <tr>
          <td style="padding:0 0 6px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-size:17px;font-weight:700;color:${T.textMax};letter-spacing:-0.02em;">
                  <a href="${APP_URL()}" style="text-decoration:none;color:${T.textMax};">
                    <img src="${LOGO_URI}" width="22" height="22" alt="" style="display:inline-block;border:0;outline:none;text-decoration:none;vertical-align:middle;margin-right:8px;border-radius:5px;" /><span style="display:inline-block;vertical-align:middle;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:17px;font-weight:700;letter-spacing:-0.02em;color:${T.textMax};">Vectorbea</span>
                  </a>
                </td>
                <td align="right" style="font-size:12px;font-weight:500;color:${T.textMuted};">${workspaceName}</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Main card -->
        <tr>
          <td style="background:${T.card};border:1px solid ${T.border};border-radius:16px;overflow:hidden;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding:28px 28px 24px;">${args.body}</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:16px 4px 8px;">
            <p style="margin:0 0 6px;font-size:12px;color:${T.textMuted};line-height:1.5;">${esc(reason)}</p>
            ${footerLink
              ? `<p style="margin:0;font-size:12px;color:${T.textMuted};">
              <a href="${footerLink.href}" style="color:${T.accent};text-decoration:none;font-weight:600;">${esc(footerLink.label)}</a>
            </p>`
              : ""}
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtScore(score: number | null | undefined): string {
  if (score == null) return "Unavailable";
  return `${Math.round(score * 100)}%`;
}

function fmtPct(rate: number | null | undefined): string {
  if (rate == null) return "Unavailable";
  return `${Math.round(rate * 100)}%`;
}

function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return "Unavailable";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function fmtMetricType(raw: string): string {
  const map: Record<string, string> = {
    latency_p95: "P95 latency",
    error_rate: "Error rate",
    eval_score_avg: "Evaluation score avg",
    cache_hit_rate: "Cache hit rate",
  };
  return map[raw] ?? raw.replaceAll("_", " ");
}

function fmtMetricValue(metricType: string, value: number): string {
  if (metricType === "latency_p95") return `${Math.round(value)} ms`;
  if (metricType === "error_rate" || metricType === "cache_hit_rate") return `${(Math.round(value * 10) / 10).toFixed(1)}%`;
  if (metricType === "eval_score_avg") return `${(Math.round(value * 100) / 100).toFixed(2)}`;
  return String(value);
}

function fmtComparison(op: string): string {
  const map: Record<string, string> = { gt: ">", lt: "<", gte: "≥", lte: "≤" };
  return map[op] ?? op;
}

function fmtRunType(runType: string | null | undefined): string {
  if (runType === "behavioral" || runType === "behavioral_rubric") return "Behavioral rubric";
  if (runType === "provider_arena") return "Provider Arena";
  if (runType === "baseline") return "Baseline";
  if (runType === "trace_set") return "Trace replay";
  if (runType === "dataset") return "Dataset";
  return "Standard";
}

// ─── Template 1: Team invitation ─────────────────────────────────────────────

export function teamInvitationEmail(args: {
  inviterName: string;
  workspaceName: string;
  role: string;
  acceptUrl: string;
  expiresAt: string;
}) {
  const subject = `${args.inviterName} invited you to ${args.workspaceName} on Vectorbea`;
  const expiry = new Date(args.expiresAt);
  const expiryDate = expiry.toLocaleDateString("en-US", { dateStyle: "long" });
  const roleLabel = ROLE_LABELS[args.role] ?? args.role;

  /*
   * ONE THING TO DO, AND EVERYTHING NEEDED TO DECIDE IT.
   *
   * The previous version stacked a badge, a heading, a restatement of the
   * heading, a three-row table, a button, and a "Recommended next step" box
   * that repeated the expiry date already in the table — six blocks to say
   * "someone invited you, click here". An invitation is read in four seconds on
   * a phone: who, where, as what, by when, and the button.
   *
   * `ROLE_LABELS` explains the role rather than naming it. "Developer" tells
   * somebody outside the company nothing about what they are accepting.
   */
  const body = `
<h1 style="margin:0 0 10px;font-size:22px;line-height:1.3;font-weight:800;color:${T.textPrimary};letter-spacing:-0.01em;">Join ${esc(args.workspaceName)} on Vectorbea</h1>
<p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:${T.textSecondary};">${esc(args.inviterName)} invited you to this workspace as ${esc(roleLabel.article)} <strong style="color:${T.textPrimary};">${esc(roleLabel.name)}</strong> — ${esc(roleLabel.summary)}.</p>
${metaLine([
  { label: "Workspace", value: args.workspaceName },
  { label: "Invited by", value: args.inviterName },
  { label: "Expires", value: expiryDate },
])}
${actionButton("Accept invitation", args.acceptUrl)}
${linkFallback(args.acceptUrl)}
`;

  return {
    subject,
    html: layout({
      workspaceName: args.workspaceName,
      preheader: `${args.inviterName} invited you to ${args.workspaceName}. The link expires ${expiryDate}.`,
      body,
      reason: `You received this because ${args.inviterName} invited this address to ${args.workspaceName}. If you were not expecting it, ignore this email — the invitation expires on its own.`,
      // No footer link: the recipient is not a member yet, so every in-product
      // destination would refuse them.
      footerLink: null,
    }),
    text: [
      `Join ${args.workspaceName} on Vectorbea`,
      ``,
      `${args.inviterName} invited you as ${roleLabel.name} — ${roleLabel.summary}.`,
      `The invitation expires on ${expiryDate}.`,
      ``,
      `Accept: ${args.acceptUrl}`,
      ``,
      `If you were not expecting this, ignore it — the invitation expires on its own.`,
    ].join("\n"),
  };
}

/**
 * What a role actually means, for somebody outside the company.
 *
 * Matches `ROLE_OPTIONS` in the Members screen. An invitation that says
 * "Developer" and nothing else asks the recipient to accept a permission set
 * they cannot see.
 */
const ROLE_LABELS: Record<string, { name: string; article: string; summary: string }> = {
  owner: { name: "Owner", article: "an", summary: "full control, including billing and deleting the workspace" },
  admin: { name: "Admin", article: "an", summary: "manage members, settings and connections" },
  developer: { name: "Developer", article: "a", summary: "build and run workflows" },
  editor: { name: "Developer", article: "a", summary: "build and run workflows" },
  viewer: { name: "Viewer", article: "a", summary: "read-only access across the workspace" },
};

// ─── Template 1b: Welcome, after an invitation is accepted ───────────────────

/**
 * Sent once, to the person who just joined.
 *
 * Not a duplicate of the invitation: that one asked a question, this one
 * confirms the answer and orients somebody who has never seen this workspace
 * before. It matters most for the case the invitation cannot cover — a person
 * who already has their own workspace and now has two, and needs to know the
 * switcher exists before they go looking for work that is not in the one they
 * are staring at.
 */
export function workspaceWelcomeEmail(args: {
  workspaceName: string;
  workspaceId: string;
  role: string;
  invitedByName?: string | null;
  /** True when this is not the only workspace they belong to. */
  hasOtherWorkspaces: boolean;
}) {
  const roleLabel = ROLE_LABELS[args.role] ?? { name: args.role, article: "a", summary: "" };
  const openUrl = `${APP_URL()}/control?org=${encodeURIComponent(args.workspaceId)}`;
  const subject = `You are in — ${args.workspaceName} on Vectorbea`;

  const body = `
${statusBadge("You're in", "success")}
<h1 style="margin:16px 0 10px;font-size:22px;line-height:1.3;font-weight:800;color:${T.textPrimary};letter-spacing:-0.01em;">Welcome to ${esc(args.workspaceName)}</h1>
<p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:${T.textSecondary};">${args.invitedByName ? `${esc(args.invitedByName)} added you as ` : "You joined as "}${esc(roleLabel.article)} <strong style="color:${T.textPrimary};">${esc(roleLabel.name)}</strong>${roleLabel.summary ? ` — ${esc(roleLabel.summary)}` : ""}.</p>
${args.hasOtherWorkspaces
  // Neutral, not `info`: the info tone's blue sits beside the iris button and
  // reads as a second brand colour, and an orientation note is guidance rather
  // than a status. Nothing here is a state anybody has to act on.
  ? calloutBox(
      `You are now in more than one workspace. Use the switcher at the top of the sidebar to move between them — ${args.workspaceName} will not appear in your other workspace's runs, workflows or connections.`,
      "neutral",
    )
  : ""}
${actionButton(`Open ${args.workspaceName}`, openUrl)}
${linkFallback(openUrl)}
`;

  return {
    subject,
    html: layout({
      workspaceId: args.workspaceId,
      workspaceName: args.workspaceName,
      preheader: `You joined ${args.workspaceName} as ${roleLabel.name}.`,
      body,
      reason: `You received this because you accepted an invitation to ${args.workspaceName}.`,
      footerLink: { label: "Leave this workspace", href: `${APP_URL()}/settings/members?org=${encodeURIComponent(args.workspaceId)}` },
    }),
    text: [
      `Welcome to ${args.workspaceName}`,
      ``,
      `${args.invitedByName ? `${args.invitedByName} added you as ` : "You joined as "}${roleLabel.article} ${roleLabel.name}${roleLabel.summary ? ` — ${roleLabel.summary}` : ""}.`,
      args.hasOtherWorkspaces
        ? `You are now in more than one workspace. Use the switcher at the top of the sidebar to move between them.`
        : ``,
      ``,
      `Open it: ${openUrl}`,
    ].filter(Boolean).join("\n"),
  };
}

// ─── Template 2: Evaluation completed ────────────────────────────────────────

export function evaluationCompletedEmail(args: {
  workspaceName: string;
  workspaceId?: string;
  promptName: string;
  versionTag: string;
  recommendation: string;
  score: number | null;
  runUrl: string;
  datasetName?: string | null;
  runType?: "baseline" | "behavioral" | "behavioral_rubric" | "trace_set" | "dataset" | "provider_arena";
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
  const verdict = args.recommendation.replaceAll("_", " ");
  const isFailed    = verdict.includes("fail") || verdict.includes("block");
  const isReview    = verdict.includes("review") || verdict.includes("caution");
  const tone: StatusTone = isFailed ? "failure" : isReview ? "warning" : "success";
  const isBehavioral = args.runType === "behavioral" || args.runType === "behavioral_rubric" || args.runType === "provider_arena";

  const subjectVerdict = isFailed ? "needs attention" : isReview ? "needs review" : "passed";
  const subject = `Evaluation ${subjectVerdict} — ${args.promptName} ${args.versionTag}`;

  const summaryRows = [
    { key: "Evaluation type",  value: fmtRunType(args.runType) },
    { key: "Prompt",           value: args.promptName },
    { key: "Version",          value: args.versionTag },
    { key: "Dataset",          value: args.datasetName },
    { key: "Score",            value: fmtScore(args.score) },
    { key: "Pass rate",        value: args.passRate != null ? fmtPct(args.passRate) : null },
    { key: "Total cases",      value: args.totalCount != null ? String(args.totalCount) : null },
    { key: "Failed cases",     value: args.failedCount != null ? String(args.failedCount) : null },
    { key: "Needs review",     value: args.needsReviewCount != null ? String(args.needsReviewCount) : null },
    ...(isBehavioral ? [
      { key: "Rubric",         value: args.rubricName },
      { key: "Hard failures",  value: args.hardFailureCount != null ? String(args.hardFailureCount) : null },
      { key: "Avg confidence", value: args.averageConfidence != null ? fmtPct(args.averageConfidence) : null },
    ] : []),
    { key: "Provider",         value: args.provider },
    { key: "Model",            value: args.model },
    { key: "Duration",         value: fmtDuration(args.durationMs) },
  ];

  const calloutText = isFailed
    ? "This evaluation did not pass. Review failed cases before promoting this version."
    : isReview
      ? "This evaluation requires manual review. Check uncertain cases before rolling out."
      : "This evaluation passed successfully. The version is ready for rollout review.";

  const nextStepText = isFailed
    ? "Open the evaluation run to inspect failed checks, scoring details, and individual item outputs."
    : isReview
      ? "Review the flagged cases in the evaluation run and decide whether to promote or rerun."
      : "Review the score breakdown, then promote this version to candidate when ready.";

  const body = `
${statusBadge(verdict, tone)}
<h1 style="margin:16px 0 8px;font-size:22px;line-height:1.25;font-weight:800;color:${T.textPrimary};">Evaluation completed for ${esc(args.promptName)}</h1>
<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:${T.textSecondary};">The run finished with a <strong>${esc(verdict)}</strong> result${args.datasetName ? ` on dataset <strong>${esc(args.datasetName)}</strong>` : ""}</p>
${calloutBox(calloutText, tone)}
${sectionHeading("Run summary")}
${kvTable(summaryRows)}
${actionButton("Open evaluation run", args.runUrl)}
${nextStep(nextStepText)}
`;

  return {
    subject,
    html: layout({
      workspaceName: args.workspaceName,
      workspaceId: args.workspaceId,
      preheader: `${args.promptName} ${args.versionTag} — ${verdict}`,
      body,
      reason: "You received this because evaluation notifications are enabled for this workspace",
    }),
    text: [
      `Evaluation completed — ${args.promptName} ${args.versionTag}`,
      `Verdict: ${verdict}`,
      `Score: ${fmtScore(args.score)}`,
      args.datasetName ? `Dataset: ${args.datasetName}` : "",
      args.provider ? `Provider: ${args.provider}` : "",
      args.model ? `Model: ${args.model}` : "",
      `Open: ${args.runUrl}`,
    ].filter(Boolean).join("\n"),
  };
}

// ─── Template 3: Evaluation failed ───────────────────────────────────────────

export function evaluationFailedEmail(args: {
  workspaceName: string;
  workspaceId?: string;
  promptName: string;
  versionTag: string;
  reason: string;
  runUrl: string;
  datasetName?: string | null;
  runType?: "baseline" | "behavioral" | "behavioral_rubric" | "trace_set" | "dataset" | "provider_arena";
  provider?: string | null;
  model?: string | null;
  startedBy?: string | null;
}) {
  const subject = `Evaluation failed — ${args.promptName} ${args.versionTag}`;
  const safeReason = args.reason.slice(0, 300); // never leak full stack traces

  const body = `
${statusBadge("Evaluation failed", "failure")}
<h1 style="margin:16px 0 8px;font-size:22px;line-height:1.25;font-weight:800;color:${T.textPrimary};">Evaluation failed for ${esc(args.promptName)}</h1>
<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:${T.textSecondary};">The evaluation run could not complete. Review the details and rerun when the issue is resolved.</p>
${calloutBox("This evaluation failed due to an execution error. No scoring was performed.", "failure")}
${sectionHeading("Run details")}
${kvTable([
  { key: "Evaluation type", value: fmtRunType(args.runType) },
  { key: "Prompt",          value: args.promptName },
  { key: "Version",         value: args.versionTag },
  { key: "Dataset",         value: args.datasetName },
  { key: "Provider",        value: args.provider },
  { key: "Model",           value: args.model },
  { key: "Started by",      value: args.startedBy },
  { key: "Failure reason",  value: safeReason },
])}
${actionButton("Open evaluation details", args.runUrl)}
${nextStep("Check provider connectivity and model availability. Inspect execution logs in the app for the full error detail.")}
`;

  return {
    subject,
    html: layout({
      workspaceName: args.workspaceName,
      workspaceId: args.workspaceId,
      preheader: `Evaluation failed — ${args.promptName}`,
      body,
      reason: "You received this because evaluation failure notifications are enabled for this workspace",
    }),
    text: `Evaluation failed\nPrompt ${args.promptName}\nVersion ${args.versionTag}\nReason ${safeReason}\nOpen ${args.runUrl}`,
  };
}

// ─── Template 4: Regression failed ───────────────────────────────────────────

export function regressionFailedEmail(args: {
  workspaceName: string;
  workspaceId?: string;
  scheduleName: string;
  promptName: string | null;
  reason: string;
  runUrl: string | null;
  previousScore?: number | null;
  currentScore?: number | null;
  failedCases?: number;
  datasetName?: string | null;
  promptVersion?: string | null;
}) {
  const subject = `Regression failed — ${args.scheduleName}`;
  const hasScores = args.previousScore != null && args.currentScore != null;
  const scoreDelta = hasScores ? Math.round((args.currentScore! - args.previousScore!) * 100) : null;

  const body = `
${statusBadge("Regression failed", "failure")}
<h1 style="margin:16px 0 8px;font-size:22px;line-height:1.25;font-weight:800;color:${T.textPrimary};">Scheduled regression failed${args.promptName ? ` for ${esc(args.promptName)}` : ""}</h1>
<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:${T.textSecondary};">The latest regression check did not meet the configured threshold or failed during execution.</p>
${calloutBox("Regression detected. Review prompt or provider changes that may have introduced this regression.", "failure")}
${sectionHeading("Regression details")}
${kvTable([
  { key: "Schedule",       value: args.scheduleName },
  { key: "Prompt",         value: args.promptName },
  { key: "Version",        value: args.promptVersion },
  { key: "Dataset",        value: args.datasetName },
  { key: "Previous score", value: hasScores ? fmtScore(args.previousScore) : null },
  { key: "Current score",  value: hasScores ? fmtScore(args.currentScore) : null },
  { key: "Score change",   value: scoreDelta != null ? `${scoreDelta > 0 ? "+" : ""}${scoreDelta}%` : null },
  { key: "Failed cases",   value: args.failedCases != null ? String(args.failedCases) : null },
  { key: "Reason",         value: args.reason },
])}
${args.runUrl ? actionButton("Open regression run", args.runUrl) : ""}
${nextStep("Compare failed cases against previous passing results. Look for recent changes in prompt templates, model settings, or dataset content.")}
`;

  return {
    subject,
    html: layout({
      workspaceName: args.workspaceName,
      workspaceId: args.workspaceId,
      preheader: `Regression failed — ${args.scheduleName}`,
      body,
      reason: "You received this because regression notifications are enabled for this workspace",
    }),
    text: [
      `Regression failed — ${args.scheduleName}`,
      args.promptName ? `Prompt: ${args.promptName}` : "",
      hasScores ? `Score: ${fmtScore(args.previousScore)} → ${fmtScore(args.currentScore)}` : "",
      `Reason: ${args.reason}`,
      args.runUrl ? `Open: ${args.runUrl}` : "",
    ].filter(Boolean).join("\n"),
  };
}

// ─── Template 5: Alert triggered ─────────────────────────────────────────────

export function alertTriggeredEmail(args: {
  workspaceName: string;
  workspaceId?: string;
  ruleName: string;
  metricType: string;
  metricValue: number;
  threshold: number;
  comparison: string;
  alertsUrl: string;
  alertEventId?: string | null;
  promptName?: string | null;
  environment?: string | null;
  provider?: string | null;
  model?: string | null;
}) {
  const metricLabel = fmtMetricType(args.metricType);
  const metricVal   = fmtMetricValue(args.metricType, args.metricValue);
  const threshVal   = fmtMetricValue(args.metricType, args.threshold);
  const comparison  = fmtComparison(args.comparison);

  // Severity-based tone
  const isError = args.metricType === "error_rate";
  const tone: StatusTone = isError && args.metricValue >= args.threshold * 2 ? "failure" : "warning";

  const subject = `Alert triggered — ${args.ruleName}`;

  const body = `
${statusBadge("Alert triggered", tone)}
<h1 style="margin:16px 0 8px;font-size:22px;line-height:1.25;font-weight:800;color:${T.textPrimary};">${esc(args.ruleName)} triggered${args.environment ? ` in ${esc(args.environment)}` : ""}</h1>
<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:${T.textSecondary};">The configured threshold was crossed for <strong>${esc(metricLabel)}</strong>${args.promptName ? ` on prompt <strong>${esc(args.promptName)}</strong>` : ""}</p>
${calloutBox(`${metricLabel} is currently ${metricVal} (threshold ${comparison} ${threshVal})`, tone)}
${sectionHeading("Alert details")}
${kvTable([
  { key: "Alert rule",   value: args.ruleName },
  { key: "Metric",       value: metricLabel },
  { key: "Current value",value: metricVal },
  { key: "Threshold",    value: `${comparison} ${threshVal}` },
  { key: "Environment",  value: args.environment },
  { key: "Prompt",       value: args.promptName },
  { key: "Provider",     value: args.provider },
  { key: "Model",        value: args.model },
  { key: "Triggered at", value: new Date().toISOString() },
])}
${actionButton("View alert", args.alertsUrl)}
${nextStep("Review recent traces for the affected prompt. Compare against the baseline period to identify the change that triggered this alert.")}
`;

  return {
    subject,
    html: layout({
      workspaceName: args.workspaceName,
      workspaceId: args.workspaceId,
      preheader: `${args.ruleName} — ${metricLabel} ${metricVal}`,
      body,
      reason: "You received this because alert notifications are enabled for this workspace",
    }),
    text: [
      `Alert triggered — ${args.ruleName}`,
      `Metric: ${metricLabel}`,
      `Current: ${metricVal}`,
      `Threshold: ${comparison} ${threshVal}`,
      args.environment ? `Environment: ${args.environment}` : "",
      `Open: ${args.alertsUrl}`,
    ].filter(Boolean).join("\n"),
  };
}

// ─── Template 6: Rollout blocked ─────────────────────────────────────────────

export function rolloutBlockedEmail(args: {
  workspaceName: string;
  workspaceId?: string;
  promptName: string;
  versionTag: string;
  reasons: string[];
  promptUrl: string;
  rolloutCheckId?: string | null;
  requestedBy?: string | null;
  targetEnvironment?: string | null;
  rolloutPercentage?: number | null;
  gateResults?: Array<{ gate: string; status: "passed" | "failed" | "missing" | "not_required" }>;
}) {
  const subject = `Rollout blocked — ${args.promptName} ${args.versionTag}`;

  const reasonsList = args.reasons
    .map((r) => `<li style="margin:0 0 6px;color:${T.textBody};font-size:13px;line-height:1.5;">${esc(r)}</li>`)
    .join("");

  const gateTable = args.gateResults && args.gateResults.length > 0
    ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${T.border};border-radius:12px;overflow:hidden;background:${T.card};margin:0 0 20px;">
${args.gateResults.map((g) => gateRow(g.gate, g.status)).join("")}
</table>`
    : "";

  const body = `
${statusBadge("Rollout blocked", "failure")}
<h1 style="margin:16px 0 8px;font-size:22px;line-height:1.25;font-weight:800;color:${T.textPrimary};">Rollout blocked for ${esc(args.promptName)}</h1>
<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:${T.textSecondary};">Vectorbea blocked this rollout because one or more safety gates failed</p>
${calloutBox("This version cannot be rolled out until the failing gates are resolved.", "failure")}
${sectionHeading("Rollout details")}
${kvTable([
  { key: "Prompt",       value: args.promptName },
  { key: "Version",      value: args.versionTag },
  { key: "Environment",  value: args.targetEnvironment },
  { key: "Rollout %",    value: args.rolloutPercentage != null ? `${args.rolloutPercentage}%` : null },
  { key: "Requested by", value: args.requestedBy },
])}
${args.reasons.length > 0 ? `${sectionHeading("Blocking reasons")}
<ul style="margin:0 0 20px;padding:0 0 0 16px;">${reasonsList}</ul>` : ""}
${gateTable ? `${sectionHeading("Gate status")}${gateTable}` : ""}
${actionButton("Review rollout block", args.promptUrl)}
${nextStep("Open the failing gate and review the latest evaluation result. Fix the issues and rerun the evaluation before attempting rollout again.")}
`;

  return {
    subject,
    html: layout({
      workspaceName: args.workspaceName,
      workspaceId: args.workspaceId,
      preheader: `Rollout blocked — ${args.promptName} ${args.versionTag}`,
      body,
      reason: "You received this because rollout notifications are enabled for this workspace",
    }),
    text: [
      `Rollout blocked — ${args.promptName} ${args.versionTag}`,
      `Reasons: ${args.reasons.join("; ")}`,
      `Open: ${args.promptUrl}`,
    ].filter(Boolean).join("\n"),
  };
}

// ─── Template 7: Quota warning ────────────────────────────────────────────────

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
    ? `Usage limit reached — ${args.workspaceName}`
    : `Usage nearing limit — ${args.workspaceName}`;

  const body = `
${statusBadge(isExceeded ? "Quota exceeded" : "Quota nearing", tone)}
<h1 style="margin:16px 0 8px;font-size:22px;line-height:1.25;font-weight:800;color:${T.textPrimary};">${isExceeded ? "Usage limit reached" : "Usage nearing limit"}</h1>
<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:${T.textSecondary};">${esc(label)} usage is at <strong>${pct}%</strong> of the plan limit</p>
${calloutBox(
  isExceeded
    ? `${label} limit reached. New ${label.toLowerCase()} will be rejected until the limit resets or the plan is upgraded.`
    : `${label} usage is at ${pct}%. Consider upgrading the plan before the limit is reached.`,
  tone,
)}
${kvTable([
  { key: "Usage type",    value: label },
  { key: "Current usage", value: args.used.toLocaleString() },
  { key: "Plan limit",    value: args.limit.toLocaleString() },
  { key: "Used",          value: `${pct}%` },
])}
${actionButton("Manage usage", args.billingUrl)}
${nextStep("Review usage patterns and consider upgrading the plan or adjusting retention settings.")}
`;

  return {
    subject,
    html: layout({
      workspaceName: args.workspaceName,
      workspaceId: args.workspaceId,
      preheader: `${label} ${pct}% — ${args.workspaceName}`,
      body,
      reason: "You received this because quota notifications are enabled and you are a workspace admin or owner",
    }),
    text: `Usage notification — ${args.workspaceName}\n${label}: ${args.used.toLocaleString()} / ${args.limit.toLocaleString()} (${pct}%)\nManage: ${args.billingUrl}`,
  };
}

// ─── Template 8: Prompt promoted ─────────────────────────────────────────────

export function promptPromotedEmail(args: {
  workspaceName: string;
  workspaceId?: string;
  promptName: string;
  versionTag: string;
  promotedBy: string;
  promptUrl: string;
}) {
  const subject = `Rollout approved — ${args.promptName} ${args.versionTag}`;

  const body = `
${statusBadge("Rollout approved", "success")}
<h1 style="margin:16px 0 8px;font-size:22px;line-height:1.25;font-weight:800;color:${T.textPrimary};">Prompt version is now active</h1>
<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:${T.textSecondary};">Version ${esc(args.versionTag)} for <strong>${esc(args.promptName)}</strong> has been approved and is now receiving traffic</p>
${kvTable([
  { key: "Prompt",      value: args.promptName },
  { key: "Version",     value: args.versionTag },
  { key: "Approved by", value: args.promotedBy },
  { key: "Status",      value: "Active" },
])}
${actionButton("View active version", args.promptUrl)}
${nextStep("Continue monitoring metrics, alerts, and scheduled regressions as traffic scales up.")}
`;

  return {
    subject,
    html: layout({
      workspaceName: args.workspaceName,
      workspaceId: args.workspaceId,
      preheader: `Rollout approved — ${args.promptName} ${args.versionTag}`,
      body,
      reason: "You received this because rollout notifications are enabled for this workspace",
    }),
    text: `Rollout approved — ${args.promptName} ${args.versionTag}\nApproved by ${args.promotedBy}\nOpen: ${args.promptUrl}`,
  };
}
