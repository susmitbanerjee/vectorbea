import { RUNS, WORKFLOWS, CONNECTIONS, RUN_COUNTS } from "./fixtures";
import { AGENT_RECORDS } from "./registry";
import { POLICY, runsToday } from "./control";
import type { Environment } from "./domain";

/* ══════════════════════════════════════════════════════════════════════════════
   GOVERN — usage, members, audit and settings.

   THE FORECAST IS THE POINT OF THE USAGE PAGE. A limits page that only reports
   current state makes people discover their limits by hitting them, which is
   the worst possible moment: mid-run, in production, with no warning. "At the
   current rate you reach the daily cap in 6 hours" is the same data arranged so
   somebody can act on it a day early.

   THE RBAC MATRIX IS THE POINT OF MEMBERS. "Your role: Viewer" beside a row
   saying Owner is not a display bug to patch — it is what happens when role is
   derived in two places. One source of truth, and an explicit grid so a customer
   can read what each role can actually do rather than infer it.
══════════════════════════════════════════════════════════════════════════════ */

const NOW = new Date("2026-08-11T14:20:00Z").getTime();
const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 86_400_000;

/* ── Usage ────────────────────────────────────────────────────────────────── */

export interface LimitTile {
  id: string;
  label: string;
  help: string;
  current: number;
  max: number;
  unit: string;
  /** What lifting it requires. */
  upgrade: string;
}

export const USAGE_TODAY = runsToday();

/** Midnight UTC, when the daily counters reset. */
export const RESETS_AT = iso(new Date(NOW).setUTCHours(24, 0, 0, 0));

export const LIMITS: LimitTile[] = [
  {
    id: "runs-day", label: "Runs today", help: "Every execution, including retries and backfills.",
    current: USAGE_TODAY, max: POLICY.dailyRunLimit, unit: "runs",
    upgrade: "Team raises this to 2,000 a day.",
  },
  {
    id: "runs-month", label: "Runs this month", help: "Counted on the calendar month, not a rolling window.",
    current: RUN_COUNTS.total * 4, max: 3_000, unit: "runs",
    upgrade: "Team raises this to 60,000 a month.",
  },
  {
    id: "workflows", label: "Workflows", help: "Drafts and archived workflows count; deleted ones do not.",
    current: WORKFLOWS.length, max: 25, unit: "workflows",
    upgrade: "Team removes the cap entirely.",
  },
  {
    id: "agents", label: "Registered agents", help: "Agents in the registry, whether or not a workflow binds them.",
    current: AGENT_RECORDS.length, max: 25, unit: "agents",
    upgrade: "Team raises this to 200.",
  },
  {
    id: "connections", label: "Connections", help: "One per set of credentials.",
    current: CONNECTIONS.length, max: 10, unit: "connections",
    upgrade: "Team raises this to 50.",
  },
  {
    id: "spend", label: "Spend this month", help: "Model and tool spend billed to the workspace, excluding bring-your-own keys.",
    current: Number((POLICY.dailyBudgetUsd * 11.4).toFixed(2)), max: POLICY.dailyBudgetUsd * 30, unit: "USD",
    upgrade: "Raise the monthly budget in Billing.",
  },
];

export interface Forecast {
  id: string;
  /** The sentence shown. Written as a prediction, not a status. */
  sentence: string;
  detail: string;
  severity: "critical" | "warning" | "ok";
  /** When the limit is reached. Null when it will not be inside the period. */
  at: string | null;
  limitId: string;
}

/**
 * When each limit will be reached at the current rate.
 *
 * Rate is measured over the hours already elapsed today rather than assumed —
 * a forecast built on a flat daily average says nothing useful at 09:00, when
 * the whole point is that the morning batch has already used a third of the
 * allowance.
 */
export function forecasts(): Forecast[] {
  const startOfDay = new Date(NOW).setUTCHours(0, 0, 0, 0);
  const hoursElapsed = Math.max(0.5, (NOW - startOfDay) / 3_600_000);
  const hoursLeft = 24 - hoursElapsed;
  const perHour = USAGE_TODAY / hoursElapsed;

  const out: Forecast[] = [];

  /* Daily runs. */
  const dailyRemaining = POLICY.dailyRunLimit - USAGE_TODAY;
  if (perHour > 0) {
    const hoursToCap = dailyRemaining / perHour;
    if (hoursToCap <= hoursLeft) {
      out.push({
        id: "f-daily",
        sentence: `At the current rate you reach the daily run cap in ${formatHours(hoursToCap)}.`,
        detail: `${USAGE_TODAY} of ${POLICY.dailyRunLimit} used in the first ${formatHours(hoursElapsed)}, which is ${perHour.toFixed(1)} runs an hour. Runs past the cap are rejected rather than queued, so a schedule firing after it is a missed window, not a delayed one.`,
        severity: hoursToCap < 4 ? "critical" : "warning",
        at: iso(NOW + hoursToCap * 3_600_000),
        limitId: "runs-day",
      });
    } else {
      out.push({
        id: "f-daily",
        sentence: `You will finish the day at about ${Math.round(USAGE_TODAY + perHour * hoursLeft)} of ${POLICY.dailyRunLimit} runs.`,
        detail: `Running at ${perHour.toFixed(1)} an hour with ${formatHours(hoursLeft)} left. Comfortably inside the cap.`,
        severity: "ok",
        at: null,
        limitId: "runs-day",
      });
    }
  }

  /* Monthly runs — projected from the day of the month. */
  const day = new Date(NOW).getUTCDate();
  const daysInMonth = 31;
  const monthly = LIMITS.find((l) => l.id === "runs-month")!;
  const perDay = monthly.current / day;
  const dayOfExceed = Math.ceil(monthly.max / perDay);

  if (dayOfExceed <= daysInMonth) {
    out.push({
      id: "f-monthly",
      sentence: `You will exceed the monthly run allowance on the ${ordinal(dayOfExceed)}.`,
      detail: `${monthly.current.toLocaleString("en-GB")} of ${monthly.max.toLocaleString("en-GB")} used across ${day} days, which is ${Math.round(perDay)} a day. The allowance resets on the 1st.`,
      severity: dayOfExceed - day <= 5 ? "critical" : "warning",
      at: iso(new Date(NOW).setUTCDate(dayOfExceed)),
      limitId: "runs-month",
    });
  }

  /* Spend. */
  const spend = LIMITS.find((l) => l.id === "spend")!;
  const spendPerDay = spend.current / day;
  const spendDay = Math.ceil(spend.max / spendPerDay);
  if (spendDay <= daysInMonth) {
    out.push({
      id: "f-spend",
      sentence: `Spend reaches the monthly budget on the ${ordinal(spendDay)}.`,
      detail: `$${spend.current.toFixed(2)} of $${spend.max.toFixed(2)} across ${day} days. Work does not stop at the budget — it is a reporting threshold, not a hard cap.`,
      severity: spendDay - day <= 5 ? "warning" : "ok",
      at: iso(new Date(NOW).setUTCDate(spendDay)),
      limitId: "spend",
    });
  }

  return out;
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} minutes`;
  if (hours < 24) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}

function ordinal(n: number): string {
  const suffix = n % 10 === 1 && n % 100 !== 11 ? "st"
    : n % 10 === 2 && n % 100 !== 12 ? "nd"
      : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th";
  return `${n}${suffix}`;
}

export interface UsagePoint {
  t: number;
  runs: number;
  tokens: number;
  costUsd: number;
  storageMb: number;
}

/** 30 days of usage, for the historical chart with the limit line overlaid. */
export const USAGE_HISTORY: UsagePoint[] = Array.from({ length: 30 }, (_, i) => {
  const t = NOW - (29 - i) * DAY;
  const weekday = new Date(t).getUTCDay();
  // Weekends are quieter, which is what makes a limit line worth drawing —
  // a flat series never crosses it.
  const weight = weekday === 0 || weekday === 6 ? 0.35 : 1;
  const growth = 1 + i * 0.028;
  const runs = Math.round(60 * weight * growth);
  return {
    t,
    runs,
    tokens: runs * 1_180,
    costUsd: Number((runs * 0.0031).toFixed(4)),
    storageMb: Math.round(240 + i * 7.5),
  };
});

export interface CostAttribution {
  id: string;
  name: string;
  kind: "workflow" | "agent";
  costUsd: number;
  runs: number;
  share: number;
}

/** Which workflow, and which agent, is spending the money. */
export function costAttribution(): { workflows: CostAttribution[]; agents: CostAttribution[] } {
  const workflows = WORKFLOWS.map((w) => ({
    id: w.id,
    name: w.name,
    kind: "workflow" as const,
    costUsd: w.spend30dUsd,
    runs: RUNS.filter((r) => r.workflowId === w.id).length,
    share: 0,
  })).sort((a, b) => b.costUsd - a.costUsd);

  const workflowTotal = workflows.reduce((s, w) => s + w.costUsd, 0) || 1;
  for (const w of workflows) w.share = Math.round((w.costUsd / workflowTotal) * 100);

  const agents = AGENT_RECORDS.map((a) => ({
    id: a.id,
    name: a.name,
    kind: "agent" as const,
    costUsd: Number((a.avgCostUsd * a.runs30d).toFixed(4)),
    runs: a.runs30d,
    share: 0,
  })).sort((a, b) => b.costUsd - a.costUsd);

  const agentTotal = agents.reduce((s, a) => s + a.costUsd, 0) || 1;
  for (const a of agents) a.share = Math.round((a.costUsd / agentTotal) * 100);

  return { workflows: workflows.slice(0, 8), agents: agents.slice(0, 8) };
}

/* ── Tiers ────────────────────────────────────────────────────────────────── */

export const TIERS = ["Free", "Team", "Business", "Enterprise"] as const;
export type Tier = (typeof TIERS)[number];

export const CURRENT_TIER: Tier = "Free";

export interface FeatureRow {
  feature: string;
  help: string;
  values: Record<Tier, string>;
}

export const FEATURE_MATRIX: FeatureRow[] = [
  { feature: "Runs per day", help: "Hard cap. Runs past it are rejected.", values: { Free: "100", Team: "2,000", Business: "20,000", Enterprise: "Unlimited" } },
  { feature: "Workflows", help: "Drafts and archived count.", values: { Free: "25", Team: "Unlimited", Business: "Unlimited", Enterprise: "Unlimited" } },
  { feature: "Members", help: "Seats with access to the workspace.", values: { Free: "3", Team: "25", Business: "Unlimited", Enterprise: "Unlimited" } },
  { feature: "Environments", help: "Production, staging and development are separate workspaces for connections and policy.", values: { Free: "2", Team: "3", Business: "Unlimited", Enterprise: "Unlimited" } },
  { feature: "AI Architect builds", help: "Generated workflows. Building by hand is never limited.", values: { Free: "1 / 30 days", Team: "20 / month", Business: "Unlimited", Enterprise: "Unlimited" } },
  { feature: "Audit log retention", help: "How far back the audit trail is queryable.", values: { Free: "7 days", Team: "90 days", Business: "1 year", Enterprise: "7 years" } },
  { feature: "SSO / SAML", help: "Single sign-on with your identity provider.", values: { Free: "—", Team: "—", Business: "Yes", Enterprise: "Yes" } },
  { feature: "IP allowlist", help: "Restrict API and console access by source address.", values: { Free: "—", Team: "—", Business: "Yes", Enterprise: "Yes" } },
  { feature: "Private runners", help: "Reach systems inside your own network.", values: { Free: "—", Team: "—", Business: "Yes", Enterprise: "Yes" } },
  { feature: "Support", help: "", values: { Free: "Community", Team: "Email", Business: "Priority", Enterprise: "Dedicated" } },
];

/* ── Members and RBAC ─────────────────────────────────────────────────────── */

export const ROLES = ["Owner", "Admin", "Developer", "Operator", "Viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_HELP: Record<Role, string> = {
  Owner: "Everything, including billing and deleting the workspace. There is always exactly one.",
  Admin: "Everything except billing and workspace deletion.",
  Developer: "Builds and publishes workflows. Cannot change members or settings.",
  Operator: "Runs, retries and approves. Cannot change what a workflow does.",
  Viewer: "Reads everything. Changes nothing.",
};

export interface Permission {
  id: string;
  label: string;
  help: string;
  category: "workflows" | "operations" | "governance" | "workspace";
  /** Which roles hold it. */
  roles: Role[];
}

/**
 * The explicit grid. This is what a customer asks for on the first call, and
 * what the product has never been able to show.
 */
export const PERMISSIONS: Permission[] = [
  { id: "wf-view", label: "View workflows", help: "Read definitions, versions and graphs.", category: "workflows", roles: ["Owner", "Admin", "Developer", "Operator", "Viewer"] },
  { id: "wf-edit", label: "Edit workflows", help: "Change the graph and node configuration.", category: "workflows", roles: ["Owner", "Admin", "Developer"] },
  { id: "wf-publish", label: "Publish versions", help: "Make a draft live. This starts real work.", category: "workflows", roles: ["Owner", "Admin", "Developer"] },
  { id: "wf-delete", label: "Delete workflows", help: "Destroys the definition and its run history.", category: "workflows", roles: ["Owner", "Admin"] },
  { id: "run-view", label: "View runs", help: "Read run history, logs and traces.", category: "operations", roles: ["Owner", "Admin", "Developer", "Operator", "Viewer"] },
  { id: "run-start", label: "Start and retry runs", help: "Trigger a run by hand or resume a failed one.", category: "operations", roles: ["Owner", "Admin", "Developer", "Operator"] },
  { id: "run-cancel", label: "Cancel runs", help: "Stop a run at its current node.", category: "operations", roles: ["Owner", "Admin", "Developer", "Operator"] },
  { id: "approve", label: "Decide approvals", help: "Approve or reject a gated step.", category: "operations", roles: ["Owner", "Admin", "Operator"] },
  { id: "conn-view", label: "View connections", help: "See names, health and blast radius. Never secrets.", category: "governance", roles: ["Owner", "Admin", "Developer", "Operator", "Viewer"] },
  { id: "conn-edit", label: "Manage connections", help: "Create, rotate and delete credentials.", category: "governance", roles: ["Owner", "Admin"] },
  { id: "audit-view", label: "Read the audit log", help: "Query the full trail.", category: "governance", roles: ["Owner", "Admin"] },
  { id: "policy-edit", label: "Change risk policy", help: "Alter what a risk tier requires.", category: "governance", roles: ["Owner", "Admin"] },
  { id: "member-manage", label: "Manage members", help: "Invite, remove and change roles.", category: "workspace", roles: ["Owner", "Admin"] },
  { id: "settings-edit", label: "Change settings", help: "Workspace, environments and security.", category: "workspace", roles: ["Owner", "Admin"] },
  { id: "billing", label: "Manage billing", help: "Plan, payment method and invoices.", category: "workspace", roles: ["Owner"] },
  { id: "workspace-delete", label: "Delete the workspace", help: "Irreversible.", category: "workspace", roles: ["Owner"] },
];

export function roleHas(role: Role, permissionId: string): boolean {
  return PERMISSIONS.find((p) => p.id === permissionId)?.roles.includes(role) ?? false;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: "active" | "invited" | "suspended";
  lastActiveAt: string | null;
  workflowsOwned: number;
  twoFactor: boolean;
  environments: Environment[] | null;
}

const OWNERS = ["platform-ops", "billing", "growth", "support-eng"];

export const MEMBERS: Member[] = [
  { id: "m1", name: "Priya Raman", email: "priya.raman@acme.example", role: "Owner", status: "active", lastActiveAt: iso(NOW - 12 * 60_000), workflowsOwned: WORKFLOWS.filter((w) => w.owner === OWNERS[0]).length, twoFactor: true, environments: null },
  { id: "m2", name: "Daniel Okafor", email: "d.okafor@acme.example", role: "Admin", status: "active", lastActiveAt: iso(NOW - 3 * 3600_000), workflowsOwned: WORKFLOWS.filter((w) => w.owner === OWNERS[1]).length, twoFactor: true, environments: null },
  { id: "m3", name: "Maja Lindqvist", email: "m.lindqvist@acme.example", role: "Developer", status: "active", lastActiveAt: iso(NOW - 40 * 60_000), workflowsOwned: WORKFLOWS.filter((w) => w.owner === OWNERS[2]).length, twoFactor: false, environments: ["staging", "development"] },
  { id: "m4", name: "Sana Aggarwal", email: "s.aggarwal@acme.example", role: "Operator", status: "active", lastActiveAt: iso(NOW - 26 * 3600_000), workflowsOwned: 0, twoFactor: true, environments: ["production"] },
  { id: "m5", name: "Tom Ryan", email: "tom.ryan@acme.example", role: "Developer", status: "suspended", lastActiveAt: iso(NOW - 34 * DAY), workflowsOwned: WORKFLOWS.filter((w) => w.owner === OWNERS[3]).length, twoFactor: false, environments: null },
  { id: "m6", name: "Ava Bennett", email: "ava.bennett@acme.example", role: "Viewer", status: "active", lastActiveAt: iso(NOW - 6 * DAY), workflowsOwned: 0, twoFactor: true, environments: null },
];

/**
 * The signed-in user, resolved once.
 *
 * The current product shows "Your role: Viewer" beside a row saying Owner
 * because the two are derived separately. Everything that needs the viewer's
 * role reads this.
 */
export const CURRENT_MEMBER_ID = "m1";
export const currentMember = () => MEMBERS.find((m) => m.id === CURRENT_MEMBER_ID)!;

export interface Invite {
  id: string;
  email: string;
  role: Role;
  environments: Environment[] | null;
  invitedBy: string;
  invitedAt: string;
  expiresAt: string;
}

export const INVITES: Invite[] = [
  { id: "i1", email: "new.engineer@acme.example", role: "Developer", environments: ["staging"], invitedBy: "Priya Raman", invitedAt: iso(NOW - 2 * DAY), expiresAt: iso(NOW + 5 * DAY) },
  { id: "i2", email: "contractor@partner.example", role: "Viewer", environments: null, invitedBy: "Daniel Okafor", invitedAt: iso(NOW - 9 * DAY), expiresAt: iso(NOW - 2 * DAY) },
];

/* ── Audit log ────────────────────────────────────────────────────────────── */

export type AuditCategory =
  | "auth" | "workflow" | "publish" | "approval" | "connection" | "member" | "settings" | "destructive";

export const AUDIT_CATEGORY_LABEL: Record<AuditCategory, string> = {
  auth: "Authentication",
  workflow: "Workflow changes",
  publish: "Publishes",
  approval: "Approvals",
  connection: "Connection changes",
  member: "Member changes",
  settings: "Settings changes",
  destructive: "Destructive actions",
};

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  actorType: "user" | "system";
  category: AuditCategory;
  action: string;
  target: string;
  targetHref: string | null;
  environment: Environment | null;
  ip: string;
  result: "success" | "failure" | "denied";
  /** Present on configuration changes. */
  diff: { field: string; before: string; after: string }[] | null;
}

export const AUDIT_RETENTION_DAYS = 7;

const ACTORS = [
  { name: "priya.raman", type: "user" as const, ip: "82.15.44.19" },
  { name: "d.okafor", type: "user" as const, ip: "51.140.22.8" },
  { name: "m.lindqvist", type: "user" as const, ip: "185.62.11.4" },
  { name: "s.aggarwal", type: "user" as const, ip: "82.15.44.201" },
  { name: "system", type: "system" as const, ip: "10.0.4.11" },
];

/**
 * The trail, newest first.
 *
 * Authored rather than generated because an audit log's value is that each line
 * is a real, specific thing somebody did — a sequence of plausible-looking
 * randomness is exactly what an enterprise reviewer notices.
 */
export const AUDIT_EVENTS: AuditEvent[] = [
  {
    id: "a1", at: iso(NOW - 31 * 3600_000), actor: "priya.raman", actorType: "user",
    category: "publish", action: "Published version 6", target: "renewals-daily",
    targetHref: "/workflows", environment: "production", ip: ACTORS[0].ip, result: "success",
    diff: [
      { field: "nodes.n-renewals.timeoutMs", before: "30000", after: "90000" },
      { field: "nodes.n-renewals.retry.attempts", before: "3", after: "1" },
      { field: "nodes.n-renewals.retry.maxDelayMs", before: "8000", after: "2000" },
    ],
  },
  {
    id: "a2", at: iso(NOW - 90 * 60_000), actor: "system", actorType: "system",
    category: "connection", action: "Marked connection failing after 3 failed health checks",
    target: "Postgres Answers", targetHref: "/connections", environment: "production",
    ip: ACTORS[4].ip, result: "success",
    diff: [{ field: "status", before: "healthy", after: "failing" }],
  },
  {
    id: "a3", at: iso(NOW - 34 * 60_000), actor: "s.aggarwal", actorType: "user",
    category: "approval", action: "Approved a gated step", target: "refund-approvals · Await approval",
    targetHref: "/approvals", environment: "production", ip: ACTORS[3].ip, result: "success", diff: null,
  },
  {
    id: "a4", at: iso(NOW - 2.5 * 3600_000), actor: "m.lindqvist", actorType: "user",
    category: "workflow", action: "Edited a node's retry policy", target: "support-triage · Classify intent",
    targetHref: "/workflows", environment: "staging", ip: ACTORS[2].ip, result: "success",
    diff: [
      { field: "retry.backoff", before: "exponential", after: "exponential-jitter" },
      { field: "retry.attempts", before: "2", after: "4" },
    ],
  },
  {
    id: "a5", at: iso(NOW - 5 * 3600_000), actor: "d.okafor", actorType: "user",
    category: "connection", action: "Rotated credentials", target: "Stripe — Live",
    targetHref: "/connections", environment: "production", ip: ACTORS[1].ip, result: "success",
    diff: [{ field: "secret", before: "••••••••", after: "••••••••" }],
  },
  {
    id: "a6", at: iso(NOW - 7 * 3600_000), actor: "contractor@partner.example", actorType: "user",
    category: "auth", action: "Sign-in refused — email domain not allowed", target: "partner.example",
    targetHref: null, environment: null, ip: "203.0.113.44", result: "denied", diff: null,
  },
  {
    id: "a7", at: iso(NOW - 9 * 3600_000), actor: "priya.raman", actorType: "user",
    category: "member", action: "Invited a member as Developer", target: "new.engineer@acme.example",
    targetHref: "/members", environment: null, ip: ACTORS[0].ip, result: "success",
    diff: [{ field: "role", before: "—", after: "Developer" }],
  },
  {
    id: "a8", at: iso(NOW - 26 * 3600_000), actor: "d.okafor", actorType: "user",
    category: "settings", action: "Changed the risk policy for a tool", target: "sendgrid.send",
    targetHref: "/tools", environment: null, ip: ACTORS[1].ip, result: "success",
    diff: [{ field: "policy.requiresApprovalGate", before: "true", after: "false" }],
  },
  {
    id: "a9", at: iso(NOW - 30 * 3600_000), actor: "m.lindqvist", actorType: "user",
    category: "destructive", action: "Deleted a workflow", target: "legacy-invoice-export",
    targetHref: null, environment: "development", ip: ACTORS[2].ip, result: "success",
    diff: [{ field: "runs deleted", before: "84", after: "0" }],
  },
  {
    id: "a10", at: iso(NOW - 33 * 3600_000), actor: "s.aggarwal", actorType: "user",
    category: "workflow", action: "Attempted to publish without permission", target: "usage-rollup",
    targetHref: "/workflows", environment: "production", ip: ACTORS[3].ip, result: "denied", diff: null,
  },
  {
    id: "a11", at: iso(NOW - 40 * 3600_000), actor: "priya.raman", actorType: "user",
    category: "settings", action: "Changed the session policy", target: "Workspace security",
    targetHref: "/settings", environment: null, ip: ACTORS[0].ip, result: "success",
    diff: [{ field: "sessionHours", before: "720", after: "168" }],
  },
  {
    id: "a12", at: iso(NOW - 52 * 3600_000), actor: "system", actorType: "system",
    category: "publish", action: "Publish rolled back — approval group missing", target: "contract-sync",
    targetHref: "/workflows", environment: "staging", ip: ACTORS[4].ip, result: "failure", diff: null,
  },
];

/* ── Settings ─────────────────────────────────────────────────────────────── */

export interface EnvironmentSettings {
  id: Environment;
  label: string;
  defaultConnections: string[];
  approvalPolicy: string;
  /** What must be true before a version may be promoted INTO this environment. */
  promotionRules: string[];
}

export const ENVIRONMENT_SETTINGS: EnvironmentSettings[] = [
  {
    id: "development", label: "Development",
    defaultConnections: ["Postgres Answers", "Slack — Acme"],
    approvalPolicy: "None — gates are skipped in development.",
    promotionRules: ["Anyone with Developer may publish here."],
  },
  {
    id: "staging", label: "Staging",
    defaultConnections: ["Postgres Answers", "Slack — Acme", "HubSpot CRM"],
    approvalPolicy: "Critical-risk tools require an approval gate.",
    promotionRules: ["Validation must pass with no errors.", "A simulation must have been run against the version."],
  },
  {
    id: "production", label: "Production",
    defaultConnections: ["Postgres Answers", "Stripe — Live", "Slack — Acme", "Gmail — ops@"],
    approvalPolicy: "High and critical-risk tools require an approval gate.",
    promotionRules: [
      "The version must have run in staging at least once.",
      "Validation must pass with no errors.",
      "An Admin or Owner must publish.",
    ],
  },
];

export interface ApiKey {
  id: string;
  name: string;
  last4: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

export const API_KEYS: ApiKey[] = [
  { id: "k1", name: "CI pipeline", last4: "4f2a", scopes: ["runs:write", "workflows:read"], createdAt: iso(NOW - 120 * DAY), lastUsedAt: iso(NOW - 40 * 60_000) },
  { id: "k2", name: "Ops dashboard", last4: "9c31", scopes: ["runs:read", "workflows:read"], createdAt: iso(NOW - 300 * DAY), lastUsedAt: iso(NOW - 3 * 3600_000) },
  { id: "k3", name: "Old integration", last4: "1b88", scopes: ["runs:write"], createdAt: iso(NOW - 420 * DAY), lastUsedAt: null },
];

export interface NotificationRule {
  id: string;
  event: string;
  help: string;
  severity: "all" | "high" | "critical";
  channels: ("email" | "slack" | "webhook")[];
}

export const NOTIFICATION_RULES: NotificationRule[] = [
  { id: "n1", event: "Run failed", help: "Any run that ends in a failed state.", severity: "high", channels: ["slack"] },
  { id: "n2", event: "Approval waiting", help: "A gate has been waiting longer than half its SLA.", severity: "all", channels: ["email", "slack"] },
  { id: "n3", event: "Approval breached SLA", help: "A gate passed its SLA with no decision.", severity: "critical", channels: ["email", "slack", "webhook"] },
  { id: "n4", event: "Connection unhealthy", help: "A health check failed three times.", severity: "critical", channels: ["slack", "webhook"] },
  { id: "n5", event: "Incident opened", help: "Failures clustered into a new incident.", severity: "high", channels: ["slack"] },
  { id: "n6", event: "Quota threshold", help: "A limit reached 80% of its cap.", severity: "high", channels: ["email"] },
  { id: "n7", event: "Credential expiring", help: "An OAuth token expires within 14 days.", severity: "all", channels: ["email"] },
];

/** Exact counts for the reset confirmation — §12's example, made real. */
export function workspaceContents() {
  return {
    runs: RUNS.length,
    workflows: WORKFLOWS.length,
    agents: AGENT_RECORDS.length,
    connections: CONNECTIONS.length,
    members: MEMBERS.length,
  };
}
