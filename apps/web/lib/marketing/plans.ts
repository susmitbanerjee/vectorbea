/**
 * The pricing page and the feature matrix, as data.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THIS FILE IS A COPY, AND THE COPY IS PINNED BY A TEST.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The authority on what a plan includes is `plans` and `plan_entitlements` in
 * Postgres, seeded by V060 (and extended by V061 and V062). `EntitlementGuard`
 * and `resolve_entitlements()` read those rows and nothing else, and the signed-
 * in product reads them through `GET /api/entitlements`.
 *
 * The MARKETING pricing page cannot: it is served to people with no workspace
 * and no session, so there is nobody to resolve entitlements for. So the numbers
 * are restated here — and `__tests__/pricing-consistency.test.ts` parses the
 * migration and fails the build when they drift.
 *
 * That test is the whole reason this file is acceptable. Three surfaces
 * describing the same limits — the pricing page, the in-product feature gates,
 * and the docs — is three chances to disagree, and the one that disagrees in
 * public is the one that gets quoted back during a sales call. Making the
 * disagreement a build failure is cheaper than making it a policy.
 *
 * ── WHAT IS DELIBERATELY NOT ON THE PAGE ────────────────────────────────────
 * Everything a buyer cannot act on. `scheduling_priority` is a fair-queue weight
 * and `max_activations_per_workspace` is a concurrency ceiling on a feature most
 * plans do not have; putting either on a pricing page would be true and useless.
 * The rule applied here is: a row earns its place if a buyer would change their
 * choice because of it.
 */

/** Plan codes, in the order they are sold. Matches `plans.sort_order`. */
export const PLAN_CODES = ["free", "pro", "team", "enterprise"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export interface MarketingPlan {
  code: PlanCode;
  name: string;
  /** `plans.description`, verbatim. */
  description: string;
  /** `plans.price_cents`. Null on a custom-priced plan. */
  priceCents: number | null;
  /** How the price is charged, in words a buyer uses. */
  priceNote: string;
  /** The one sentence that says who this is for. */
  audience: string;
  cta: { label: string; href: string };
}

export const PLANS: MarketingPlan[] = [
  {
    code: "free",
    name: "Free",
    description: "One workspace, enough to run something real and see the traces.",
    priceCents: 0,
    priceNote: "No card. One seat.",
    audience: "Trying it on a real workflow before deciding anything.",
    cta: { label: "Start free", href: "/signup" },
  },
  {
    code: "pro",
    name: "Pro",
    description: "A working individual: delegation, replay, MCP tools, the API.",
    priceCents: 4900,
    priceNote: "Per month. Single seat — buy Team for more people.",
    audience: "One engineer running agent workflows in production.",
    cta: { label: "Start free, upgrade later", href: "/signup" },
  },
  {
    code: "team",
    name: "Team",
    description: "Teams of agents and teams of people, with priority scheduling.",
    priceCents: 9900,
    priceNote: "Per seat, per month.",
    audience: "A team sharing workspaces, and the only plan with agent teams.",
    cta: { label: "Start free, upgrade later", href: "/signup" },
  },
  {
    code: "enterprise",
    name: "Enterprise",
    description: "Custom limits, dedicated support, and a contract.",
    priceCents: null,
    priceNote: "Custom.",
    audience: "Longer retention, higher ceilings, and a signed agreement.",
    cta: { label: "Book a demo", href: "/book-demo" },
  },
];

/**
 * One row of the feature matrix.
 *
 * `key` is an `EntitlementKeys` constant, which is what makes the test able to
 * compare this table against the migration at all. A row with a key nobody
 * enforces would be a promise with no mechanism behind it — the test rejects
 * those too.
 */
export interface MatrixRow {
  key: string;
  /** What a buyer calls it. */
  label: string;
  /** One clause on what it actually does. Not marketing copy. */
  note: string;
  kind: "feature" | "limit" | "quota" | "setting";
  /**
   * How the number reads on the page. `days` and `count` are formatted
   * differently and `-1` means unlimited in every one of them.
   */
  unit?: "count" | "days" | "tokens" | "minutes";
  /**
   * Set when the row describes something that is NOT fully shipped, so the page
   * can qualify it rather than sell it. The string is shown to the reader.
   *
   * This is the mechanism that stops the feature matrix from becoming the place
   * flag-off features get sold: a row cannot be added without answering whether
   * it is on.
   */
  caveat?: string;
}

export const MATRIX: MatrixRow[] = [
  { key: "runs_per_month", label: "Runs per month", note: "Across the whole account.", kind: "quota", unit: "count" },
  { key: "runs_per_month_per_workspace", label: "Runs per month, per workspace", note: "So one workspace cannot drain the account's month.", kind: "quota", unit: "count" },
  { key: "tokens_per_month", label: "Tokens per month", note: "Counted, not estimated.", kind: "quota", unit: "tokens" },
  { key: "agent_minutes_per_month", label: "Agent minutes per month", note: "Time an agent spends working. Waiting on an approval is not charged.", kind: "quota", unit: "minutes" },

  { key: "max_workspaces", label: "Workspaces", note: "", kind: "limit", unit: "count" },
  { key: "max_members_per_workspace", label: "Members per workspace", note: "", kind: "limit", unit: "count" },
  { key: "max_concurrent_runs", label: "Concurrent runs", note: "Per workspace.", kind: "limit", unit: "count" },
  { key: "max_agents", label: "Agents", note: "Registered agents per workspace.", kind: "limit", unit: "count" },

  {
    key: "teams",
    label: "Agent teams",
    note: "A roster on the canvas, with per-member delegation grants enforced in the runtime.",
    kind: "feature",
    caveat:
      "Behind a runtime switch (AGENT_TEAMS_ENABLED) that is off by default. "
      + "The canvas shows the node and says so; ask us before you buy Team for this.",
  },
  {
    key: "delegation",
    label: "Delegation between agents",
    note: "An agent may hand work to another on its roster, within a depth limit.",
    kind: "feature",
    caveat:
      "Behind a runtime switch (AGENT_ACTIVATIONS_ENABLED) that is off by default.",
  },
  { key: "max_team_size", label: "Agents in a team", note: "Checked at save, not at run.", kind: "limit", unit: "count" },
  { key: "max_delegation_depth", label: "Levels of delegation", note: "A transfer is a tail call and does not count.", kind: "limit", unit: "count" },

  {
    key: "replay",
    label: "Replay a run",
    note: "Re-executes from the recording. No provider calls, no cost, no side effects.",
    kind: "feature",
  },
  { key: "mcp_tools", label: "MCP tools", note: "Tools discovered from an MCP server.", kind: "feature" },
  { key: "api_access", label: "API access", note: "API keys, scoped to a workspace.", kind: "feature" },
  { key: "max_api_keys", label: "API keys", note: "Live keys per workspace.", kind: "limit", unit: "count" },
  {
    key: "otel_export",
    label: "OpenTelemetry export",
    note: "Spans pushed to your own collector.",
    kind: "feature",
    caveat:
      "Behind a runtime switch (OTEL_TRACE_EXPORT_ENABLED) that is off by default. "
      + "Traces are recorded and visible in the product either way — this row is only about the export.",
  },

  { key: "retention_days_runs", label: "Run history", note: "After this, the rows are DELETED, not hidden.", kind: "limit", unit: "days" },
  { key: "retention_days_events", label: "Event history", note: "The timeline a run is debugged from.", kind: "limit", unit: "days" },
  { key: "retention_days_traces", label: "Trace history", note: "Spans, which are larger and kept for less time.", kind: "limit", unit: "days" },
  { key: "retention_days_payloads", label: "Payload history", note: "Request and response bodies. The most expensive to keep.", kind: "limit", unit: "days" },

  { key: "support_tier", label: "Support", note: "", kind: "setting" },
];

/**
 * The grid. Values are the migration's, restated — see the header.
 *
 * `-1` is the catalogue's unlimited, and zero is a real zero. Collapsing the two
 * on a pricing page is how a plan that grants nothing gets advertised as
 * granting everything.
 */
export const MATRIX_VALUES: Record<string, Record<PlanCode, number | boolean | string>> = {
  runs_per_month: { free: 500, pro: 10_000, team: 50_000, enterprise: -1 },
  runs_per_month_per_workspace: { free: 500, pro: 5_000, team: 20_000, enterprise: -1 },
  tokens_per_month: { free: 1_000_000, pro: 50_000_000, team: 250_000_000, enterprise: -1 },
  agent_minutes_per_month: { free: 60, pro: 1_500, team: 10_000, enterprise: -1 },

  max_workspaces: { free: 1, pro: 3, team: 10, enterprise: -1 },
  max_members_per_workspace: { free: 3, pro: 5, team: 25, enterprise: -1 },
  max_concurrent_runs: { free: 2, pro: 5, team: 15, enterprise: 50 },
  max_agents: { free: 3, pro: 25, team: 100, enterprise: -1 },

  teams: { free: false, pro: false, team: true, enterprise: true },
  delegation: { free: false, pro: true, team: true, enterprise: true },
  max_team_size: { free: 0, pro: 3, team: 8, enterprise: 25 },
  max_delegation_depth: { free: 0, pro: 1, team: 3, enterprise: 5 },

  replay: { free: false, pro: true, team: true, enterprise: true },
  mcp_tools: { free: false, pro: true, team: true, enterprise: true },
  api_access: { free: false, pro: true, team: true, enterprise: true },
  max_api_keys: { free: 0, pro: 5, team: 25, enterprise: -1 },
  otel_export: { free: false, pro: false, team: true, enterprise: true },

  retention_days_runs: { free: 7, pro: 30, team: 90, enterprise: 365 },
  retention_days_events: { free: 7, pro: 30, team: 90, enterprise: 365 },
  retention_days_traces: { free: 3, pro: 14, team: 45, enterprise: 180 },
  retention_days_payloads: { free: 7, pro: 14, team: 30, enterprise: 90 },

  support_tier: { free: "community", pro: "email", team: "priority", enterprise: "dedicated" },
};

/** How a matrix cell reads. `-1` is unlimited everywhere it appears. */
export function formatValue(row: MatrixRow, value: number | boolean | string): string {
  if (typeof value === "boolean") return value ? "Included" : "—";
  if (typeof value === "string") return value.charAt(0).toUpperCase() + value.slice(1);
  if (value === -1) return "Unlimited";
  switch (row.unit) {
    case "days": return value === 1 ? "1 day" : `${value} days`;
    case "tokens": return value >= 1_000_000 ? `${value / 1_000_000}M` : value.toLocaleString("en-US");
    case "minutes": return `${value.toLocaleString("en-US")} min`;
    default: return value === 0 ? "—" : value.toLocaleString("en-US");
  }
}

export function priceLabel(plan: MarketingPlan): string {
  if (plan.priceCents === null) return "Custom";
  if (plan.priceCents === 0) return "$0";
  return `$${plan.priceCents / 100}`;
}
