import type { Route } from "next";
import { APPROVALS, CONNECTIONS, INCIDENTS } from "./fixtures";

/**
 * Fixtures for the shell.
 *
 * The shell is presentation only — it must never fetch. These stand in until
 * P06 generates the full fixture set and the real data layer is wired in
 * behind the same shapes.
 *
 * Numbers come from the real workspace in the screenshots (163 runs, 58/83/22,
 * 6 connections with 3 failed) so the chrome is exercised against realistic
 * magnitudes rather than three tidy rows.
 */

export interface Workspace {
  id: string;
  name: string;
  /**
   * Active member count, or undefined when it has not been read.
   *
   * Optional on purpose: `/api/me` does not carry it, and coercing the absence
   * to 0 rendered "0 members" under a workspace with people in it — a wrong
   * number nobody could tell apart from a right one.
   */
  members?: number;
  environment: EnvironmentId;
}

export type EnvironmentId = "production" | "staging" | "development";

export const WORKSPACES: Workspace[] = [
  { id: "ws_acme", name: "Acme Platform", members: 24, environment: "production" },
  { id: "ws_acme_eu", name: "Acme EU", members: 11, environment: "production" },
  { id: "ws_sandbox", name: "Sandbox", members: 3, environment: "development" },
  { id: "ws_billing", name: "Billing Ops", members: 8, environment: "staging" },
];

export const RECENT_WORKSPACE_IDS = ["ws_billing", "ws_sandbox"];

export interface ShellCounts {
  approvals: number;
  incidents: number;
  connections: number;
}

/**
 * Starting counts, derived from the fixtures rather than chosen.
 *
 * These were hard-coded until Control started deriving the same figures from
 * APPROVALS / INCIDENTS / CONNECTIONS: the sidebar said 7 approvals while the
 * page said 2, about the same workspace, on the same screen. A user who spots
 * that stops trusting both numbers.
 */
export const INITIAL_COUNTS: ShellCounts = {
  approvals: APPROVALS.length,
  incidents: INCIDENTS.filter((i) => i.status !== "resolved").length,
  connections: CONNECTIONS.filter((c) => c.status === "failing").length,
};

export type NotificationKind = "incident" | "approval" | "run" | "connection" | "system";

export interface ShellNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Minutes ago. */
  age: number;
  read: boolean;
  href: Route;
}

export const NOTIFICATIONS: ShellNotification[] = [
  {
    id: "n_1", kind: "connection", read: false, age: 4,
    title: "Postgres Answers is failing",
    body: "Connection refused. 3 workflows and 7 tools are blocked.",
    href: "/connections" as Route,
  },
  {
    id: "n_2", kind: "incident", read: false, age: 12,
    title: "New incident: tool timeout",
    body: "41 runs share this signature in the last hour.",
    href: "/incidents" as Route,
  },
  {
    id: "n_3", kind: "approval", read: false, age: 26,
    title: "Refund over £500 needs approval",
    body: "SLA expires in 34 minutes.",
    href: "/approvals" as Route,
  },
  {
    id: "n_4", kind: "run", read: true, age: 58,
    title: "renewals-daily finished",
    body: "58 of 58 nodes committed.",
    href: "/runs" as Route,
  },
  {
    id: "n_5", kind: "system", read: true, age: 180,
    title: "Usage at 68% of monthly cap",
    body: "At the current rate you reach the cap in 9 days.",
    href: "/settings/usage" as Route,
  },
];

export const NOTIFICATION_GROUP_LABEL: Record<NotificationKind, string> = {
  incident: "Incidents",
  approval: "Approvals",
  run: "Runs",
  connection: "Connections",
  system: "System",
};

/* ── Command palette corpus ──────────────────────────────────────────────── */

export type PaletteEntityType = "workflow" | "run" | "agent" | "tool" | "connection" | "setting";

export interface PaletteEntity {
  id: string;
  type: PaletteEntityType;
  title: string;
  subtitle?: string;
  href: Route;
}

export const PALETTE_ENTITIES: PaletteEntity[] = [
  { id: "wf_renewals", type: "workflow", title: "renewals-daily", subtitle: "12 nodes · production", href: "/workflows" as Route },
  { id: "wf_dunning", type: "workflow", title: "dunning-escalation", subtitle: "8 nodes · production", href: "/workflows" as Route },
  { id: "wf_onboard", type: "workflow", title: "customer-onboarding", subtitle: "21 nodes · staging", href: "/workflows" as Route },
  { id: "wf_refunds", type: "workflow", title: "refund-approvals", subtitle: "9 nodes · production", href: "/workflows" as Route },

  { id: "run_01JBQZ8XK4", type: "run", title: "run_01JBQZ8XK4", subtitle: "renewals-daily · failed at node 8 of 12", href: "/runs" as Route },
  { id: "run_01JBQZ7AA1", type: "run", title: "run_01JBQZ7AA1", subtitle: "dunning-escalation · succeeded", href: "/runs" as Route },
  { id: "run_01JBQZ6MM2", type: "run", title: "run_01JBQZ6MM2", subtitle: "refund-approvals · awaiting approval", href: "/runs" as Route },

  { id: "agt_triage", type: "agent", title: "Triage agent", subtitle: "claude · 4 tool grants", href: "/agents" as Route },
  { id: "agt_summar", type: "agent", title: "Summariser", subtitle: "gpt-4o-mini · 1 tool grant", href: "/agents" as Route },

  { id: "tool_pg_read", type: "tool", title: "postgres.query", subtitle: "read-only · medium risk", href: "/tools" as Route },
  { id: "tool_slack", type: "tool", title: "slack.postMessage", subtitle: "write · low risk", href: "/tools" as Route },
  { id: "tool_refund", type: "tool", title: "stripe.refund", subtitle: "write · critical risk", href: "/tools" as Route },

  { id: "conn_pg", type: "connection", title: "Postgres Answers", subtitle: "failing · 3 workflows blocked", href: "/connections" as Route },
  { id: "conn_slack", type: "connection", title: "Slack — Acme", subtitle: "healthy", href: "/connections" as Route },

  { id: "set_usage", type: "setting", title: "Usage & limits", subtitle: "Quota, spend, forecasting", href: "/settings/usage" as Route },
  { id: "set_members", type: "setting", title: "Members", subtitle: "Roles and invitations", href: "/settings/members" as Route },
  { id: "set_api", type: "setting", title: "API keys", subtitle: "Create and rotate keys", href: "/api-keys" as Route },
];

export const RECENT_ENTITY_IDS = ["run_01JBQZ8XK4", "wf_renewals", "conn_pg"];
