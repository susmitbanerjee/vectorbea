"use client";
import { useState } from "react";
import { Check, Copy, ExternalLink, RefreshCw, Shield, StopCircle, ThumbsDown, ThumbsUp } from "lucide-react";
import type { WorkflowRun, ViewMode } from "@/types/runs";
import { StatusBadge } from "./StatusBadge";
import { cn } from "@/lib/utils";

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function MetaItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">{label}</span>
      <span className="text-[13px] font-semibold text-[#0B0D0F]">{value}</span>
    </div>
  );
}

export function RunSummaryHeader({
  run, viewMode, onAction,
}: {
  run: WorkflowRun;
  viewMode: ViewMode;
  onAction: (action: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const live   = run.status === "running" || run.status === "waiting_for_approval";
  const elapsed = fmtDuration(run.durationMs);
  const costPct = Math.min(100, (run.totalCostUsd / run.budgetUsd) * 100);

  function copyId() {
    void navigator.clipboard.writeText(run.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className="rounded-2xl bg-white overflow-hidden"
      style={{ border: "1px solid #E2E8F0", boxShadow: "0 4px 14px rgba(15,23,42,0.04)" }}
    >
      {/* Top accent */}
      <div
        className="h-1 w-full"
        style={{
          background: run.status === "failed" ? "#EF4444"
            : run.status === "completed" ? "#10B981"
            : run.status === "waiting_for_approval" ? "#D97706"
            : "#2563EB",
        }}
      />

      <div className="px-5 py-4">
        {/* Title row */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", color: "#0F172A" }}>
                {run.workflowName}
              </h1>
              <StatusBadge status={run.status} size="md" />
              {live && <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span style={{ fontSize: 12, color: "#64748B", fontFamily: "monospace" }}>{run.id}</span>
              <button
                type="button"
                onClick={copyId}
                className="rounded p-0.5 text-slate-400 hover:text-slate-600 transition-colors"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
              {run.currentBlockingReason && (
                <span
                  className="rounded-full border px-2 py-0.5"
                  style={{ fontSize: 11, fontWeight: 600, background: "#FFFBEB", color: "#B45309", borderColor: "#FDE68A" }}
                >
                  ⚠ {run.currentBlockingReason}
                </span>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {run.status === "waiting_for_approval" && (
              <>
                <button
                  type="button"
                  onClick={() => onAction("approve")}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#059669] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#047857]"
                >
                  <ThumbsUp className="h-3.5 w-3.5" /> Approve
                </button>
                <button
                  type="button"
                  onClick={() => onAction("reject")}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-4 text-[13px] font-semibold text-red-700 transition-colors hover:bg-red-100"
                >
                  <ThumbsDown className="h-3.5 w-3.5" /> Reject
                </button>
              </>
            )}
            {run.status === "failed" && (
              <button
                type="button"
                onClick={() => onAction("retry")}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Retry failed step
              </button>
            )}
            {(run.status === "running" || run.status === "waiting" || run.status === "waiting_for_approval") && (
              <button
                type="button"
                onClick={() => onAction("cancel")}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-600 transition-colors hover:bg-slate-50"
              >
                <StopCircle className="h-3.5 w-3.5" /> Cancel
              </button>
            )}
            <button
              type="button"
              onClick={() => onAction("open_workflow")}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-600 transition-colors hover:bg-slate-50"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open workflow
            </button>
          </div>
        </div>

        {/* Meta grid */}
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}>
          <MetaItem label="Started" value={fmtDate(run.startedAt)} />
          <MetaItem label="Duration" value={elapsed} />
          <MetaItem label="Trigger" value={run.triggerType} />
          <MetaItem label="Environment" value={
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
              run.environment === "production" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
            )}>
              {run.environment}
            </span>
          } />
          <MetaItem label="Version" value={run.workflowVersion} />

          {viewMode === "engineering" && (
            <>
              <MetaItem label="Queue" value={<span className="font-mono text-[12px]">{run.workerQueue}</span>} />
              <MetaItem label="Retries" value={`${run.retryCount} total`} />
              <MetaItem label="Recovered" value={`${run.recoveredFailureCount} failures`} />
            </>
          )}

          <MetaItem label="Tokens" value={`${(run.totalTokens / 1000).toFixed(1)}k`} />
          <MetaItem label="Cost" value={
            <div className="flex flex-col gap-1">
              <span>${run.totalCostUsd.toFixed(3)}</span>
              <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${costPct}%`, background: costPct > 80 ? "#EF4444" : "#2563EB" }}
                />
              </div>
              <span style={{ fontSize: 10, color: "#94A3B8" }}>of ${run.budgetUsd.toFixed(2)} budget</span>
            </div>
          } />

          {run.recoveredFailureCount > 0 && (
            <MetaItem label="Recovery" value={
              <span className="flex items-center gap-1" style={{ color: "#7C3AED", fontSize: 12 }}>
                <Shield className="h-3.5 w-3.5" />
                {run.recoveredFailureCount} auto-recovered
              </span>
            } />
          )}
        </div>
      </div>
    </div>
  );
}
