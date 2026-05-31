"use client";
import type { WorkflowRun, ViewMode } from "@/types/runs";
import { Check, AlertTriangle, RefreshCw, Shield, X } from "lucide-react";

function StatCard({ icon: Icon, value, label, color }: { icon: typeof Shield; value: number | string; label: string; color: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center">
      <Icon className="mx-auto mb-2 h-6 w-6" style={{ color }} />
      <p style={{ fontSize: 24, fontWeight: 700, color: "#0F172A" }}>{value}</p>
      <p style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>{label}</p>
    </div>
  );
}

export function RecoveryTab({ run, viewMode, onAction }: { run: WorkflowRun; viewMode: ViewMode; onAction: (a: string) => void }) {
  const r = run.recoverySummary;
  return (
    <div className="space-y-5">
      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Shield} value={r.recoveredFailures} label="Failures recovered" color="#7C3AED" />
        <StatCard icon={RefreshCw} value={r.retryAttempts} label="Retry attempts" color="#D97706" />
        <StatCard icon={AlertTriangle} value={r.rateLimitEvents} label="Rate limit events" color="#EA580C" />
        <StatCard icon={r.replaySafeResumeAvailable ? Check : X} value={r.replaySafeResumeAvailable ? "Yes" : "No"} label="Replay-safe resume" color={r.replaySafeResumeAvailable ? "#059669" : "#B91C1C"} />
      </div>

      {/* Summary card */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <p style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>Recovery Summary</p>
        </div>
        <div className="p-4 space-y-3">
          {[
            { ok: r.recoveredFailures > 0, text: `${r.recoveredFailures} temporary failure${r.recoveredFailures !== 1 ? "s" : ""} recovered automatically` },
            { ok: r.rateLimitEvents > 0, text: `${r.rateLimitEvents} rate-limit event${r.rateLimitEvents !== 1 ? "s" : ""} handled with backoff` },
            { ok: true, text: `${r.workerHeartbeatMisses} worker heartbeat misses` },
            { ok: r.selfCorrectionAttempts > 0, text: `${r.selfCorrectionAttempts} self-correction attempt${r.selfCorrectionAttempts !== 1 ? "s" : ""}` },
            { ok: true, text: "No data loss detected" },
            { ok: r.replaySafeResumeAvailable, text: r.replaySafeResumeAvailable ? "Replay-safe resume available" : "Replay-safe resume unavailable" },
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <div className="mt-0.5 h-4 w-4 shrink-0 rounded-full flex items-center justify-center"
                style={{ background: item.ok ? "#ECFDF5" : "#F8FAFC" }}>
                <Check className="h-2.5 w-2.5" style={{ color: item.ok ? "#059669" : "#CBD5E1" }} />
              </div>
              <span style={{ fontSize: 13, color: "#334155" }}>{item.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Unresolved blockers */}
      {r.unresolvedBlockers.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-amber-200">
            <p style={{ fontSize: 13, fontWeight: 700, color: "#B45309" }}>Unresolved blockers</p>
          </div>
          <div className="p-4 space-y-2">
            {r.unresolvedBlockers.map((b, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                <span style={{ fontSize: 13, color: "#334155" }}>{b}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recovery actions */}
      {viewMode === "engineering" && r.replaySafeResumeAvailable && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onAction("resume")}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 text-[13px] font-semibold text-white hover:bg-[#1D4ED8] transition-colors">
            <RefreshCw className="h-3.5 w-3.5" /> Resume from checkpoint
          </button>
          <button type="button" onClick={() => onAction("continue_as_new")}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
            Continue as new run
          </button>
        </div>
      )}
    </div>
  );
}
