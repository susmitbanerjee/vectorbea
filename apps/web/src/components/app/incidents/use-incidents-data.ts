"use client";

import * as React from "react";
import type { contracts } from "@vectorbea/shared";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import { toUiRun } from "~/components/app/runs/use-runs-data";
import type { IncidentSeverity, IncidentStatus, IncidentView } from "~/lib/incidents/model";
import { describeIncident, failureReason } from "~/lib/incidents/describe-incident";

const PAGE_SIZE = 100;

export function useIncidentsData() {
  const api = useApi();
  const { workspaceId } = useScope();
  const scope = React.useMemo(() => ({ workspaceId, environmentId: null }), [workspaceId]);
  const keyScope = { workspaceId, environmentId: null };
  const enabled = Boolean(workspaceId);
  const incidents = useApiQuery({ queryKey: queryKeys.incidents.list(keyScope, { limit: PAGE_SIZE }), queryFn: () => api.incidents.list({ ...scope, limit: PAGE_SIZE }), enabled, freshness: "live" });
  const workflows = useApiQuery({ queryKey: queryKeys.workflows.list(keyScope, { page: 1, pageSize: PAGE_SIZE }), queryFn: () => api.workflows.list({ ...scope, page: 1, pageSize: PAGE_SIZE }), enabled });
  const runs = useApiQuery({ queryKey: queryKeys.runs.list(keyScope, { page: 1, pageSize: PAGE_SIZE }), queryFn: () => api.runs.list({ ...scope, page: 1, pageSize: PAGE_SIZE }), enabled, freshness: "live" });

  const rows = React.useMemo(() => groupIncidents(incidents.data ?? [], workflows.data?.items ?? [], runs.data?.items ?? []), [incidents.data, runs.data, workflows.data]);
  return {
    rows,
    loading: incidents.isPending || workflows.isPending || runs.isPending,
    error: incidents.error ?? workflows.error ?? runs.error,
    scope,
    refetch: async () => { await Promise.all([incidents.refetch(), runs.refetch()]); },
  };
}

function groupIncidents(source: contracts.FailureIncident[], workflows: contracts.Workflow[], runs: contracts.RunSummary[]): IncidentView[] {
  const workflowById = new Map(workflows.map((workflow) => [workflow.id, workflow]));
  const runById = new Map(runs.map((run) => [run.id, run]));
  const groups = new Map<string, contracts.FailureIncident[]>();
  for (const incident of source) {
    const key = describeIncident(incident).groupKey;
    groups.set(key, [...(groups.get(key) ?? []), incident]);
  }
  return [...groups.values()].map((items) => {
    const sorted = [...items].sort((a, b) => Date.parse(a.detectedAt) - Date.parse(b.detectedAt));
    const first = sorted[0];
    const workflowIds = [...new Set(sorted.map((item) => item.workflowId))];
    const toolIds = new Set(sorted.flatMap((item) => item.failedToolId ? [item.failedToolId] : []));
    const connectionIds = new Set(sorted.flatMap((item) => item.failedConnectionId ? [item.failedConnectionId] : []));
    const runRecords = sorted.flatMap((item) => {
      const run = runById.get(item.runId);
      return run ? [toUiRun(run, item)] : [];
    });
    const latest = sorted.at(-1) ?? first;
    const words = describeIncident(latest);
    const component = words.where ?? (first.failedToolId ? "Tool" : first.failedConnectionId ? "Connection" : "Workflow");
    return {
      id: first.id,
      sourceIds: sorted.map((item) => item.id),
      title: words.title,
      reason: failureReason(latest),
      signature: words.where ? `${words.title} · ${words.where}` : words.title,
      firstSeen: first.detectedAt,
      lastSeen: sorted.at(-1)?.detectedAt ?? first.detectedAt,
      occurrences: sorted.length,
      affectedWorkflows: workflowIds.map((id) => workflowById.get(id)?.name ?? `Workflow ${id.slice(0, 8)}`),
      affectedRuns: sorted.length,
      status: toStatus(sorted),
      assignee: null,
      remediation: words.fix,
      sparkline: hourlyBuckets(sorted),
      severity: toSeverity(sorted.map((item) => item.severity)),
      classification: words.kind,
      failingComponent: component,
      componentHref: first.failedConnectionId ? `/connections/${first.failedConnectionId}` : first.failedToolId ? `/tools/${first.failedToolId}` : "/runs",
      blastRadius: {
        workflows: workflowIds.length,
        tools: toolIds.size,
        connections: connectionIds.size,
        runs: sorted.length,
        costOfFailureUsd: runRecords.reduce((sum, run) => sum + run.costUsd, 0),
      },
      activity: sorted.map((item) => ({ at: Date.parse(item.detectedAt), actor: "Run failed", action: failureReason(item) ?? describeIncident(item).title })),
      mutedUntil: null,
      autoResolveAfterMs: 0,
      autoResolveAvailable: false,
      externalTracker: null,
      runRecords,
      workflowRecords: workflowIds.flatMap((id) => {
        const workflow = workflowById.get(id);
        return workflow ? [{ id: workflow.id, name: workflow.name }] : [];
      }),
    };
  });
}

function toStatus(items: contracts.FailureIncident[]): IncidentStatus {
  return items.every((item) => item.resolutionStatus.toLowerCase() === "resolved") ? "resolved" : "open";
}
function toSeverity(values: string[]): IncidentSeverity {
  const rank: Record<IncidentSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  return values.reduce<IncidentSeverity>((highest, value) => {
    const normalized: IncidentSeverity = value === "critical" || value === "high" || value === "medium" ? value : "low";
    return rank[normalized] > rank[highest] ? normalized : highest;
  }, "low");
}
function hourlyBuckets(items: contracts.FailureIncident[]): number[] {
  const end = Date.now();
  const start = end - 24 * 3_600_000;
  const buckets = Array.from({ length: 24 }, () => 0);
  for (const item of items) {
    const at = Date.parse(item.detectedAt);
    if (at < start || at > end) continue;
    const index = Math.min(23, Math.floor((at - start) / 3_600_000));
    buckets[index] += 1;
  }
  return buckets;
}
