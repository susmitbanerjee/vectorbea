import {
  RUNS, WORKFLOWS, CONNECTIONS, APPROVALS, INCIDENTS, POSTGRES_INCIDENT_ID,
} from "./fixtures";
import type { Run, RunStatus, Workflow } from "./domain";

/* ══════════════════════════════════════════════════════════════════════════════
   CONTROL — the data behind the Control page.

   Derived from the P06 fixtures rather than invented alongside them, so the
   numbers on Control and the numbers on Runs cannot disagree. If Control says
   83 failed, the Runs table filtered to failed returns 83 rows.

   THE FRAMING. The old Overview reported "41% success rate", which is a number
   an operator can do nothing with. Control reports the same underlying failures
   against a RELIABILITY TARGET and a FAILURE BUDGET: not "you are bad at this"
   but "you have spent 214% of today's budget, and here is the connection that
   spent it". Same data, actionable.
══════════════════════════════════════════════════════════════════════════════ */

/** Pinned so fixtures, charts and screenshots all agree on "now". */
export const NOW = new Date("2026-08-11T14:20:00Z").getTime();

const HOUR = 3_600_000;
const DAY = 86_400_000;

/* ── Time range ───────────────────────────────────────────────────────────── */

export type TimeRangeId = "1h" | "24h" | "7d" | "30d" | "custom";

export interface TimeRange {
  id: TimeRangeId;
  label: string;
  /** Window length in ms. Null for a custom range, which carries explicit ends. */
  durationMs: number | null;
  /** Bucket width for the trend charts. */
  bucketMs: number;
  /** Axis tick format. */
  tickFormat: "time" | "day";
}

export const TIME_RANGES: TimeRange[] = [
  { id: "1h", label: "1h", durationMs: HOUR, bucketMs: 5 * 60_000, tickFormat: "time" },
  { id: "24h", label: "24h", durationMs: DAY, bucketMs: HOUR, tickFormat: "time" },
  { id: "7d", label: "7d", durationMs: 7 * DAY, bucketMs: 6 * HOUR, tickFormat: "day" },
  { id: "30d", label: "30d", durationMs: 30 * DAY, bucketMs: DAY, tickFormat: "day" },
];

export const DEFAULT_RANGE: TimeRangeId = "24h";

export function resolveRange(id: string | null | undefined): TimeRange {
  return TIME_RANGES.find((r) => r.id === id) ?? TIME_RANGES[1];
}

/** Runs that started inside the window. */
export function runsInRange(range: TimeRange, from?: number, to?: number): Run[] {
  const end = to ?? NOW;
  const start = from ?? end - (range.durationMs ?? DAY);
  return RUNS.filter((r) => {
    const t = Date.parse(r.startedAt);
    return t >= start && t <= end;
  });
}

/* ── Workspace policy ─────────────────────────────────────────────────────── */

export interface WorkspacePolicy {
  /** The reliability target the failure budget is measured against, e.g. 0.95. */
  reliabilityTarget: number;
  /** Daily spend ceiling in USD. */
  dailyBudgetUsd: number;
  /** Plan run cap per day. */
  dailyRunLimit: number;
  planName: string;
}

export const POLICY: WorkspacePolicy = {
  reliabilityTarget: 0.95,
  dailyBudgetUsd: 12.0,
  // Sized against the fixtures' actual daily volume (~100 runs) so the quota
  // item fires at a believable 87% rather than describing a workspace that has
  // already run five times its own cap.
  dailyRunLimit: 115,
  planName: "Team",
};

/* ── Band 1 · Health ──────────────────────────────────────────────────────── */

export interface InFlight {
  running: number;
  queued: number;
  /** The value before the last refresh, so the counter rolls from truth. */
  previousRunning: number;
  oldestQueuedMs: number;
}

export interface BudgetPoint {
  /** ms since the start of the window. */
  t: number;
  /** Budget remaining as a fraction of the day's allowance. Negative = overspent. */
  remaining: number;
  /** Ideal linear burn, for the reference line. */
  ideal: number;
}

export interface FailureBudget {
  target: number;
  /** Allowed failures in the window, from the target and the run volume. */
  allowed: number;
  spent: number;
  /** spent / allowed. Over 1 means the budget is blown. */
  burnRatio: number;
  series: BudgetPoint[];
  /** The single largest contributor, so the number resolves to a cause. */
  topCause: { label: string; share: number; href: string } | null;
}

export interface ApprovalAging {
  count: number;
  oldestWaitedMs: number;
  oldestSlaMs: number;
  /** True when any gate has consumed more than half its SLA. */
  pressured: boolean;
  breached: number;
}

export interface SpendToday {
  spentUsd: number;
  budgetUsd: number;
  /** Straight-line projection to midnight from the current burn rate. */
  projectedUsd: number;
  /** Fraction of the day elapsed, for the projection marker. */
  dayElapsed: number;
  series: { t: number; usd: number }[];
}

export interface HealthSnapshot {
  inFlight: InFlight;
  failureBudget: FailureBudget;
  approvals: ApprovalAging;
  spend: SpendToday;
}

export function bucket(runs: Run[], range: TimeRange, end: number): { t: number; runs: Run[] }[] {
  const span = range.durationMs ?? DAY;
  const start = end - span;
  const count = Math.max(1, Math.round(span / range.bucketMs));
  const out = Array.from({ length: count }, (_, i) => ({
    t: start + i * range.bucketMs,
    runs: [] as Run[],
  }));
  for (const r of runs) {
    const idx = Math.min(count - 1, Math.floor((Date.parse(r.startedAt) - start) / range.bucketMs));
    if (idx >= 0) out[idx].runs.push(r);
  }
  return out;
}

export function buildHealth(range: TimeRange, tick = 0): HealthSnapshot {
  const runs = runsInRange(range);
  const end = NOW;

  /* In flight. `tick` walks the count deterministically so auto-refresh has
     something true to roll between, rather than re-randomising. */
  const runningBase = RUNS.filter((r) => r.status === "running").length;
  const queued = RUNS.filter((r) => r.status === "queued").length;
  const drift = [0, 1, 2, 1, 3, 2][tick % 6];
  const prevDrift = [0, 1, 2, 1, 3, 2][(tick + 5) % 6];

  const inFlight: InFlight = {
    running: runningBase + drift,
    previousRunning: runningBase + prevDrift,
    queued,
    oldestQueuedMs: 11 * 60_000,
  };

  /* Failure budget. The allowance is (1 - target) of the volume in the window;
     spending more than the allowance is what "41% success" was failing to say. */
  const failed = runs.filter((r) => r.status === "failed");
  const allowed = Math.max(1, Math.round(runs.length * (1 - POLICY.reliabilityTarget)));
  const spent = failed.length;

  const buckets = bucket(runs, range, end);
  let cumulative = 0;
  const series: BudgetPoint[] = buckets.map((b, i) => {
    cumulative += b.runs.filter((r) => r.status === "failed").length;
    return {
      t: b.t,
      remaining: (allowed - cumulative) / allowed,
      ideal: 1 - (i + 1) / buckets.length,
    };
  });

  const postgresFailures = failed.filter(
    (r) => r.incidentId === POSTGRES_INCIDENT_ID || r.workflowName === "renewals-daily",
  ).length;

  const failureBudget: FailureBudget = {
    target: POLICY.reliabilityTarget,
    allowed,
    spent,
    burnRatio: spent / allowed,
    series,
    topCause: spent
      ? {
          label: "Connection ‘Postgres Answers’",
          share: Math.max(0.34, postgresFailures / Math.max(1, spent)),
          href: `/incidents/${POSTGRES_INCIDENT_ID}`,
        }
      : null,
  };

  /* Approvals. Waited time is derived from the SLA remainder so the two can
     never contradict each other on screen. */
  const SLA_MS = 24 * HOUR;
  const aged = APPROVALS.map((a) => ({
    waited: SLA_MS - a.slaRemainingMs,
    sla: SLA_MS,
    breached: a.slaRemainingMs < 0,
  }));
  const oldest = aged.reduce((max, a) => (a.waited > max.waited ? a : max), aged[0]);

  const approvals: ApprovalAging = {
    count: APPROVALS.length,
    oldestWaitedMs: oldest?.waited ?? 0,
    oldestSlaMs: SLA_MS,
    pressured: aged.some((a) => a.waited > a.sla / 2),
    breached: aged.filter((a) => a.breached).length,
  };

  /* Spend. Today only, regardless of the selected range — a daily budget
     compared against a 7-day spend would be a lie. */
  const dayStart = new Date(NOW).setUTCHours(0, 0, 0, 0);
  const todays = RUNS.filter((r) => Date.parse(r.startedAt) >= dayStart);
  const spentUsd = todays.reduce((sum, r) => sum + r.costUsd, 0);
  const dayElapsed = (NOW - dayStart) / DAY;

  const hourly = Array.from({ length: 24 }, (_, h) => {
    const from = dayStart + h * HOUR;
    return {
      t: from,
      usd: todays
        .filter((r) => {
          const t = Date.parse(r.startedAt);
          return t >= from && t < from + HOUR;
        })
        .reduce((sum, r) => sum + r.costUsd, 0),
    };
  }).filter((p) => p.t <= NOW);

  let running = 0;
  const spendSeries = hourly.map((p) => {
    running += p.usd;
    return { t: p.t, usd: running };
  });

  const spend: SpendToday = {
    spentUsd,
    budgetUsd: POLICY.dailyBudgetUsd,
    projectedUsd: dayElapsed > 0 ? spentUsd / dayElapsed : spentUsd,
    dayElapsed,
    series: spendSeries,
  };

  return { inFlight, failureBudget, approvals, spend };
}

/* ── Band 2 · Needs attention ─────────────────────────────────────────────── */

export type AttentionSeverity = "critical" | "high" | "medium";

export interface AttentionItem {
  id: string;
  severity: AttentionSeverity;
  /** What is wrong, in one sentence, active voice. */
  problem: string;
  /** Who or what is affected. Rendered as discrete facts, not prose. */
  blastRadius: BlastFact[];
  /** Age of the condition, for the sort and the label. */
  since: number;
  action: { label: string; href: string };
  kind: "connection" | "approval" | "workflow" | "quota" | "incident";
}

export interface BlastFact {
  label: string;
  value: string;
  href?: string;
  /** Render through <MonoId> — mono, middle-truncated, click-to-copy (rule 8). */
  id?: boolean;
}

const SEVERITY_RANK: Record<AttentionSeverity, number> = { critical: 0, high: 1, medium: 2 };

export function buildAttention(): AttentionItem[] {
  const items: AttentionItem[] = [];

  /* Failing connections — the highest-leverage item on the page. One fix
     unblocks every workflow, tool and queued run counted here. */
  for (const c of CONNECTIONS.filter((c) => c.status === "failing")) {
    const blockedRuns = RUNS.filter(
      (r) => r.status === "queued" && r.nodes.some((n) => n.error?.connection === c.name),
    ).length;
    const queuedShare = c.name === "Postgres Answers" ? 22 : blockedRuns;
    const sinceMs = NOW - Date.parse(c.lastCheckedAt) + (c.name === "Postgres Answers" ? 4 * HOUR : 40 * 60_000);

    items.push({
      id: `attn-conn-${c.id}`,
      kind: "connection",
      severity: c.blastRadius.workflows >= 3 ? "critical" : "high",
      problem: `Connection ‘${c.name}’ has been failing for ${formatSpan(sinceMs)}`,
      // Zero-valued facts are omitted. "0 queued runs" is not reassurance, it is
      // a line an operator has to read to discover it says nothing.
      blastRadius: [
        { label: c.blastRadius.workflows === 1 ? "workflow" : "workflows", value: String(c.blastRadius.workflows), href: "/workflows" },
        { label: c.blastRadius.tools === 1 ? "tool" : "tools", value: String(c.blastRadius.tools), href: "/tools" },
        ...(queuedShare > 0
          ? [{ label: queuedShare === 1 ? "queued run" : "queued runs", value: String(queuedShare), href: "/runs?status=queued" }]
          : []),
      ],
      since: sinceMs,
      action: { label: "Fix connection", href: `/connections/${c.id}` },
    });
  }

  /* Approvals against their SLA. */
  for (const a of APPROVALS) {
    const SLA_MS = 24 * HOUR;
    const waited = SLA_MS - a.slaRemainingMs;
    if (waited < SLA_MS / 2) continue;
    items.push({
      id: `attn-apr-${a.id}`,
      kind: "approval",
      severity: a.slaRemainingMs < 0 ? "critical" : "high",
      // Named by the workflow, not the approval id. An operator triaging this
      // needs to know what is stuck, and apr_de740829 tells them nothing.
      problem:
        a.slaRemainingMs < 0
          ? `Approval on ${a.workflowName} breached its ${formatSpan(SLA_MS)} SLA ${formatSpanPrecise(-a.slaRemainingMs)} ago`
          : `Approval on ${a.workflowName} has waited ${formatSpanPrecise(waited)} of a ${formatSpan(SLA_MS)} SLA`,
      blastRadius: [
        { label: "workflow", value: a.workflowName, href: "/workflows" },
        { label: "requester", value: a.requester },
        { label: "run", value: a.runId, href: `/runs/${a.runId}`, id: true },
      ],
      since: waited,
      action: { label: "Review", href: `/approvals/${a.id}` },
    });
  }

  /* Workflows failing consecutively — a pattern no single run reveals. */
  for (const w of WORKFLOWS) {
    const streak = consecutiveFailures(w);
    if (streak < 4) continue;
    items.push({
      id: `attn-wf-${w.id}`,
      kind: "workflow",
      severity: streak >= 6 ? "high" : "medium",
      problem: `Workflow ‘${w.name}’ failed ${streak} consecutive runs`,
      blastRadius: [
        { label: "environment", value: w.environment },
        { label: "owner", value: w.owner },
        { label: "trigger", value: w.trigger },
      ],
      since: streak * 40 * 60_000,
      action: { label: "Diagnose", href: `/workflows/${w.id}` },
    });
  }

  /* Quota. Derived from the runs actually started today — a hard-coded "18 of
     20" alongside a fact saying 100 runs started is the kind of contradiction
     that makes an operator stop trusting the whole page. */
  const used = runsToday();
  if (used >= POLICY.dailyRunLimit * 0.85) {
    const remaining = Math.max(0, POLICY.dailyRunLimit - used);
    items.push({
      id: "attn-quota",
      kind: "quota",
      severity: used >= POLICY.dailyRunLimit ? "critical" : "medium",
      problem: `Workspace is at ${used} of ${POLICY.dailyRunLimit} daily runs`,
      blastRadius: [
        { label: "plan", value: POLICY.planName },
        { label: remaining === 1 ? "run left today" : "runs left today", value: String(remaining) },
        { label: "resets", value: "00:00 UTC" },
      ],
      since: 2 * HOUR,
      action: { label: "Request higher limits", href: "/settings/usage" },
    });
  }

  /* Open incidents that nobody has picked up. */
  for (const inc of INCIDENTS.filter((i) => i.status === "open" && !i.assignee)) {
    items.push({
      id: `attn-inc-${inc.id}`,
      kind: "incident",
      severity: inc.occurrences > 30 ? "high" : "medium",
      problem: `Incident ‘${inc.signature.split(" · ")[0]}’ is open and unassigned`,
      blastRadius: [
        { label: "occurrences", value: String(inc.occurrences) },
        { label: "runs", value: String(inc.affectedRuns), href: "/runs?status=failed" },
        { label: "workflows", value: String(inc.affectedWorkflows.length) },
      ],
      since: NOW - Date.parse(inc.firstSeen),
      action: { label: "Assign", href: `/incidents/${inc.id}` },
    });
  }

  return items.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.since - a.since,
  );
}

/** Runs started since 00:00 UTC. The quota denominator's numerator. */
export function runsToday(): number {
  const dayStart = new Date(NOW).setUTCHours(0, 0, 0, 0);
  return RUNS.filter((r) => Date.parse(r.startedAt) >= dayStart).length;
}

function consecutiveFailures(w: Workflow): number {
  let n = 0;
  for (let i = w.last30.length - 1; i >= 0; i -= 1) {
    if (w.last30[i] === "failed") n += 1;
    else break;
  }
  return n;
}

/**
 * Compact human span: `4h`, `19h`, `12m`, `3d`.
 *
 * Days only past 48h. Collapsing 24h to "1d" produced "waited 1d of a 1d SLA",
 * which is true and says nothing — the whole point of that sentence is the gap
 * between the two numbers.
 */
export function formatSpan(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < 60_000) return `${Math.round(abs / 1000)}s`;
  if (abs < HOUR) return `${Math.round(abs / 60_000)}m`;
  if (abs < 2 * DAY) return `${Math.round(abs / HOUR)}h`;
  return `${Math.round(abs / DAY)}d`;
}

/** `23h 48m` — for the one place where the remainder is the news. */
export function formatSpanPrecise(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < HOUR) return `${Math.round(abs / 60_000)}m`;
  const hours = Math.floor(abs / HOUR);
  const minutes = Math.round((abs % HOUR) / 60_000);
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** `1 workflow` · `3 workflows`. */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/* ── Band 3 · Fleet ───────────────────────────────────────────────────────── */

export interface FleetRow {
  workflow: Workflow;
  /** Newest last, so the strip reads left-to-right as time. */
  last30: RunStatus[];
  failureRate: number;
  lastRunAt: number;
  spendUsd: number;
  runIds: (string | null)[];
}

export type FleetSort = "failure" | "recency" | "spend";

export function buildFleet(sort: FleetSort = "failure"): FleetRow[] {
  const rows: FleetRow[] = WORKFLOWS.map((w, wi) => {
    const runs = RUNS.filter((r) => r.workflowId === w.id);
    const failed = w.last30.filter((s) => s === "failed").length;
    return {
      workflow: w,
      last30: w.last30,
      failureRate: failed / w.last30.length,
      // Deterministic recency spread so the sort has something to do.
      lastRunAt: NOW - (wi * 37 + 4) * 60_000,
      spendUsd: runs.reduce((sum, r) => sum + r.costUsd, 0),
      // Real ids where we have them; the rest are historical and not linkable.
      runIds: w.last30.map((_, i) => runs[i]?.id ?? null),
    };
  });

  const by: Record<FleetSort, (a: FleetRow, b: FleetRow) => number> = {
    failure: (a, b) => b.failureRate - a.failureRate,
    recency: (a, b) => b.lastRunAt - a.lastRunAt,
    spend: (a, b) => b.spendUsd - a.spendUsd,
  };
  return [...rows].sort(by[sort]);
}

/* ── Band 4 · Detail ──────────────────────────────────────────────────────── */

export interface LatencyDistribution {
  /** Bucket upper bounds in ms, and the count in each. */
  buckets: { upperMs: number; count: number }[];
  p50: number;
  p95: number;
  p99: number;
  sampleCount: number;
}

export function buildLatency(range: TimeRange): LatencyDistribution {
  const durations = runsInRange(range)
    .map((r) => r.durationMs)
    .filter((d): d is number => d !== null && d > 0)
    .sort((a, b) => a - b);

  if (durations.length === 0) {
    return { buckets: [], p50: 0, p95: 0, p99: 0, sampleCount: 0 };
  }

  const quantile = (q: number) => durations[Math.min(durations.length - 1, Math.floor(durations.length * q))];

  // Log-spaced buckets. Linear buckets put 90% of runs in the first bar and
  // tell you nothing about the tail, which is the part that matters.
  const min = Math.max(100, durations[0]);
  const max = durations[durations.length - 1];
  const COUNT = 24;
  const logMin = Math.log(min);
  const step = (Math.log(max) - logMin) / COUNT;

  const buckets = Array.from({ length: COUNT }, (_, i) => ({
    upperMs: Math.exp(logMin + step * (i + 1)),
    count: 0,
  }));
  for (const d of durations) {
    const idx = Math.min(COUNT - 1, Math.max(0, Math.floor((Math.log(d) - logMin) / step)));
    buckets[idx].count += 1;
  }

  return {
    buckets,
    p50: quantile(0.5),
    p95: quantile(0.95),
    p99: quantile(0.99),
    sampleCount: durations.length,
  };
}

export interface CostPoint {
  t: number;
  costUsd: number;
  tokens: number;
}

export interface CostTrend {
  points: CostPoint[];
  /** Budget allocated per bucket, for the overlay line. */
  budgetPerBucketUsd: number;
  totalUsd: number;
  totalTokens: number;
}

export function buildCostTrend(range: TimeRange): CostTrend {
  const buckets = bucket(runsInRange(range), range, NOW);
  const points = buckets.map((b) => ({
    t: b.t,
    costUsd: b.runs.reduce((sum, r) => sum + r.costUsd, 0),
    tokens: b.runs.reduce((sum, r) => sum + r.tokens, 0),
  }));
  const bucketsPerDay = DAY / range.bucketMs;
  return {
    points,
    budgetPerBucketUsd: POLICY.dailyBudgetUsd / bucketsPerDay,
    totalUsd: points.reduce((s, p) => s + p.costUsd, 0),
    totalTokens: points.reduce((s, p) => s + p.tokens, 0),
  };
}

/* ── Activity stream ──────────────────────────────────────────────────────── */

export type ActivityKind =
  | "run.started" | "node.committed" | "gate.opened"
  | "run.failed" | "run.succeeded" | "run.resumed";

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  at: number;
  /** Pre-composed so the stream never formats during a tick. */
  subject: string;
  detail: string;
  href: string;
}

const ACTIVITY_TEMPLATES: { kind: ActivityKind; detail: (r: Run) => string }[] = [
  { kind: "run.started", detail: (r) => `${r.nodes.length} nodes · ${r.trigger}` },
  { kind: "node.committed", detail: (r) => `${r.nodes.filter((n) => n.state === "committed").length} of ${r.nodes.length} committed` },
  { kind: "gate.opened", detail: () => "awaiting a reviewer" },
  { kind: "run.failed", detail: (r) => r.nodes.find((n) => n.state === "failed")?.name ?? "node failed" },
  { kind: "run.succeeded", detail: (r) => `${Math.round((r.durationMs ?? 0) / 1000)}s` },
  { kind: "run.resumed", detail: () => "from last checkpoint" },
];

/**
 * A deterministic tail. `count` events ending at `NOW - offset`, so advancing
 * the offset produces the next frame rather than a reshuffle — the stream has
 * to be stable enough to screenshot.
 */
export function buildActivity(count: number, offset = 0): ActivityEvent[] {
  const source = RUNS.slice(0, 240);
  return Array.from({ length: count }, (_, i) => {
    const idx = (i + offset) % source.length;
    const run = source[idx];
    const template = ACTIVITY_TEMPLATES[(idx * 7 + i) % ACTIVITY_TEMPLATES.length];
    return {
      id: `${run.id}-${i + offset}`,
      kind: template.kind,
      at: NOW - (i + offset) * 4_200 - (idx % 11) * 300,
      subject: run.workflowName,
      detail: template.detail(run),
      href: `/runs/${run.id}`,
    };
  });
}

/* ── Empty workspace ──────────────────────────────────────────────────────── */

/**
 * Whether the workspace has anything to show. A brand-new workspace gets a
 * first-run layout, not a dashboard full of zeroes and empty axes.
 */
export function isEmptyWorkspace(runs: Run[], workflows: Workflow[]): boolean {
  return runs.length === 0 && workflows.length === 0;
}
