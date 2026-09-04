"use client";

import { useEffect, useState } from "react";
import type { WorkflowRun, ViewMode } from "@/types/runs";
import {
  CheckCircle2, ChevronDown, ChevronRight,
  RefreshCw, Shield, ShieldCheck, X, Zap,
  ArrowRight, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api/client";
import { RunOperations } from "../RunOperations";

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

// ─── Category → human label + identity colour ────────────────────────────────

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  CONNECTION_FAILURE:       { label: "Connection failure",      color: "#DC2626" },
  AUTH_FAILURE:             { label: "Authentication failure",  color: "#DC2626" },
  NETWORK_FAILURE:          { label: "Network failure",         color: "#EA580C" },
  RATE_LIMIT:               { label: "Rate limit",              color: "#D97706" },
  TIMEOUT:                  { label: "Timeout",                 color: "#D97706" },
  MAPPING_FAILURE:          { label: "Input mapping error",     color: "#7C3AED" },
  LLM_OUTPUT_INVALID:       { label: "LLM output invalid",      color: "#9333EA" },
  SCHEMA_VALIDATION_FAILURE:{ label: "Schema validation",       color: "#0891B2" },
  DB_QUERY_FAILURE:         { label: "Database query failed",   color: "#0369A1" },
  DB_WRITE_BLOCKED:         { label: "Database write blocked",  color: "#DC2626" },
  APPROVAL_REJECTED:        { label: "Approval rejected",       color: "#B45309" },
  APPROVAL_TIMEOUT:         { label: "Approval timed out",      color: "#B45309" },
  WORKER_CRASHED:           { label: "Worker crashed",          color: "#DC2626" },
  WORKFLOW_GRAPH_INVALID:   { label: "Workflow misconfigured",  color: "#DC2626" },
  RESOURCE_LIMIT_EXCEEDED:  { label: "Resource limit exceeded", color: "#D97706" },
  UNKNOWN:                  { label: "Unknown failure",         color: "#4B5563" },
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

// ─── Local primitives ─────────────────────────────────────────────────────────

function MonoLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]", className)}>
      {children}
    </p>
  );
}

/** Checkpoint diamond bullet — the durable signature. */
function DiamondBullet({ ok }: { ok: boolean }) {
  return (
    <span
      className="mt-[5px] inline-block h-[9px] w-[9px] shrink-0 rotate-45 rounded-[2px]"
      style={ok
        ? { background: "#FFFFFF", border: "2px solid #007F4E" }
        : { background: "#FFFFFF", border: "2px solid #FCA5A5" }}
    />
  );
}

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
  const severityColor = inc?.severity === "CRITICAL" || inc?.severity === "HIGH" ? "#DC2626" : "#CA8A04";

  return (
    <div className="space-y-4">

      {/* ── Diagnosis: analysing ──────────────────────────────────────────── */}
      {isFailed && incident === "loading" && (
        <div className="rounded-[12px] border border-[#E0E3E6] bg-white p-5">
          <div className="flex items-center gap-2.5">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#E0E3E6] border-t-[#007F4E]" />
            <span className="text-[13px] text-[#6B7280]">Recovery Engine analysing failure…</span>
          </div>
        </div>
      )}

      {/* ── Diagnosis card (failed runs) ──────────────────────────────────── */}
      {isFailed && inc && catMeta && capability && (
        <div className="overflow-hidden rounded-[12px] border border-[#E0E3E6] bg-white">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#ECEEEF] px-5 py-3.5">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-[8px]" style={{ background: catMeta.color }}>
                <Shield className="h-4 w-4 text-white" />
              </span>
              <div>
                <p className="text-[13.5px] font-bold tracking-[-0.01em] text-[#0B0D0F]">{catMeta.label}</p>
                <p className="font-mono text-[10.5px] text-[#9CA3AF]">{inc.code}</p>
              </div>
            </div>
            <span
              className="rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em]"
              style={{ color: severityColor, borderColor: `${severityColor}55`, background: `${severityColor}10` }}
            >
              {inc.severity}
            </span>
          </div>

          <div className="space-y-4 px-5 py-4">
            {/* What happened */}
            <div>
              <MonoLabel className="mb-1.5">What happened</MonoLabel>
              <p className="text-[13.5px] leading-[1.6] text-[#0B0D0F]">{inc.summary}</p>
            </div>

            {/* Recovery Engine response */}
            <div className="space-y-2.5 rounded-[10px] border border-[#ECEEEF] bg-[#FAFBFB] p-3.5">
              <MonoLabel>Recovery engine response</MonoLabel>
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                  style={{ background: capability.canAutoFix ? "#E6F4EF" : "#FEF2F2" }}>
                  {capability.canAutoFix
                    ? <CheckCircle2 className="h-3 w-3 text-[#007F4E]" />
                    : <X className="h-3 w-3 text-[#DC2626]" />
                  }
                </span>
                <p className="text-[12.5px] leading-[1.55] text-[#4B5563]">{capability.auto}</p>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E6F4EF]">
                  <ArrowRight className="h-3 w-3 text-[#007F4E]" />
                </span>
                <div>
                  <p className="mb-0.5 text-[11px] font-semibold text-[#6B7280]">Recommended fix</p>
                  <p className="text-[12.5px] leading-[1.55] text-[#4B5563]">{inc.recommendedAction ?? capability.manual}</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                  style={{ background: inc.retryable ? "#E6F4EF" : "#FFFBEB" }}>
                  <RefreshCw className="h-3 w-3" style={{ color: inc.retryable ? "#007F4E" : "#CA8A04" }} />
                </span>
                <p className="text-[12.5px] leading-[1.55] text-[#4B5563]">
                  {inc.retryable
                    ? "This failure type is retryable — manual retry may succeed"
                    : "Not retryable — fixing the root cause is required before retrying"}
                </p>
              </div>
            </div>

            {/* Technical detail (expandable, dark console) */}
            {inc.technicalSummary && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowTech(v => !v)}
                  className="flex items-center gap-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#007F4E] transition-colors hover:text-[#006B45]"
                >
                  {showTechnical ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  Technical detail
                </button>
                {showTechnical && (
                  <div className="mt-2 overflow-hidden rounded-[10px]" style={{ background: "#0B0D0F" }}>
                    <div className="flex items-center gap-2 border-b px-3.5 py-2" style={{ borderColor: "#1C1F22" }}>
                      <span className="h-1.5 w-1.5 rounded-full bg-[#F87171]" />
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#6B7280]">Failure trace</span>
                    </div>
                    <p className="whitespace-pre-wrap p-3.5 font-mono text-[11.5px] leading-relaxed text-[#D1D5DB]">
                      {inc.technicalSummary}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-1">
              {inc.retryable && (
                <button type="button" onClick={() => onAction("retry")}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#007F4E] px-3.5 text-[12px] font-semibold text-white transition-colors hover:bg-[#006B45]">
                  <RefreshCw className="h-3 w-3" /> Retry now
                </button>
              )}
              {r.replaySafeResumeAvailable && (
                <button type="button" onClick={() => onAction("resume")}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#9CCFBB] bg-white px-3.5 text-[12px] font-semibold text-[#006B45] transition-colors hover:bg-[#E6F4EF]">
                  <Zap className="h-3 w-3" /> Resume from checkpoint
                </button>
              )}
              {inc.resolutionStatus === "open" && (
                <button type="button" onClick={markResolved} disabled={resolving}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#E0E3E6] bg-white px-3.5 text-[12px] font-semibold text-[#4B5563] transition-colors hover:bg-[#F7F8F9] disabled:opacity-50">
                  <CheckCircle2 className="h-3 w-3" /> {resolving ? "Marking…" : "Mark resolved"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Resilience stats ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { icon: Shield,        value: r.recoveredFailures, label: "Auto-recovered",  color: "#7C3AED",
            detail: r.recoveredFailures > 0 ? "Fixed without intervention" : "No transient failures" },
          { icon: RefreshCw,     value: r.retryAttempts,     label: "Retry attempts",  color: "#CA8A04",
            detail: r.retryAttempts > 0 ? "With exponential backoff" : "No retries needed" },
          { icon: AlertTriangle, value: r.rateLimitEvents,   label: "Rate limits hit", color: "#EA580C",
            detail: r.rateLimitEvents > 0 ? "Backoff applied automatically" : "No rate limits hit" },
          { icon: r.replaySafeResumeAvailable ? ShieldCheck : X,
            value: r.replaySafeResumeAvailable ? "Yes" : "No",
            label: "Checkpoint replay",
            color: r.replaySafeResumeAvailable ? "#007F4E" : "#9CA3AF",
            detail: r.replaySafeResumeAvailable ? "Resumable from last checkpoint" : "No checkpoint for this run" },
        ].map(({ icon: Icon, value, label, color, detail }, i) => (
          <div key={i} className="rounded-[12px] border border-[#E0E3E6] bg-white p-4">
            <div className="flex items-center justify-between">
              <MonoLabel>{label}</MonoLabel>
              <span className="flex h-6 w-6 items-center justify-center rounded-[6px]" style={{ background: `${color}14`, color }}>
                <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
              </span>
            </div>
            <p className="mt-2.5 text-[24px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-[#0B0D0F]">{value}</p>
            <p className="mt-1.5 text-[11.5px] leading-[1.45] text-[#6B7280]">{detail}</p>
          </div>
        ))}
      </div>

      {/* ── Recovery capabilities ─────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-[12px] border border-[#E0E3E6] bg-white">
        <div className="border-b border-[#ECEEEF] px-5 py-4">
          <MonoLabel>Recovery engine</MonoLabel>
          <p className="mt-0.5 text-[14.5px] font-bold tracking-[-0.01em] text-[#0B0D0F]">
            Handled automatically
          </p>
          <p className="mt-0.5 text-[12.5px] text-[#6B7280]">
            Transient failures are checkpointed and recovered without intervention. Two classes need a human.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 p-4 sm:grid-cols-2">
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
            <div key={i} className="flex items-start gap-3 rounded-[8px] px-2 py-2 transition-colors hover:bg-[#FAFBFB]">
              <DiamondBullet ok={ok} />
              <div>
                <p className="flex items-center gap-2 text-[12.5px] font-semibold text-[#0B0D0F]">
                  {text}
                  {!ok && (
                    <span className="rounded-full border border-[#FECACA] bg-[#FEF2F2] px-1.5 py-px font-mono text-[8.5px] font-semibold uppercase tracking-[0.08em] text-[#B91C1C]">
                      Human
                    </span>
                  )}
                </p>
                <p className="text-[11.5px] text-[#9CA3AF]">{detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* The three operations.
          Replaces a single "Resume from checkpoint" button that sat next to a
          "Replay available" claim the backend did not honour — the replay it
          referred to re-executed everything. Each control now states what it
          calls and what it costs. See docs/architecture/REPLAY-AUDIT.md. */}
      {viewMode === "engineering" && !inc && (
        <div>
          <h4 className="mb-2 text-[12px] font-semibold text-[#111827]">Run this again</h4>
          <RunOperations
            runId={run.id}
            replayable={(r.recordedModelCalls ?? 0) > 0}
            recordedCalls={r.recordedModelCalls}
            resumable={!!r.replaySafeResumeAvailable}
            onRun={(op) => onAction(op)}
          />
        </div>
      )}
    </div>
  );
}
