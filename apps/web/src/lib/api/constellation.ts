import type { Transport, RequestOptions } from "./transport";
import type {
  Constellation,
} from "~/components/app/debug/constellation-layout";

/* ══════════════════════════════════════════════════════════════════════════════
   The debugger v2 reads: constellation, burn-down, compare.

   On the app transport, like `./trace`, and for the same reason: the transport
   attaches the bearer token and `X-Workspace-Id`, and these endpoints are
   workspace-scoped and fail CLOSED. A hand-rolled `fetch` without the header
   does not return somebody else's data — it returns nothing, and the view
   renders an empty state that looks like a run with no team. That is the most
   confusing possible direction for the failure to point.
   ══════════════════════════════════════════════════════════════════════════ */

export type { Constellation };

/** One cumulative sample in a band, milliseconds from the run's start. */
export interface BurndownPoint {
  atMs: number;
  costCents: number;
  tokens: number;
  iterations: number;
}

/** One activation's cumulative spend over the run. */
export interface BurndownBand {
  activationId: string | null;
  /** Never blank: an unattributable band is named "Unattributed". */
  agentName: string;
  role: string | null;
  depth: number;
  tokens: number;
  costCents: number;
  iterations: number;
  /** Fraction of the run's ATTRIBUTED total, 0..1. */
  shareOfCost: number;
  points: BurndownPoint[];
}

/** A limit, its source, and where the stack crossed it — null if it never did. */
export interface BurndownCeiling {
  dimension: "cost" | "tokens" | "iterations" | string;
  limit: number;
  /** "workspace" · "team budget" · "run" — which 100 the run spent 40 of. */
  source: string;
  crossedAtMs: number | null;
}

/**
 * A moment worth marking on the axis.
 *
 * A `clamp` is the reason a worker underperformed and is otherwise invisible:
 * the child was granted less than it asked for and every screen shows an agent
 * that simply stopped early.
 */
export interface BurndownMarker {
  kind: "clamp" | "ceiling" | "margin" | string;
  atMs: number;
  label: string;
  detail: string | null;
  activationId: string | null;
}

/**
 * The two independent records of the same money, and the gap between them.
 *
 * `run_spans.cost_cents` is written in CENTS by the agent brain;
 * `agent_runs.estimated_cost` is USD summed from run events, which only the
 * model-call executor writes. Neither is derived from the other. Rescaling one
 * to match would draw a chart that adds up and lies about where the money went,
 * so the leftover is named instead.
 */
export interface BurndownReconciliation {
  attributedCents: number;
  unattributedCents: number;
  recordedTotalCents: number | null;
  agrees: boolean;
  note: string | null;
}

export interface Burndown {
  runId: string;
  startedAtMs: number;
  durationMs: number;
  bands: BurndownBand[];
  ceilings: BurndownCeiling[];
  markers: BurndownMarker[];
  reconciliation: BurndownReconciliation;
}

export interface CompareDelta {
  field: string;
  a: unknown;
  b: unknown;
  /** A sentence, when the field alone does not explain itself. */
  note: string | null;
}

export interface CompareNode {
  key: string;
  name: string;
  kind: string;
  stepId: string | null;
  /** "both" · "onlyA" · "onlyB". */
  presence: string;
  statusA: string | null;
  statusB: string | null;
  /** True when this node meets the bar for a divergence — not every delta does. */
  divergent: boolean;
  deltas: CompareDelta[];
}

/**
 * Why the comparison was not made.
 *
 * Present means REFUSED, not "diffed with a warning on top": across workflow
 * versions every difference has two possible causes and the diff cannot choose
 * between them.
 */
export interface CompareRefusal {
  reason: string;
  explanation: string;
  offer: string;
}

export interface Comparison {
  a: { runId: string; workflowVersionId: string | null; status: string | null };
  b: { runId: string; workflowVersionId: string | null; status: string | null };
  sameVersion: boolean;
  refusal: CompareRefusal | null;
  /**
   * The FIRST node that differs, in execution order.
   *
   * Everything after it is downstream of it, which is why the view leads with
   * this one fact rather than with a list.
   */
  divergenceKey: string | null;
  onlyInA: number;
  onlyInB: number;
  nodes: CompareNode[];
}

// ── §6 replay and time travel ───────────────────────────────────────────────

/**
 * What running an action will actually do in the world.
 *
 * Three levels, not a boolean: a replay from iteration N is recorded up to N and
 * LIVE after it, so "does this have side effects" has no honest yes or no.
 */
export type SideEffects = "NONE" | "LIVE_FROM_POINT" | "REAL";

export interface ReplayOption {
  id: string;
  label: string;
  sideEffects: SideEffects;
  /** One sentence, shown BEFORE the confirmation. Never just a level. */
  effectSummary: string;
  available: boolean;
  /** Why not. Null when available — a disabled control with no reason is a bug. */
  reason: string | null;
}

export interface ReplayOptions {
  runId: string;
  status: string;
  /** The last settled iteration, so the picker knows its range. */
  highestIteration: number | null;
  options: ReplayOption[];
}

/** One attempt in a run's replay history. */
export interface ReplayAttempt {
  runId: string;
  status: string;
  createdAt: string | null;
  completedAt: string | null;
  sourceRunId: string | null;
  replayUntilNode: string | null;
  isReplay: boolean;
  isThisRun: boolean;
}

export interface ReplayHistory {
  runId: string;
  attempts: ReplayAttempt[];
}

/** Who to compare against, when the reader has not said. */
export interface CompareTarget {
  runId: string;
  target: { runId: string; status: string; completedAt: string | null } | null;
  /** Why there is no target. Null when there is one. */
  reason: string | null;
}

export function createDebugApi(transport: Transport, workspaceId: string | null) {
  const req = (signal?: AbortSignal): RequestOptions => ({ workspaceId, signal });

  return {
    constellation: (runId: string, signal?: AbortSignal) =>
      transport.request<Constellation>(`/api/runs/${runId}/constellation`, req(signal)),

    burndown: (runId: string, signal?: AbortSignal) =>
      transport.request<Burndown>(`/api/runs/${runId}/burndown`, req(signal)),

    compare: (runId: string, otherId: string, signal?: AbortSignal) =>
      transport.request<Comparison>(`/api/runs/${runId}/compare/${otherId}`, req(signal)),

    /**
     * The default counterpart: the most recent successful run of the same
     * workflow version. Asking the reader to pick one first is asking them to
     * answer the question they came with.
     */
    compareTarget: (runId: string, signal?: AbortSignal) =>
      transport.request<CompareTarget>(`/api/runs/${runId}/compare`, req(signal)),

    /**
     * What may be done to this run, and what each will do in the world.
     *
     * Availability is decided SERVER-side: whether a replay from an iteration can
     * be honoured depends on the shape of the persisted transcript, which the
     * client cannot see. A client-side guess either offers an action the worker
     * refuses — the reader spends a run finding out — or hides one that works.
     */
    replayOptions: (runId: string, signal?: AbortSignal) =>
      transport.request<ReplayOptions>(`/api/runs/${runId}/replay-options`, req(signal)),

    /** Every attempt at this run, so three tries at a fix are comparable. */
    replays: (runId: string, signal?: AbortSignal) =>
      transport.request<ReplayHistory>(`/api/runs/${runId}/replays`, req(signal)),
  };
}

export type DebugApi = ReturnType<typeof createDebugApi>;
