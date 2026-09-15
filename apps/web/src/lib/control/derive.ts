import type { contracts } from "@vectorbea/shared";

import {
  DAY, HOUR,
  type AttentionItem, type ControlBudgetSettings, type CostTrend, type FleetRow, type FleetSort,
  type HealthSnapshot, type LatencyDistribution, type RunStatus, type TimeRange,
} from "./model";

/**
 * Live API responses → Control's view models.
 *
 * Pure functions, no fetching, no React. Everything here is derived from data
 * the API actually returned, and where the API has no answer the shape carries
 * a zero and the band renders its own "not available" copy — nothing invents a
 * number to fill a slot.
 *
 * WHY SO MUCH IS DERIVED CLIENT-SIDE. Control wants per-workflow outcome
 * history, a latency distribution and a cost trend. The API has no endpoint for
 * any of the three (API-GAPS.md GAP-27 and the OBSERVE section). What it does
 * have is `/api/runs`, which carries status, duration and cost per run — so one
 * page of runs is folded into all three here rather than fetched N times, which
 * is the specific thing GAP-27 warns against.
 *
 * The honest limitation: `/api/runs` accepts no time range (also documented),
 * so these are derived from the most recent page of runs and the selected range
 * filters them client-side. A range wider than the page cannot be complete, and
 * `runsAreComplete` reports whether it is.
 */

type RunSummary = contracts.RunSummary;
type Workflow = contracts.Workflow;
type FailureIncident = contracts.FailureIncident;
type ControlMetrics = contracts.ControlMetrics;
type Approval = contracts.Approval;

/* ── Status translation ───────────────────────────────────────────────────── */

/**
 * API status → UI status.
 *
 * `completed` → `succeeded` and `awaiting_approval` → `awaiting-approval` are
 * the two that matter; getting either wrong paints a run in the wrong colour,
 * which is worse than not painting it. `timed_out` and `paused` have no UI
 * colour of their own — timed out is a failure to an operator, and paused reads
 * as waiting.
 *
 * THE PARKED STATUSES USED TO COLLAPSE INTO `queued`, and that was a lie with a
 * cost. `queued` means the platform has not picked the run up; a run parked on a
 * six-minute render, a timer or a cooperative yield HAS started and is holding
 * no worker. Reading a wall of them as queue depth sends an operator to scale
 * workers that are already idle. `waiting` is the honest third answer.
 */
const STATUS_MAP: Record<contracts.RunStatus, RunStatus> = {
  succeeded: "succeeded",
  completed: "succeeded",
  failed: "failed",
  running: "running",
  queued: "queued",
  awaiting_approval: "awaiting-approval",
  waiting_for_approval: "awaiting-approval",
  /*
   * Parked on an async tool or an unarrived signal. NOT `awaiting-approval`:
   * that would put "Awaiting approval" on a six-minute video render and send
   * somebody looking for an approval queue that does not exist. NOT `queued`
   * either — the run has started and is holding no worker.
   */
  waiting_for_event: "waiting",
  cancelled: "cancelled",
  timed_out: "failed",
  paused: "awaiting-approval",
  waiting_for_timer: "waiting",
  recovering: "running",
  yielded: "waiting",
  cancellation_requested: "cancelled",
  enqueue_failed: "failed",
  continued_as_new: "cancelled",
};

export function toUiStatus(status: contracts.RunStatus): RunStatus {
  return STATUS_MAP[status] ?? "queued";
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const at = (iso: string | null | undefined): number =>
  iso ? Date.parse(iso) : Number.NaN;

/** A run's position in time: when it finished, else when it started, else created. */
function runTime(run: RunSummary): number {
  const t = at(run.completedAt) || at(run.startedAt) || at(run.createdAt);
  return Number.isNaN(t) ? Date.now() : t;
}

export function runsInRange(runs: RunSummary[], range: TimeRange, now: number): RunSummary[] {
  const span = range.durationMs;
  if (span === null) return runs;
  const start = now - span;
  return runs.filter((r) => runTime(r) >= start);
}

/**
 * Did the fetched page cover the whole range?
 *
 * If the oldest run we hold is NEWER than the start of the window, there are
 * older runs we never saw and every total below is a floor, not a count. The
 * page says so rather than quietly under-reporting.
 */
export function runsAreComplete(runs: RunSummary[], range: TimeRange, now: number, total: number): boolean {
  if (range.durationMs === null) return runs.length >= total;
  if (runs.length >= total) return true;
  const oldest = Math.min(...runs.map(runTime));
  return oldest <= now - range.durationMs;
}

/* ── Band 1 · Health ──────────────────────────────────────────────────────── */

export function deriveHealth(
  runs: RunSummary[],
  allRuns: RunSummary[],
  metrics: ControlMetrics | undefined,
  incidents: FailureIncident[],
  now: number,
  budget?: ControlBudgetSettings,
  approvals?: Approval[],
  approvalsAvailable = approvals !== undefined,
): HealthSnapshot {
  /**
   * Queue depth and queue age come from ALL runs, not the selected window.
   *
   * A run that has been queued for nine weeks is queued RIGHT NOW; filtering it
   * out because it was created before the last 24 hours reports an empty queue
   * while the platform is visibly stuck. The window governs what HAPPENED, not
   * what is outstanding.
   */
  const queuedRuns = allRuns.filter((r) => r.status === "queued");
  const oldestQueuedMs = queuedRuns.length
    ? now - Math.min(...queuedRuns.map((r) => at(r.createdAt) || now))
    : 0;

  // In-flight comes from /api/control/metrics, which counts server-side and so
  // is not bounded by the page of runs we happen to hold.
  const running = metrics?.workspace.inFlight ?? runs.filter((r) => r.status === "running").length;
  const queued = metrics?.workspace.queued ?? queuedRuns.length;

  const pendingApprovals = (approvals ?? []).filter((a) => a.status === "PENDING");
  const approvalSlaMs = (budget?.approvalSlaMinutes ?? 1_440) * 60_000;
  const approvalAges = pendingApprovals.map((a) => Math.max(0, now - at(a.requestedAt)));
  const oldestApprovalMs = approvalAges.length > 0 ? Math.max(...approvalAges) : 0;

  const terminal = runs.filter(
    (r) => r.status === "completed" || r.status === "failed" || r.status === "timed_out",
  );
  const failures = terminal.filter((r) => r.status !== "completed");

  const target = budget?.reliabilityTarget ?? null;
  const allowed = target === null ? null : terminal.length * (1 - target);
  const spent = failures.length;

  // Burn-down across the window, oldest → newest, as failures accumulate.
  const ordered = [...terminal].sort((a, b) => runTime(a) - runTime(b));
  const series = allowed === null || allowed <= 0 ? [] : ordered.map((run, i) => {
    const spentSoFar = ordered.slice(0, i + 1).filter((r) => r.status !== "completed").length;
    return {
      t: runTime(run),
      remaining: 1 - spentSoFar / allowed,
      ideal: 1 - (i + 1) / Math.max(1, ordered.length),
    };
  });

  // The largest single failure cause, from real incidents.
  const byCode = new Map<string, number>();
  for (const inc of incidents) byCode.set(inc.code, (byCode.get(inc.code) ?? 0) + 1);
  const top = [...byCode.entries()].sort((a, b) => b[1] - a[1])[0];
  const topCause = top
    ? { label: top[0], share: top[1] / Math.max(1, incidents.length), href: "/incidents" }
    : null;

  const dayStart = new Date(now).setHours(0, 0, 0, 0);
  const todays = runs.filter((r) => runTime(r) >= dayStart);
  const spentUsd = todays.reduce((sum, r) => sum + (r.estimatedCostUsd ?? 0), 0);
  const dayElapsed = (now - dayStart) / DAY;

  return {
    inFlight: { running, queued, previousRunning: running, oldestQueuedMs },
    failureBudget: {
      target,
      allowed,
      spent,
      burnRatio: allowed === null || allowed <= 0 ? null : spent / allowed,
      series,
      topCause,
    },
    approvals: {
      available: approvalsAvailable,
      count: pendingApprovals.length,
      oldestWaitedMs: oldestApprovalMs,
      oldestSlaMs: approvalSlaMs,
      pressured: approvalAges.some((age) => age >= approvalSlaMs / 2),
      breached: approvalAges.filter((age) => age >= approvalSlaMs).length,
    },
    spend: {
      spentUsd,
      budgetUsd: budget?.dailySpendLimitUsd ?? null,
      projectedUsd: dayElapsed > 0 ? spentUsd / dayElapsed : spentUsd,
      dayElapsed,
      series: todays
        .sort((a, b) => runTime(a) - runTime(b))
        .map((r) => ({ t: runTime(r), usd: r.estimatedCostUsd ?? 0 })),
    },
  };
}

/* ── Band 2 · Attention ───────────────────────────────────────────────────── */

/**
 * Attention items from live data.
 *
 * Three of the four sources the triage feed wants are real: failing
 * connections, repeatedly-failing workflows, and open incidents. The fourth,
 * aging approvals, cannot be built while `/api/approvals` 500s, so it is
 * absent rather than approximated.
 */
export function deriveAttention(
  runs: RunSummary[],
  workflows: Workflow[],
  connections: contracts.Connection[],
  incidents: FailureIncident[],
  now: number,
  approvals: Approval[] = [],
  approvalSlaMs = DAY,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  const nameOf = new Map(workflows.map((w) => [w.id, w.name]));

  for (const c of connections.filter((c) => c.lastTestStatus === "failed")) {
    const blocked = runs.filter((r) => r.status === "queued").length;
    items.push({
      id: `attn-conn-${c.id}`,
      kind: "connection",
      severity: "critical",
      problem: `Connection ‘${c.name}’ is failing its health check`,
      blastRadius: [
        ...(blocked > 0
          ? [{ label: blocked === 1 ? "queued run" : "queued runs", value: String(blocked), href: "/runs?q=status%3Aqueued" }]
          : []),
      ],
      since: c.lastTestedAt ? now - at(c.lastTestedAt) : 0,
      action: { label: "Fix connection", href: `/connections/${c.id}` },
    });
  }

  // A workflow whose recent runs are consistently failing.
  const byWorkflow = new Map<string, RunSummary[]>();
  for (const r of runs) {
    const list = byWorkflow.get(r.workflowId) ?? [];
    list.push(r);
    byWorkflow.set(r.workflowId, list);
  }
  for (const [workflowId, list] of byWorkflow) {
    const recent = [...list].sort((a, b) => runTime(b) - runTime(a)).slice(0, 10);
    const failed = recent.filter((r) => r.status === "failed" || r.status === "timed_out");
    if (recent.length < 3 || failed.length < recent.length) continue;
    items.push({
      id: `attn-wf-${workflowId}`,
      kind: "workflow",
      severity: "critical",
      problem: `Every recent run of ‘${nameOf.get(workflowId) ?? "this workflow"}’ has failed`,
      blastRadius: [
        { label: "consecutive failures", value: String(failed.length), href: "/runs?q=status%3Afailed" },
      ],
      since: now - runTime(recent[0]!),
      action: { label: "Open workflow", href: `/workflows/${workflowId}` },
    });
  }

  for (const inc of incidents.filter((i) => i.resolutionStatus !== "resolved")) {
    items.push({
      id: `attn-inc-${inc.id}`,
      kind: "incident",
      severity: inc.severity === "HIGH" || inc.severity === "CRITICAL" ? "critical" : "high",
      problem: inc.summary,
      blastRadius: [
        { label: "run", value: inc.runId, id: true },
        ...(inc.category ? [{ label: "category", value: inc.category }] : []),
      ],
      since: now - at(inc.detectedAt),
      action: { label: "Investigate", href: `/runs/${inc.runId}` },
    });
  }

  for (const approval of approvals.filter((a) => a.status === "PENDING")) {
    const age = Math.max(0, now - at(approval.requestedAt));
    items.push({
      id: `attn-approval-${approval.id}`,
      kind: "approval",
      severity: age >= approvalSlaMs ? "critical" : age >= approvalSlaMs / 2 ? "high" : "medium",
      problem: approval.title ?? "An approval is waiting for a decision",
      blastRadius: [{ label: "run", value: approval.runId, id: true }],
      since: age,
      action: { label: "Review approval", href: `/approvals?approval=${approval.id}` },
    });
  }

  const rank = { critical: 0, high: 1, medium: 2 } as const;
  return items.sort((a, b) => rank[a.severity] - rank[b.severity] || b.since - a.since);
}

/* ── Band 3 · Fleet ───────────────────────────────────────────────────────── */

export function deriveFleet(
  runs: RunSummary[],
  workflows: Workflow[],
  sort: FleetSort = "failure",
): FleetRow[] {
  const byWorkflow = new Map<string, RunSummary[]>();
  for (const r of runs) {
    const list = byWorkflow.get(r.workflowId) ?? [];
    list.push(r);
    byWorkflow.set(r.workflowId, list);
  }

  const rows: FleetRow[] = workflows.map((w) => {
    // Oldest → newest, so the strip reads left to right as time.
    const list = (byWorkflow.get(w.id) ?? []).sort((a, b) => runTime(a) - runTime(b));
    const last30 = list.slice(-30);
    const terminal = last30.filter(
      (r) => r.status === "completed" || r.status === "failed" || r.status === "timed_out",
    );
    const failed = terminal.filter((r) => r.status !== "completed").length;

    return {
      workflow: { id: w.id, name: w.name },
      last30: last30.map((r) => toUiStatus(r.status)),
      failureRate: terminal.length > 0 ? failed / terminal.length : 0,
      lastRunAt: list.length > 0 ? runTime(list[list.length - 1]!) : null,
      spendUsd: list.reduce((sum, r) => sum + (r.estimatedCostUsd ?? 0), 0),
      runIds: last30.map((r) => r.id),
    };
  });

  // Workflows with no runs in scope sort as oldest, never as "most recent".
  const recencyKey = (r: FleetRow) => r.lastRunAt ?? -Infinity;

  switch (sort) {
    case "recency":
      return rows.sort((a, b) => recencyKey(b) - recencyKey(a));
    case "spend":
      return rows.sort((a, b) => b.spendUsd - a.spendUsd);
    default:
      return rows.sort((a, b) => b.failureRate - a.failureRate || recencyKey(b) - recencyKey(a));
  }
}

/* ── Band 4 · Detail ──────────────────────────────────────────────────────── */

const BUCKET_COUNT = 8;

/**
 * Log-spaced buckets between the fastest and slowest observed run.
 *
 * Two constraints, both learned the hard way:
 *
 * Every bound must be FINITE. The chart plots bars at `Math.log(upperMs)` and
 * scales to the last bucket, so an open-ended `Infinity` bucket makes the whole
 * scale Infinite and every bar renders at `x="NaN"` — the SVG silently draws
 * nothing and React warns about NaN attributes.
 *
 * And the spacing must be logarithmic. Linear buckets put ~90% of runs in the
 * first bar and turn the distribution into a single spike.
 */
export function deriveLatency(runs: RunSummary[]): LatencyDistribution {
  const durations = runs
    .map((r) => r.durationMs)
    .filter((d): d is number => typeof d === "number" && d > 0)
    .sort((a, b) => a - b);

  if (durations.length === 0) {
    return { buckets: [], p50: 0, p95: 0, p99: 0, sampleCount: 0 };
  }

  const percentile = (p: number): number =>
    durations[Math.min(durations.length - 1, Math.floor((p / 100) * durations.length))]!;

  const min = Math.max(1, durations[0]!);
  // A single sample, or many identical ones, would give a zero-width range and
  // divide by zero below. Widen it to a decade so the bar has somewhere to sit.
  const max = Math.max(durations[durations.length - 1]!, min * 10);
  const logMin = Math.log(min);
  const step = (Math.log(max) - logMin) / BUCKET_COUNT;

  const bounds = Array.from({ length: BUCKET_COUNT }, (_, i) =>
    Math.round(Math.exp(logMin + step * (i + 1))),
  );

  return {
    buckets: bounds.map((upperMs, i) => ({
      upperMs,
      count: durations.filter(
        (d) => d <= upperMs && d > (i === 0 ? 0 : bounds[i - 1]!),
      ).length,
    })),
    p50: percentile(50),
    p95: percentile(95),
    p99: percentile(99),
    sampleCount: durations.length,
  };
}

export function deriveCostTrend(
  runs: RunSummary[],
  range: TimeRange,
  now: number,
  budget?: ControlBudgetSettings,
): CostTrend {
  const span = range.durationMs ?? DAY;
  const bucketMs = range.bucketMs;
  const count = Math.max(1, Math.round(span / bucketMs));
  const start = now - span;

  const points = Array.from({ length: count }, (_, i) => ({
    t: start + i * bucketMs,
    costUsd: 0,
    tokens: 0,
  }));

  for (const run of runs) {
    const index = Math.floor((runTime(run) - start) / bucketMs);
    if (index < 0 || index >= points.length) continue;
    points[index]!.costUsd += run.estimatedCostUsd ?? 0;
    points[index]!.tokens += run.totalTokens ?? 0;
  }

  return {
    points,
    budgetPerBucketUsd: budget?.dailySpendLimitUsd
      ? budget.dailySpendLimitUsd * (bucketMs / DAY)
      : 0,
    totalUsd: points.reduce((s, p) => s + p.costUsd, 0),
    totalTokens: points.reduce((s, p) => s + p.tokens, 0),
  };
}

export { HOUR, DAY };
