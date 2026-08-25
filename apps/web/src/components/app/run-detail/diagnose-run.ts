import type { contracts } from "@vectorbea/shared";
import type { Run, RunNode } from "~/lib/runs/model";

/* ══════════════════════════════════════════════════════════════════════════════
   WHAT ACTUALLY WENT WRONG

   The recovery card used `diagnose()` from the fixtures. Most of it was honest
   arithmetic over the run's own nodes — committed vs not, what a retry would
   cost — but three fields were not:

     · `blastRadius` came from looking the failed connection up in the
       CONNECTIONS fixture and reading its invented `workflows`/`tools` counts;
     · `queuedRuns` was the literal `connection?.name === "Postgres Answers" ? 22 : 0`;
     · `incidentId` fell back to a hard-coded fixture incident.

   So a real production failure could be presented with a confident blast radius
   of twenty-two queued runs that nobody had counted. On the one card an operator
   reads while deciding whether to retry or roll back, that is not a cosmetic
   problem.

   This computes the same shape from the run and the run's OWN incident. Where
   the platform does not measure something — blast radius is not an endpoint —
   the field is null and the card omits it, which is the truthful answer.
══════════════════════════════════════════════════════════════════════════════ */

/**
 * Everything the Recovery card states.
 *
 * Declared here rather than imported from the fixtures: this is the shape of a
 * real diagnosis now, and a module whose whole purpose is to stop the card
 * reading fabricated data should not depend on the module that fabricated it.
 */
export interface Diagnosis {
  rootCause: string;
  failedNode: { index: number; node: RunNode };
  toolCall: string | null;
  /** Null when the platform does not measure it — see the note above. */
  blastRadius: { workflows: number; tools: number; queuedRuns: number } | null;
  committed: number;
  total: number;
  retryNodes: number;
  retryCostUsd: number;
  savedUsd: number;
  connectionId: string | null;
  incidentId: string | null;
  classification: string;
}

export function diagnoseRun(
  run: Run,
  incident: contracts.FailureIncident | null,
): Diagnosis | null {
  const index = run.nodes.findIndex((node) => node.state === "failed");
  if (index === -1) return null;
  const node = run.nodes[index];

  /* The product thesis as arithmetic: committed steps survive a retry, so a
     retry costs only what did not commit. Per-node cost when the worker
     recorded it, an even share of the run's cost when it did not. */
  const fallbackUnit = run.nodes.length > 0 ? run.costUsd / run.nodes.length : 0;
  let retryCostUsd = 0;
  let savedUsd = 0;
  let retryNodes = 0;
  for (const candidate of run.nodes) {
    const unit = candidate.costUsd ?? fallbackUnit;
    if (candidate.state === "committed" || candidate.state === "recovered") {
      savedUsd += unit;
    } else {
      retryNodes += 1;
      retryCostUsd += unit;
    }
  }

  return {
    /* The incident's summary is written for a person and is the best sentence
       available; the node's own error is the fallback. */
    rootCause:
      incident?.summary
      ?? node.error?.message
      ?? "This step failed without a structured error.",
    failedNode: { index, node },
    toolCall: node.error?.toolCall ?? null,
    // Not measured anywhere. Null renders as absent rather than as zero, which
    // would read as "nothing else is affected" — a different claim entirely.
    blastRadius: null,
    committed: run.nodes.filter((n) => n.state === "committed" || n.state === "recovered").length,
    total: run.nodes.length,
    retryNodes,
    retryCostUsd: Number(retryCostUsd.toFixed(4)),
    savedUsd: Number(savedUsd.toFixed(4)),
    connectionId: incident?.failedConnectionId ?? null,
    incidentId: incident?.id ?? run.incidentId ?? null,
    classification: incident?.category ?? classify(node.state),
  };
}

function classify(state: string): string {
  switch (state) {
    case "failed": return "failed";
    case "skipped": return "skipped";
    default: return "unknown";
  }
}
