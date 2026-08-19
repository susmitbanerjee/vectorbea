"use client";

import * as React from "react";
import type { contracts } from "@vectorbea/shared";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import { toUiRun } from "~/components/app/runs/use-runs-data";
import type { ApprovalContext, GateView } from "~/lib/approvals/model";

const PAGE_SIZE = 100;

export function useApprovalsData() {
  const api = useApi();
  const { workspaceId } = useScope();
  const scope = React.useMemo(() => ({ workspaceId, environmentId: null }), [workspaceId]);
  const keyScope = { workspaceId, environmentId: null };
  const enabled = Boolean(workspaceId);
  const approvals = useApiQuery({ queryKey: queryKeys.approvals.list(keyScope, { page: 1, pageSize: PAGE_SIZE }), queryFn: () => api.approvals.list({ ...scope, page: 1, pageSize: PAGE_SIZE }), enabled, freshness: "live" });
  const workflows = useApiQuery({ queryKey: queryKeys.workflows.list(keyScope, { page: 1, pageSize: PAGE_SIZE }), queryFn: () => api.workflows.list({ ...scope, page: 1, pageSize: PAGE_SIZE }), enabled });
  const runs = useApiQuery({ queryKey: queryKeys.runs.list(keyScope, { page: 1, pageSize: PAGE_SIZE }), queryFn: () => api.runs.list({ ...scope, page: 1, pageSize: PAGE_SIZE }), enabled, freshness: "live" });

  const rows = React.useMemo(() => {
    const workflowNames = new Map((workflows.data?.items ?? []).map((workflow) => [workflow.id, workflow.name]));
    const runMap = new Map((runs.data?.items ?? []).map((run) => [run.id, toUiRun(run)]));
    return (approvals.data?.items ?? []).map((approval) => toGate(approval, workflowNames, runMap));
  }, [approvals.data, runs.data, workflows.data]);

  return {
    rows,
    loading: approvals.isPending || workflows.isPending || runs.isPending,
    error: approvals.error ?? workflows.error ?? runs.error,
    scope,
    refetch: async () => { await Promise.all([approvals.refetch(), runs.refetch()]); },
  };
}

function toGate(approval: contracts.Approval, workflows: Map<string, string>, runs: Map<string, ReturnType<typeof toUiRun>>): GateView {
  const context = contextFrom(approval.payloadJsonSanitized);
  const decidedAt = approval.decidedAt ? Date.parse(approval.decidedAt) : undefined;
  const audit = [{ at: Date.parse(approval.requestedAt), actor: approval.requestedBy ?? "workflow", action: "Gate opened" }];
  if (decidedAt) audit.push({ at: decidedAt, actor: approval.decidedBy ?? "unknown", action: approval.status === "APPROVED" ? "Approved" : "Rejected", ...(approval.decisionReason ? { reason: approval.decisionReason } : {}) });
  return {
    id: approval.id,
    runId: approval.runId,
    workflowId: approval.workflowId,
    workflowName: workflows.get(approval.workflowId) ?? `Workflow ${approval.workflowId.slice(0, 8)}`,
    nodeName: approval.title ?? approval.nodeId ?? approval.stepId ?? "Approval gate",
    requestedAt: approval.requestedAt,
    requester: approval.requestedBy ?? "workflow",
    context,
    status: approval.status === "APPROVED" ? "approved" : approval.status === "REJECTED" ? "rejected" : "pending",
    slaMs: 1,
    slaRemainingMs: 1,
    slaAvailable: false,
    escalatesTo: "Not provided by API",
    approverGroup: "Not provided by API",
    risk: toRisk(approval.riskLevel),
    run: runs.get(approval.runId),
    evidence: [],
    audit,
    ...(approval.decidedBy ? { decidedBy: approval.decidedBy } : {}),
    ...(decidedAt ? { decidedAt } : {}),
    ...(approval.decisionReason ? { decisionReason: approval.decisionReason } : {}),
  };
}

function contextFrom(payload: Record<string, unknown> | null | undefined): ApprovalContext[] {
  if (!payload) return [];
  return Object.entries(payload).slice(0, 12).map(([label, value]) => ({
    label: label.replace(/[_-]+/g, " "),
    value: typeof value === "string" ? value : JSON.stringify(value),
    source: "Sanitized approval payload",
  }));
}
function toRisk(value: string | null | undefined): GateView["risk"] {
  const risk = value?.toLowerCase();
  return risk === "critical" || risk === "high" || risk === "medium" ? risk : "low";
}
