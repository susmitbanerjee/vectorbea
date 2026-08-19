import type { Run } from "~/lib/runs/model";

export type ApprovalDecision = "approved" | "rejected";
export interface ApprovalContext { label: string; value: string; source: string }
export interface AuditEntry { at: number; actor: string; action: string; reason?: string; contextSnapshot?: ApprovalContext[] }
export interface EvidenceStep { nodeIndex: number; nodeName: string; produces: string[]; durationMs: number; summary: string }
export interface GateView {
  id: string; runId: string; workflowId: string; workflowName: string; nodeName: string;
  requestedAt: string; requester: string; context: ApprovalContext[];
  status: "pending" | ApprovalDecision; slaMs: number; slaRemainingMs: number; slaAvailable: boolean;
  escalatesTo: string; approverGroup: string; risk: "low" | "medium" | "high" | "critical";
  run: Run | undefined; evidence: EvidenceStep[]; audit: AuditEntry[];
  decidedBy?: string; decidedAt?: number; decisionReason?: string;
}

export const REJECT_REASONS = [
  "Exceeds policy limits",
  "Insufficient evidence in the context",
  "Customer contact is out of date",
  "Duplicate of an earlier request",
  "Needs a finance exception first",
];

export function slaState(gate: GateView) {
  const waitedMs = gate.slaMs - gate.slaRemainingMs;
  const fraction = Math.max(0, Math.min(1, gate.slaRemainingMs / gate.slaMs));
  return { waitedMs, remainingMs: gate.slaRemainingMs, fraction, tone: gate.slaRemainingMs < 0 ? "breached" as const : fraction <= 0.5 ? "pressured" as const : "ok" as const };
}

export function bulkApprovable(gates: GateView[]): { ok: boolean; reason: string } {
  if (gates.length === 0) return { ok: false, reason: "Select gates to approve." };
  if (gates.length === 1) return { ok: true, reason: "" };
  if (gates.some((gate) => gate.risk === "critical")) return { ok: false, reason: "Critical-risk gates must be decided individually." };
  if (new Set(gates.map((gate) => gate.workflowId)).size > 1) return { ok: false, reason: "Bulk approve requires one workflow." };
  if (new Set(gates.map((gate) => gate.nodeName)).size > 1) return { ok: false, reason: "Bulk approve requires one gate." };
  if (new Set(gates.map((gate) => gate.risk)).size > 1) return { ok: false, reason: "Bulk approve requires one risk tier." };
  return { ok: true, reason: "" };
}
