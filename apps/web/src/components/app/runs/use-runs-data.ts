"use client";

import * as React from "react";
import type { contracts } from "@vectorbea/shared";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import type { CellState, Run, RunNode, RunStatus } from "~/lib/runs/model";

const PAGE_SIZE = 100;
const CELL_STATES = new Set<CellState>([
  "committed", "executing", "gated", "failed", "pending", "skipped", "recovered",
]);

type RibbonCell = { n?: unknown; s?: unknown; ms?: unknown };

export function useRunsData(page = 1) {
  const api = useApi();
  const { workspaceId } = useScope();
  const scope = React.useMemo(() => ({ workspaceId, environmentId: null }), [workspaceId]);
  const keyScope = { workspaceId, environmentId: null };
  const enabled = Boolean(workspaceId);

  const runs = useApiQuery({
    queryKey: queryKeys.runs.list(keyScope, { page, pageSize: PAGE_SIZE }),
    queryFn: () => api.runs.list({ ...scope, page, pageSize: PAGE_SIZE }),
    enabled,
    freshness: "live",
  });
  const incidents = useApiQuery({
    queryKey: queryKeys.incidents.list(keyScope, { limit: 100 }),
    queryFn: () => api.incidents.list({ ...scope, limit: 100 }),
    enabled,
  });

  const rows = React.useMemo(() => {
    const byRun = new Map((incidents.data ?? []).map((incident) => [incident.runId, incident]));
    return (runs.data?.items ?? []).map((run) => toUiRun(run, byRun.get(run.id)));
  }, [runs.data, incidents.data]);

  return {
    rows,
    total: runs.data?.total ?? rows.length,
    page,
    pageSize: PAGE_SIZE,
    loading: runs.isPending,
    error: runs.error,
    refetch: runs.refetch,
    scope,
  };
}

export function toUiRun(run: contracts.RunSummary, incident?: contracts.FailureIncident): Run {
  const nodes = parseRibbon(run.ribbonJson, run.nodeTotal ?? 0, incident);
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowName: run.workflowName ?? `Workflow ${run.workflowId.slice(0, 8)}`,
    status: toStatus(run.status),
    environment: toEnvironment(run.environment),
    trigger: run.triggerType,
    startedAt: run.startedAt ?? run.createdAt,
    finishedAt: run.completedAt ?? null,
    durationMs: run.durationMs ?? null,
    costUsd: run.estimatedCostUsd ?? 0,
    tokens: run.totalTokens ?? 0,
    nodes,
    incidentId: run.incidentId ?? incident?.id,
    delivery: run.deliveryStatus,
  };
}

function parseRibbon(
  raw: string,
  nodeTotal: number,
  incident?: contracts.FailureIncident,
): RunNode[] {
  let cells: RibbonCell[] = [];
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value)) cells = value as RibbonCell[];
  } catch {
    // A malformed denormalized ribbon must not take down the entire Runs page.
  }

  const nodes = cells.flatMap((cell, index): RunNode[] => {
    if (typeof cell.n !== "string" || typeof cell.s !== "string" || !CELL_STATES.has(cell.s as CellState)) {
      return [];
    }
    const failed = cell.s === "failed";
    return [{
      id: cell.n,
      name: cell.n,
      kind: "checkpoint",
      state: cell.s as CellState,
      durationMs: typeof cell.ms === "number" ? cell.ms : null,
      tokens: null,
      costUsd: null,
      at: failed ? incident?.detectedAt ?? null : null,
      ...(failed && incident ? { error: { message: incident.summary } } : {}),
    }];
  });

  for (let index = nodes.length; index < nodeTotal; index += 1) {
    nodes.push({
      id: `pending-${index + 1}`,
      name: `Step ${index + 1}`,
      kind: "checkpoint",
      state: "pending",
      durationMs: null,
      tokens: null,
      costUsd: null,
      at: null,
    });
  }
  return nodes;
}

function toStatus(status: contracts.RunStatus): RunStatus {
  switch (status) {
    case "succeeded":
    case "completed": return "succeeded";
    case "failed":
    case "timed_out":
    case "enqueue_failed": return "failed";
    case "running":
    case "recovering": return "running";
    case "waiting_for_approval":
    case "awaiting_approval":
    case "paused": return "awaiting-approval";
    /* Parked on a machine, not a person. Rendering these as "Awaiting approval"
       would send somebody hunting for an approval queue; rendering them as
       "Queued" would send them scaling idle workers. */
    case "waiting_for_event":
    case "waiting_for_timer":
    case "yielded": return "waiting";
    case "cancelled":
    case "cancellation_requested":
    case "continued_as_new": return "cancelled";
    default: return "queued";
  }
}

function toEnvironment(value: string | null | undefined): Run["environment"] {
  return value === "production" || value === "staging" || value === "development"
    ? value
    : "unknown";
}
