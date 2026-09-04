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

/* ══════════════════════════════════════════════════════════════════════════════
   THE GATE'S TERMS ARE REAL NOW.

   This adapter used to write `slaMs: 1`, `slaRemainingMs: 1`,
   `slaAvailable: false`, `escalatesTo: "Not provided by API"` and
   `approverGroup: "Not provided by API"` — honest placeholders for data the API
   genuinely did not return. Two things had to change upstream before they could
   go away, and both have:

     - the APPROVAL executor was writing to the legacy `approvals` table while
       the API read `run_approvals`, so a gate a workflow opened never reached
       this screen at all; and
     - `sla_deadline_at` / `escalation_policy_json` existed since V027 and were
       neither written by the node nor selected by the repository.

   The gate's SLA now comes from `slaDeadlineAt`, and the approver group and
   timeout behaviour from `escalationPolicy` — which is the canvas inspector's
   own configuration, round-tripped. `slaAvailable` stays a real flag rather than
   a constant: a gate configured with no SLA is a legitimate gate, and the card
   must not draw a countdown ring for it.
══════════════════════════════════════════════════════════════════════════════ */

/** What `escalation_policy_json` holds, as `ApprovalStore` writes it. */
interface EscalationPolicy {
  onTimeout?: unknown;
  approverGroup?: unknown;
  slaMinutes?: unknown;
}

const TIMEOUT_LABEL: Record<string, string> = {
  escalate: "a second approver group",
  reject: "automatic rejection",
  approve: "automatic approval",
  hold: "no escalation — it keeps waiting",
};

function toGate(approval: contracts.Approval, workflows: Map<string, string>, runs: Map<string, ReturnType<typeof toUiRun>>): GateView {
  const context = contextFrom(approval.payloadJsonSanitized, approval.evidenceRefs);
  const decidedAt = approval.decidedAt ? Date.parse(approval.decidedAt) : undefined;
  const audit = [{ at: Date.parse(approval.requestedAt), actor: approval.requestedBy ?? "workflow", action: "Gate opened" }];
  if (decidedAt) audit.push({ at: decidedAt, actor: approval.decidedBy ?? "unknown", action: approval.status === "APPROVED" ? "Approved" : "Rejected", ...(approval.decisionReason ? { reason: approval.decisionReason } : {}) });

  const policy = (approval.escalationPolicy ?? {}) as EscalationPolicy;
  const requestedAtMs = Date.parse(approval.requestedAt);
  const deadlineMs = approval.slaDeadlineAt ? Date.parse(approval.slaDeadlineAt) : NaN;
  const slaAvailable = Number.isFinite(deadlineMs) && deadlineMs > requestedAtMs;
  /* The window is measured from when the gate OPENED, not from now, so the ring
     fills as the clock runs down instead of resetting on every poll. */
  const slaMs = slaAvailable ? deadlineMs - requestedAtMs : 1;
  const slaRemainingMs = slaAvailable ? deadlineMs - Date.now() : 1;
  const onTimeout = typeof policy.onTimeout === "string" ? policy.onTimeout : null;
  const approverGroup = typeof policy.approverGroup === "string" && policy.approverGroup
    ? policy.approverGroup
    : "Anyone who can decide";

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
    slaMs,
    slaRemainingMs,
    slaAvailable,
    escalatesTo: onTimeout ? TIMEOUT_LABEL[onTimeout] ?? onTimeout : "no configured escalation",
    approverGroup,
    risk: toRisk(approval.riskLevel),
    run: runs.get(approval.runId),
    evidence: [],
    audit,
    ...(approval.decidedBy ? { decidedBy: approval.decidedBy } : {}),
    ...(decidedAt ? { decidedAt } : {}),
    ...(approval.decisionReason ? { decisionReason: approval.decisionReason } : {}),
  };
}

/**
 * The rows an approver reads, with their provenance.
 *
 * `payload` is `decision_context_json` when the gate defined context bindings
 * and `metadata_json` otherwise — the API coalesces the two. `evidenceRefs`
 * carries the expression each value came from, which is the first question an
 * approver asks and the first one an auditor asks afterwards; without it the
 * source line could only say "sanitized approval payload", which answers
 * neither.
 */
function contextFrom(
  payload: Record<string, unknown> | null | undefined,
  evidence?: Record<string, unknown> | null,
): ApprovalContext[] {
  if (!payload) return [];
  return Object.entries(payload).slice(0, 12).map(([label, value]) => {
    const ref = evidence?.[label] as { expression?: unknown; resolved?: unknown } | undefined;
    const expression = typeof ref?.expression === "string" ? ref.expression : null;
    return {
      label: label.replace(/[_-]+/g, " "),
      value: typeof value === "string" ? value : JSON.stringify(value),
      source: expression
        ? ref?.resolved === false
          ? `${expression} — did not resolve`
          : expression
        : "Sanitized approval payload",
    };
  });
}
function toRisk(value: string | null | undefined): GateView["risk"] {
  const risk = value?.toLowerCase();
  return risk === "critical" || risk === "high" || risk === "medium" ? risk : "low";
}
