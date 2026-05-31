"use client";

import { useEffect, useState } from "react";
import {
  Bot, Brain, CheckCircle2, ChevronDown, ChevronRight,
  Clock, Wrench, XCircle, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api/client";

interface AgentIteration {
  id: string;
  iterationNumber: number;
  status: "running" | "completed" | "failed" | "skipped";
  thoughtSummarySanitized: string | null;
  actionType: "THINK" | "CALL_TOOL" | "FINAL" | "ASK_APPROVAL" | "FAIL" | null;
  selectedToolId: string | null;
  observationSummarySanitized: string | null;
  tokensUsed: number;
  estimatedCostCents: number;
  startedAt: string;
  completedAt: string | null;
}

const ACTION_STYLE: Record<string, { bg: string; text: string; border: string; icon: typeof Brain }> = {
  THINK:       { bg: "#F5F3FF", text: "#6D28D9", border: "#DDD6FE", icon: Brain },
  CALL_TOOL:   { bg: "#ECFEFF", text: "#0E7490", border: "#A5F3FC", icon: Wrench },
  FINAL:       { bg: "#ECFDF5", text: "#059669", border: "#A7F3D0", icon: CheckCircle2 },
  ASK_APPROVAL:{ bg: "#FFFBEB", text: "#B45309", border: "#FDE68A", icon: Clock },
  FAIL:        { bg: "#FEF2F2", text: "#B91C1C", border: "#FECACA", icon: XCircle },
};

function IterationCard({ iter }: { iter: AgentIteration }) {
  const [expanded, setExpanded] = useState(iter.actionType === "FINAL");
  const style = ACTION_STYLE[iter.actionType ?? "THINK"] ?? ACTION_STYLE.THINK;
  const ActionIcon = style.icon;
  const durationMs = iter.completedAt
    ? new Date(iter.completedAt).getTime() - new Date(iter.startedAt).getTime()
    : null;

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ background: "#FFFFFF", borderColor: iter.status === "failed" ? "#FECACA" : "#E2E8F0" }}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        {/* Iteration number */}
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
          style={{ background: style.bg, color: style.text, border: `1px solid ${style.border}` }}
        >
          {iter.iterationNumber}
        </span>

        {/* Action type badge */}
        {iter.actionType && (
          <span
            className="inline-flex items-center gap-1 rounded-lg border px-2 py-0.5"
            style={{ fontSize: 11, fontWeight: 700, background: style.bg, color: style.text, borderColor: style.border }}
          >
            <ActionIcon className="h-3 w-3" />
            {iter.actionType.replace("_", " ")}
          </span>
        )}

        {/* Thought summary (one sentence) */}
        {iter.thoughtSummarySanitized && (
          <span className="flex-1 min-w-0 truncate text-[12px] text-slate-600">
            {iter.thoughtSummarySanitized}
          </span>
        )}

        {/* Stats */}
        <div className="flex items-center gap-3 shrink-0 ml-auto">
          {iter.tokensUsed > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-slate-400">
              <Zap className="h-3 w-3" />
              {iter.tokensUsed.toLocaleString()}
            </span>
          )}
          {durationMs !== null && (
            <span className="text-[11px] text-slate-400">
              {durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`}
            </span>
          )}
          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-slate-100 px-4 pb-3 pt-3 space-y-2">
          {iter.selectedToolId && (
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em", textTransform: "uppercase" }}>Tool</span>
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                {iter.selectedToolId}
              </code>
            </div>
          )}
          {iter.observationSummarySanitized && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 3 }}>
                Observation
              </p>
              <p style={{ fontSize: 12.5, color: "#334155" }}>{iter.observationSummarySanitized}</p>
            </div>
          )}
          {iter.estimatedCostCents > 0 && (
            <p style={{ fontSize: 11, color: "#94A3B8" }}>
              Est. cost: ${(iter.estimatedCostCents / 100).toFixed(4)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  runId: string;
  stepId?: string;
}

export function AgentBrainTrace({ runId, stepId }: Props) {
  const [iterations, setIterations] = useState<AgentIteration[]>([]);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    const url = `/api/agent-iterations/${runId}${stepId ? `?stepId=${encodeURIComponent(stepId)}` : ""}`;
    apiFetch<AgentIteration[]>(url)
      .then(setIterations)
      .catch(() => setIterations([]))
      .finally(() => setLoading(false));
  }, [runId, stepId]);

  if (loading) return null;
  if (iterations.length === 0) return null;

  const totalTokens = iterations.reduce((s, i) => s + i.tokensUsed, 0);
  const totalCents  = iterations.reduce((s, i) => s + i.estimatedCostCents, 0);
  const lastIter    = iterations[iterations.length - 1];
  const stopReason  = lastIter?.actionType ?? "—";

  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", boxShadow: "0 4px 14px rgba(15,23,42,0.03)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid #F1F5F9", background: "#F8FAFC" }}
      >
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4" style={{ color: "#7C3AED" }} />
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "#0F172A" }}>Agent Brain Trace</span>
          <span
            className="rounded-full border px-2 py-0.5"
            style={{ fontSize: 11, fontWeight: 600, color: "#64748B", borderColor: "#E2E8F0", background: "#F8FAFC" }}
          >
            {iterations.length} iteration{iterations.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-3" style={{ fontSize: 12, color: "#64748B" }}>
          <span>{totalTokens.toLocaleString()} tokens</span>
          {totalCents > 0 && <span>${(totalCents / 100).toFixed(4)}</span>}
          <span>Stopped: {stopReason}</span>
        </div>
      </div>

      {/* Iterations */}
      <div className="space-y-2 p-4">
        {iterations.map(iter => <IterationCard key={iter.id} iter={iter} />)}
      </div>

      <p
        className="px-4 pb-3 text-center"
        style={{ fontSize: 11, color: "#94A3B8" }}
      >
        Reasoning summaries only — raw chain-of-thought is not stored or displayed.
      </p>
    </div>
  );
}
