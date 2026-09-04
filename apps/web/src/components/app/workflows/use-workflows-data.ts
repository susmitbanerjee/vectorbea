"use client";

import * as React from "react";
import type { contracts } from "@vectorbea/shared";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import type { Environment, RunStatus, TriggerKind, Workflow, WorkflowStatus } from "~/lib/workflows/model";

const PAGE_SIZE = 100;

export function useWorkflowsData() {
  const api = useApi();
  const { workspaceId } = useScope();
  const scope = React.useMemo(() => ({ workspaceId, environmentId: null }), [workspaceId]);
  const keyScope = { workspaceId, environmentId: null };
  const enabled = Boolean(workspaceId);

  const workflows = useApiQuery({
    queryKey: queryKeys.workflows.list(keyScope, { page: 1, pageSize: PAGE_SIZE }),
    queryFn: () => api.workflows.list({ ...scope, page: 1, pageSize: PAGE_SIZE }),
    enabled,
  });
  const runs = useApiQuery({
    queryKey: queryKeys.runs.list(keyScope, { page: 1, pageSize: PAGE_SIZE }),
    queryFn: () => api.runs.list({ ...scope, page: 1, pageSize: PAGE_SIZE }),
    enabled,
    freshness: "live",
  });

  const rows = React.useMemo(() => {
    const runsByWorkflow = new Map<string, contracts.RunSummary[]>();
    for (const run of runs.data?.items ?? []) {
      const bucket = runsByWorkflow.get(run.workflowId) ?? [];
      bucket.push(run);
      runsByWorkflow.set(run.workflowId, bucket);
    }
    return (workflows.data?.items ?? []).map((workflow) =>
      toUiWorkflow(workflow, runsByWorkflow.get(workflow.id) ?? []),
    );
  }, [workflows.data, runs.data]);

  return {
    rows,
    loading: workflows.isPending || runs.isPending,
    error: workflows.error ?? runs.error,
    refetch: async () => { await Promise.all([workflows.refetch(), runs.refetch()]); },
    scope,
  };
}

function toUiWorkflow(workflow: contracts.Workflow, sourceRuns: contracts.RunSummary[]): Workflow {
  const recent = [...sourceRuns]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(-30);
  const finished = recent.filter((run) => isFinished(run.status));
  const succeeded = finished.filter((run) => run.status === "succeeded" || run.status === "completed");
  const durations = finished.flatMap((run) => run.durationMs == null ? [] : [run.durationMs]);
  const latest = recent.at(-1);

  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description ?? "No description yet.",
    status: toWorkflowStatus(workflow.status),
    stepCount: workflow.stepCount,
    agentCount: workflow.agentCount,
    toolCount: workflow.toolCount,
    environment: toEnvironment(latest?.environment),
    owner: "Workspace",
    version: 0,
    versionKnown: false,
    draftVersion: workflow.currentVersionId ? null : 1,
    trigger: toTrigger(latest?.triggerType),
    triggers: [],
    tags: [],
    last30: recent.map((run) => toRunStatus(run.status)),
    last30RunIds: recent.map((run) => run.id),
    lastRunAt: latest?.startedAt ?? latest?.createdAt ?? null,
    lastRunStatus: latest ? toRunStatus(latest.status) : null,
    successRate30d: finished.length > 0 ? Math.round((succeeded.length / finished.length) * 100) : 0,
    avgDurationMs: durations.length > 0
      ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      : null,
    spend30dUsd: recent.reduce((sum, run) => sum + (run.estimatedCostUsd ?? 0), 0),
    connectionNames: [],
    toolNames: [],
    hasRunData: recent.length > 0,
  };
}

function isFinished(status: contracts.RunStatus): boolean {
  return ["succeeded", "completed", "failed", "cancelled", "timed_out", "enqueue_failed"].includes(status);
}

function toWorkflowStatus(status: string): WorkflowStatus {
  return status === "active" || status === "paused" || status === "archived" ? status : "draft";
}

function toRunStatus(status: contracts.RunStatus): RunStatus {
  if (status === "succeeded" || status === "completed") return "succeeded";
  if (status === "failed" || status === "timed_out" || status === "enqueue_failed") return "failed";
  if (status === "running" || status === "recovering") return "running";
  if (status === "awaiting_approval" || status === "waiting_for_approval" || status === "paused") return "awaiting-approval";
  if (status === "cancelled" || status === "cancellation_requested") return "cancelled";
  return "queued";
}

function toEnvironment(value: string | null | undefined): Environment {
  return value === "production" || value === "staging" || value === "development" ? value : "unknown";
}

function toTrigger(value: contracts.TriggerType | undefined): TriggerKind {
  return value ?? "manual";
}
