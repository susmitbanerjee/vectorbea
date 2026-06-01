"use client";

import { useEffect, useState } from "react";
import type { WorkflowRun, ViewMode } from "@/types/runs";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  RefreshCw, Shield, ShieldCheck, Wrench, X, Zap, Clock,
  ArrowRight, ExternalLink, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api/client";

// ─── Failure incident from Recovery Engine ────────────────────────────────────

interface FailureIncident {
  id: string;
  runId: string;
  failedNodeId: string | null;
  category: string;
  code: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  summary: string;
  technicalSummary: string | null;
  recommendedAction: string | null;
  retryable: boolean;
  autoReplaySafe: boolean;
  requiresHumanApproval: boolean;
  resolutionStatus: "open" | "resolved";
}

// ─── Category → human label + colour ─────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  CONNECTION_FAILURE:       { label: "Connection failure",       color: "#DC2626", bg: "#FEF2F2", border: "#FECACA" },
  AUTH_FAILURE:             { label: "Authentication failure",   color: "#DC2626", bg: "#FEF2F2", border: "#FECACA" },
  NETWORK_FAILURE:          { label: "Network failure",          color: "#EA580C", bg: "#FFF7ED", border: "#FED7AA" },
  RATE_LIMIT:               { label: "Rate limit",               color: "#D97706", bg: "#FFFBEB", border: "#FDE68A" },
  TIMEOUT:                  { label: "Timeout",                  color: "#D97706", bg: "#FFFBEB", border: "#FDE68A" },
  MAPPING_FAILURE:          { label: "Input mapping error",      color: "#7C3AED", bg: "#F5F3FF", border: "#DDD6FE" },
  LLM_OUTPUT_INVALID:       { label: "LLM output invalid",       color: "#9333EA", bg: "#FAF5FF", border: "#E9D5FF" },
  SCHEMA_VALIDATION_FAILURE:{ label: "Schema validation",        color: "#0891B2", bg: "#ECFEFF", border: "#A5F3FC" },
  DB_QUERY_FAILURE:         { label: "Database query failed",    color: "#0369A1", bg: "#F0F9FF", border: "#BAE6FD" },
  DB_WRITE_BLOCKED:         { label: "Database write blocked",   color: "#DC2626", bg: "#FEF2F2", border: "#FECACA" },
  APPROVAL_REJECTED:        { label: "Approval rejected",        color: "#B45309", bg: "#FFFBEB", border: "#FDE68A" },
  APPROVAL_TIMEOUT:         { label: "Approval timed out",       color: "#B45309", bg: "#FFFBEB", border: "#FDE68A" },
  WORKER_CRASHED:           { label: "Worker crashed",           color: "#DC2626", bg: "#FEF2F2", border: "#FECACA" },
  WORKFLOW_GRAPH_INVALID:   { label: "Workflow misconfigured",   color: "#DC2626", bg: "#FEF2F2", border: "#FECACA" },
  RESOURCE_LIMIT_EXCEEDED:  { label: "Resource limit exceeded",  color: "#D97706", bg: "#FFFBEB", border: "#FDE68A" },
  UNKNOWN:                  { label: "Unknown failure",          color: "#475569", bg: "#F8FAFC", border: "#E2E8F0" },
};

// ─── What the Recovery Engine can do for each failure type ────────────────────

const RECOVERY_CAPABILITY: Record<string, { auto: string; manual: string; canAutoFix: boolean }> = {
  CONNECTION_FAILURE:       { canAutoFix: true,  auto: "Retried with exponential backoff", manual: "Check your connection configuration" },
  AUTH_FAILURE:             { canAutoFix: false, auto: "Cannot auto-fix auth errors",      manual: "Rotate the API key or fix connection credentials" },
  NETWORK_FAILURE:          { canAutoFix: true,  auto: "Retried after network backoff",    manual: "Check network reachability" },
  RATE_LIMIT:               { canAutoFix: true,  auto: "Applied rate-limit backoff",       manual: "Upgrade API tier or reduce request frequency" },
  TIMEOUT:                  { canAutoFix: true,  auto: "Retried with longer timeout",      manual: "Increase step timeout in workflow config" },
  MAPPING_FAILURE:          { canAutoFix: false, auto: "Cannot auto-fix mapping errors",   manual: "Open workflow builder and fix input mapping" },
  LLM_OUTPUT_INVALID:       { canAutoFix: true,  auto: "Self-correction attempted",        manual: "Improve the agent prompt or output schema" },
  SCHEMA_VALIDATION_FAILURE:{ canAutoFix: false, auto: "Cannot auto-fix schema errors",    manual: "Fix the output schema in the workflow node" },
  DB_QUERY_FAILURE:         { canAutoFix: true,  auto: "Retried DB query",                 manual: "Check DB connection and query syntax" },
  DB_WRITE_BLOCKED:         { canAutoFix: false, auto: "Cannot auto-fix blocked writes",   manual: "Check DB permissions and constraint rules" },
  APPROVAL_REJECTED:        { canAutoFix: false, auto: "Awaiting human decision",          manual: "Review and re-run or modify the workflow" },
  APPROVAL_TIMEOUT:         { canAutoFix: false, auto: "Approval window expired",          manual: "Adjust approval timeout or re-trigger manually" },
  WORKER_CRASHED:           { canAutoFix: true,  auto: "Replayed from last checkpoint",    manual: "Worker restarted and resumed automatically" },
  WORKFLOW_GRAPH_INVALID:   { canAutoFix: false, auto: "Config errors cannot be auto-fixed","manual": "Open workflow builder and fix the node configuration" },
  RESOURCE_LIMIT_EXCEEDED:  { canAutoFix: false, auto: "Budget/token limit reached",       manual: "Increase limits in workflow node settings" },
  UNKNOWN:                  { canAutoFix: false, auto: "Could not classify the failure",   manual: "Check the engineering view logs for details" },
};

// ─── Main component ────────────────────────────────────────────────────────────

export function RecoveryTab({ run, viewMode, onAction }: { run: WorkflowRun; viewMode: ViewMode; onAction: (a: string) => void }) {
  const r = run.recoverySummary;
  const [incident, setIncident]       = useState<FailureIncident | null | "loading">("loading");
  const [showTechnical, setShowTech]  = useState(false);
  const [resolving, setResolving]     = useState(false);

  const isFailed = ["failed", "timed_out"].includes(run.status);

  useEffect(() => {
    if (!isFailed) { setIncident(null); return; }
    apiFetch<FailureIncident | null>(`/api/runs/${run.id}/failure-incident`)
      .then(d => setIncident(d ?? null))
      .catch(() => setIncident(null));
  }, [run.id, isFailed]);

  async function markResolved() {
    if (!incident || incident === "loading") return;
    setResolving(true);
    try {
      await apiFetch(`/api/failure-incidents/${incident.id}/mark-resolved`, { method: "POST" });
      setIncident(null);
    } catch { /**/ }
    finally { setResolving(false); }
  }

  const inc = incident === "loading" ? null : incident;
  const catMeta = inc ? (CATEGORY_META[inc.category] ?? CATEGORY_META.UNKNOWN) : null;
  const capability = inc ? (RECOVERY_CAPABILITY[inc.category] ?? RECOVERY_CAPABILITY.UNKNOWN) : null;

  return (
    <div className="space-y-4">

      {/* ── Hero: Diagnosis card (only when failed) ─────────────────────── */}
      {isFailed && incident === "loading" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-500" />
            <span style={{ fontSize: 13, color: "#64748B" }}>Recovery Engine analysing failure…</span>
          </div>
        </div>
      )}

      {isFailed && inc && catMeta && capability && (
        <div className="rounded-2xl overflow-hidden" style={{ border: `1.5px solid ${catMeta.border}`, background: catMeta.bg }}>
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: `1px solid ${catMeta.border}` }}>
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl"
                style={{ background: catMeta.color + "18", border: `1px solid ${catMeta.color}30` }}>
                <Shield className="h-4 w-4" style={{ color: catMeta.color }} />
              </span>
              <div>
                <p className="text-[13.5px] font-bold" style={{ color: catMeta.color }}>
                  Recovery Engine — {catMeta.label}
                </p>
                <p className="text-[11px] font-mono" style={{ color: catMeta.color + "99" }}>
                  {inc.code}
                </p>
              </div>
            </div>
            <span
              className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
              style={{ background: catMeta.color + "18", color: catMeta.color }}
            >
              {inc.severity}
            </span>
          </div>

          {/* Diagnosis */}
          <div className="px-5 py-4 space-y-4">
            {/* What happened */}
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: catMeta.color + "aa" }}>
                What happened
              </p>
              <p style={{ fontSize: 13.5, color: "#1E293B", lineHeight: 1.6 }}>{inc.summary}</p>
            </div>

            {/* What Recovery Engine did */}
            <div className="rounded-xl border p-3.5 space-y-2.5"
              style={{ borderColor: catMeta.border, background: "#FFFFFF80" }}>
              <p className="text-[10.5px] font-semibold uppercase tracking-widest" style={{ color: "#64748B" }}>
                Recovery Engine response
              </p>
              <div className="flex items-start gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                  style={{ background: capability.canAutoFix ? "#DCFCE7" : "#FEF2F2" }}>
                  {capability.canAutoFix
                    ? <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                    : <X className="h-3 w-3 text-red-500" />
                  }
                </span>
                <p style={{ fontSize: 12.5, color: "#334155" }}>{capability.auto}</p>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-50">
                  <ArrowRight className="h-3 w-3 text-blue-500" />
                </span>
                <div>
                  <p className="text-[11px] font-semibold mb-0.5" style={{ color: "#64748B" }}>Recommended fix</p>
                  <p style={{ fontSize: 12.5, color: "#334155" }}>{inc.recommendedAction ?? capability.manual}</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                  style={{ background: inc.retryable ? "#DCFCE7" : "#FFF7ED" }}>
                  <RefreshCw className="h-3 w-3" style={{ color: inc.retryable ? "#16A34A" : "#D97706" }} />
                </span>
                <p style={{ fontSize: 12.5, color: "#334155" }}>
                  {inc.retryable
                    ? "This failure type is retryable — manual retry may succeed"
                    : "Not retryable — fixing the root cause is required before retrying"}
                </p>
              </div>
            </div>

            {/* Technical detail (expandable) */}
            {inc.technicalSummary && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowTech(v => !v)}
                  className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors hover:opacity-80"
                  style={{ color: catMeta.color + "cc" }}
                >
                  {showTechnical ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  Technical detail
                </button>
                {showTechnical && (
                  <div className="mt-2 rounded-xl border p-3 font-mono text-[11.5px] leading-relaxed"
                    style={{ borderColor: catMeta.border, background: "#FFFFFF", color: "#334155" }}>
                    {inc.technicalSummary}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-1">
              {inc.retryable && (
                <button type="button" onClick={() => onAction("retry")}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold text-white transition-colors hover:opacity-90"
                  style={{ background: catMeta.color }}>
                  <RefreshCw className="h-3 w-3" /> Retry now
                </button>
              )}
              {r.replaySafeResumeAvailable && (
                <button type="button" onClick={() => onAction("resume")}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border px-3 text-[12px] font-semibold transition-colors hover:bg-white"
                  style={{ borderColor: catMeta.border, color: catMeta.color }}>
                  <Zap className="h-3 w-3" /> Resume from checkpoint
                </button>
              )}
              {inc.resolutionStatus === "open" && (
                <button type="button" onClick={markResolved} disabled={resolving}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50">
                  <CheckCircle2 className="h-3 w-3" /> {resolving ? "Marking…" : "Mark resolved"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Stats grid ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { icon: Shield,       value: r.recoveredFailures,      label: "Auto-recovered",    color: "#7C3AED",
            detail: r.recoveredFailures > 0 ? "Vectorbea fixed these without you." : "No transient failures this run." },
          { icon: RefreshCw,    value: r.retryAttempts,          label: "Retry attempts",    color: "#D97706",
            detail: r.retryAttempts > 0 ? "With exponential backoff." : "No retries needed." },
          { icon: AlertTriangle,value: r.rateLimitEvents,        label: "Rate limits hit",   color: "#EA580C",
            detail: r.rateLimitEvents > 0 ? "Backoff applied automatically." : "No rate limits hit." },
          { icon: r.replaySafeResumeAvailable ? ShieldCheck : X,
            value: r.replaySafeResumeAvailable ? "Yes" : "No",
            label: "Checkpoint replay",
            color: r.replaySafeResumeAvailable ? "#059669" : "#94A3B8",
            detail: r.replaySafeResumeAvailable ? "Can resume without re-running completed steps." : "No checkpoint available for this run." },
        ].map(({ icon: Icon, value, label, color, detail }, i) => (
          <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4 text-center group relative"
            title={detail}>
            <Icon className="mx-auto mb-1.5 h-5 w-5" style={{ color }} />
            <p style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", lineHeight: 1 }}>{value}</p>
            <p style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>{label}</p>
            {/* Tooltip */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block
              whitespace-nowrap rounded-lg bg-slate-800 px-3 py-1.5 text-[11px] text-white shadow-lg z-10">
              {detail}
            </div>
          </div>
        ))}
      </div>

      {/* ── Recovery capabilities ─────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2"
          style={{ background: "#F8FAFC" }}>
          <Info className="h-3.5 w-3.5 text-blue-500" />
          <p style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>
            What Vectorbea Recovery Engine handles automatically
          </p>
        </div>
        <div className="p-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[
            { ok: true,  text: "API rate limits",      detail: "Detects 429s, backs off, retries" },
            { ok: true,  text: "Network timeouts",     detail: "Retries with jitter & backoff" },
            { ok: true,  text: "Worker crashes",       detail: "Replays from last checkpoint" },
            { ok: true,  text: "Transient DB errors",  detail: "Retries read/write operations" },
            { ok: true,  text: "Stale runs",           detail: "Recovery loop reclaims abandoned jobs" },
            { ok: true,  text: "LLM output errors",    detail: "Self-correction with prompt feedback" },
            { ok: false, text: "Auth / credential errors", detail: "Requires human to rotate key" },
            { ok: false, text: "Config errors",        detail: "Requires fixing the workflow builder" },
          ].map(({ ok, text, detail }, i) => (
            <div key={i} className="flex items-start gap-2.5 py-1.5 px-2 rounded-lg hover:bg-slate-50 transition-colors">
              <span className="flex h-5 w-5 shrink-0 mt-0.5 items-center justify-center rounded-full"
                style={{ background: ok ? "#DCFCE7" : "#FEF2F2" }}>
                {ok
                  ? <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  : <X className="h-3 w-3 text-red-400" />
                }
              </span>
              <div>
                <p style={{ fontSize: 12.5, fontWeight: 600, color: "#1E293B" }}>{text}</p>
                <p style={{ fontSize: 11, color: "#64748B" }}>{detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Replay action */}
      {viewMode === "engineering" && r.replaySafeResumeAvailable && !inc && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onAction("resume")}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 text-[13px] font-semibold text-white hover:bg-[#1D4ED8] transition-colors">
            <RefreshCw className="h-3.5 w-3.5" /> Resume from checkpoint
          </button>
        </div>
      )}
    </div>
  );
}
