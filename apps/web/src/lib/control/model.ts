/**
 * Control's view models.
 *
 * These are the shapes the Control bands render. They used to live in
 * `~/mocks/control` beside the fixtures that produced them, which meant any
 * real-data code had to import from the fixture module to name a type — and
 * that is exactly the coupling the fixture guard exists to prevent.
 *
 * The types are here; the fixtures re-export them, so nothing that already
 * imports from `~/mocks/control` changes. `derive.ts` next door builds these
 * same shapes out of live API responses.
 *
 * Nothing in this file fabricates data. It is types and formatters only.
 */

export const HOUR = 3_600_000;
export const DAY = 86_400_000;

/* ── Status vocabulary ────────────────────────────────────────────────────── */

/**
 * Run status as the UI speaks it.
 *
 * Deliberately NOT the API's vocabulary. The API says `completed` and
 * `awaiting_approval`; the UI has always said `succeeded` and
 * `awaiting-approval`, and the charts key their colour maps off the UI spelling.
 * `derive.ts` owns the translation, in one place, rather than each component
 * guessing.
 */
export type RunStatus =
  | "succeeded"
  | "failed"
  | "running"
  | "queued"
  | "awaiting-approval"
  | "cancelled";

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
  /** Null means the workspace has not configured a reliability objective. */
  target: number | null;
  /** Allowed failures in the window, from the target and the run volume. */
  allowed: number | null;
  spent: number;
  /** spent / allowed. Over 1 means the budget is blown. */
  burnRatio: number | null;
  series: BudgetPoint[];
  /** The single largest contributor, so the number resolves to a cause. */
  topCause: { label: string; share: number; href: string } | null;
}

export interface ApprovalAging {
  /** False when the approval source is unavailable; never present unknown as zero. */
  available: boolean;
  count: number;
  oldestWaitedMs: number;
  oldestSlaMs: number;
  /** True when any gate has consumed more than half its SLA. */
  pressured: boolean;
  breached: number;
}

export interface SpendToday {
  spentUsd: number;
  /** Null means spend is observed without a configured ceiling. */
  budgetUsd: number | null;
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

/** Customer-configured workspace objectives used by Control. */
export interface ControlBudgetSettings {
  configured: boolean;
  reliabilityTarget: number | null;
  dailySpendLimitUsd: number | null;
  approvalSlaMinutes: number | null;
  updatedAt: string | null;
}

/* ── Band 2 · Attention ───────────────────────────────────────────────────── */

export type AttentionSeverity = "critical" | "high" | "medium";

export interface BlastFact {
  label: string;
  value: string;
  href?: string;
  /** Render through <MonoId> — mono, middle-truncated, click-to-copy (rule 8). */
  id?: boolean;
}

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

/* ── Band 3 · Fleet ───────────────────────────────────────────────────────── */

/**
 * The workflow identity a fleet row needs.
 *
 * A narrow structural shape rather than the full entity: the strip shows a
 * name, links by id, and labels the environment when one is known. Typing this
 * against a whole `Workflow` forced every producer to invent fields the strip
 * never reads.
 */
export interface FleetWorkflowRef {
  id: string;
  name: string;
  environment?: string;
}

export interface FleetRow {
  workflow: FleetWorkflowRef;
  /** Newest last, so the strip reads left-to-right as time. */
  last30: RunStatus[];
  failureRate: number;
  /** null when the workflow has no runs in scope — never render an age for it. */
  lastRunAt: number | null;
  spendUsd: number;
  runIds: (string | null)[];
}

export type FleetSort = "failure" | "recency" | "spend";

/* ── Band 4 · Detail ──────────────────────────────────────────────────────── */

export interface LatencyDistribution {
  /** Bucket upper bounds in ms, and the count in each. */
  buckets: { upperMs: number; count: number }[];
  p50: number;
  p95: number;
  p99: number;
  sampleCount: number;
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

/* ── Formatters ───────────────────────────────────────────────────────────── */

/** `45s` · `12m` · `4h` · `3d`. */
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
