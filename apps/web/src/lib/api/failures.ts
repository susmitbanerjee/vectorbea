import type { RequestOptions, Transport } from "./transport";

/* ══════════════════════════════════════════════════════════════════════════════
   The failures roll-up.

   Its own module rather than another block in the trace client, for the same
   reason `./trace` is: these endpoints answer one screen, they are read-only,
   and nothing else in the app needs them.

   Workspace-scoped, and the server checks that the id in the path is the
   caller's own — a workspace id in a URL is not an authorisation, and this
   endpoint aggregates everything that workspace ever did.
   ══════════════════════════════════════════════════════════════════════════ */

export type FailureWindow = "24h" | "7d" | "30d" | "90d";

export interface FailureClassRow {
  class: string;
  count: number;
  previousCount: number;
  /**
   * Change against the same length of time before this window.
   *
   * Null when there is nothing to compare against — "+100%" from a base of zero
   * is a number that reads as a trend and is not one.
   */
  changePct: number | null;
  /** Who has to act. The grouping the page is built around. */
  owner: string;
  summary: string;
  retry: string;
  /** BUDGET is a limit, not a crash, and must never render red. */
  rendersAsError: boolean;
  shareOfTotal: number;
}

export interface FailureOwnerRow {
  owner: string;
  count: number;
  classes: Array<{ class: string; count: number }>;
}

export interface FailureWorkflowRow {
  workflowId: string;
  workflowName: string;
  class: string;
  count: number;
  /** One click to a real run's Debug tab. A count with no example is a statistic. */
  sampleRunId: string;
  owner: string;
}

/**
 * By agent — the peer of by-workflow, read from activations rather than runs.
 *
 * A run has one class; a run can activate six agents. `count` is failed
 * ACTIVATIONS and `runs` is the runs they happened in: one run that retried an
 * agent four times is four here and one there, and which of those it is changes
 * what you do about it.
 */
export interface FailureAgentRow {
  agentId: string;
  agentName: string;
  class: string;
  owner: string;
  count: number;
  runs: number;
  workflows: number;
  sampleRunId: string;
}

/** The same thing failing repeatedly, collapsed to one row. */
export interface RecurringFailure {
  class: string;
  owner: string;
  stepId: string;
  stepName: string;
  kind: string;
  count: number;
  /** Across how many workflows — one credential breaking six reads differently. */
  workflows: number;
  sampleRunId: string;
  lastSeen: string | null;
}

/**
 * A workflow habitually finishing near a ceiling.
 *
 * These runs SUCCEEDED. They are on a failures page because a workflow that
 * regularly finishes at 92% of its budget is one slightly longer input away from
 * a BUDGET row, and that is the only moment it is cheap to fix.
 */
export interface BudgetPressureRow {
  workflowId: string;
  workflowName: string;
  runs: number;
  nearCeiling: number;
  sharePct: number;
  peakCents: number;
  ceilingCents: number;
  sampleRunId: string;
}

/**
 * How much of this workspace's tracing is intact.
 *
 * On this page because every figure above is computed from the evidence a run
 * left behind. If a meaningful share of runs lost spans, the classification is
 * built on partial evidence and the reader is entitled to know before they act
 * on it.
 */
export interface WorkspaceTraceCompleteness {
  runs: number;
  partialRuns: number;
  droppedSpans: number;
  partialShare: number;
  /** True once the share is large enough to undermine the rest of the page. */
  undermines: boolean;
}

export interface FailureRollup {
  workspaceId: string;
  window: FailureWindow;
  from: string;
  to: string;
  totalFailures: number;
  byClass: FailureClassRow[];
  byOwner: FailureOwnerRow[];
  byWorkflow: FailureWorkflowRow[];
  byAgent: FailureAgentRow[];
  recurring: RecurringFailure[];
  budgetPressure: BudgetPressureRow[];
  traceCompleteness: WorkspaceTraceCompleteness;
}

export function createFailuresApi(transport: Transport, workspaceId: string | null) {
  const req = (signal?: AbortSignal): RequestOptions => ({ workspaceId, signal });

  return {
    rollup: (wsId: string, window: FailureWindow, signal?: AbortSignal) =>
      transport.request<FailureRollup>(
        `/api/workspaces/${wsId}/failures?window=${window}`, req(signal)),
  };
}

export type FailuresApi = ReturnType<typeof createFailuresApi>;
