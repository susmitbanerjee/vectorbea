"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Loader2,
  PlayCircle,
  XCircle,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import type { CapabilityEvidenceRun, EvidenceRunStatus, EvidenceType } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

// ─── Constants ────────────────────────────────────────────────────────────────

const EVIDENCE_TYPE_LABELS: Record<EvidenceType, string> = {
  prompt_check:         "Prompt Check",
  deterministic_check:  "Deterministic Check",
  behavioral_check:     "Behavioral Check",
  rag_grounding_check:  "RAG Grounding Check",
  mcp_tool_policy_check:"MCP Tool Policy Check",
  workflow_regression:  "Workflow Regression",
  provider_comparison:  "Provider Comparison",
  human_approval:       "Human Approval",
  privacy_check:        "Privacy Check",
  security_check:       "Security Check",
};

const STATUS_STYLE: Record<EvidenceRunStatus, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  queued:       { label: "Queued",       cls: "bg-[#F3F4F6] text-[#374151]",   icon: Clock },
  running:      { label: "Running",      cls: "bg-[#EFF6FF] text-[#1D4ED8]",   icon: PlayCircle },
  passed:       { label: "Passed",       cls: "bg-[#ECFDF5] text-[#065F46]",   icon: CheckCircle2 },
  failed:       { label: "Failed",       cls: "bg-[#FEF2F2] text-[#991B1B]",   icon: XCircle },
  needs_review: { label: "Needs Review", cls: "bg-[#FFFBEB] text-[#92400E]",   icon: AlertTriangle },
  cancelled:    { label: "Cancelled",    cls: "bg-[#F3F4F6] text-[#9CA3AF]",   icon: XCircle },
  timed_out:    { label: "Timed Out",    cls: "bg-[#FFF7ED] text-[#C2410C]",   icon: AlertTriangle },
};

const ALL_STATUSES: EvidenceRunStatus[] = ["queued","running","passed","failed","needs_review","cancelled","timed_out"];
const ALL_TYPES: EvidenceType[] = [
  "prompt_check","deterministic_check","behavioral_check","rag_grounding_check",
  "mcp_tool_policy_check","workflow_regression","provider_comparison",
  "human_approval","privacy_check","security_check",
];

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EvidenceRunsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [runs, setRuns]       = useState<CapabilityEvidenceRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [statusF, setStatusF] = useState<EvidenceRunStatus | "all">("all");
  const [typeF, setTypeF]     = useState<EvidenceType | "all">("all");

  useEffect(() => {
    if (!activeWorkspaceId) { setLoading(false); return; }
    setLoading(true);
    let url = `/api/evidence/runs?workspaceId=${encodeURIComponent(activeWorkspaceId)}`;
    if (statusF !== "all") url += `&status=${encodeURIComponent(statusF)}`;
    if (typeF !== "all") url += `&evidenceType=${encodeURIComponent(typeF)}`;
    fetch(url)
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setRuns(data as CapabilityEvidenceRun[]);
        else setError((data as { error?: string }).error ?? "Failed to load");
      })
      .catch(() => setError("Failed to load evidence runs"))
      .finally(() => setLoading(false));
  }, [activeWorkspaceId, statusF, typeF]);

  const counts = {
    total:       runs.length,
    passed:      runs.filter((r) => r.status === "passed").length,
    failed:      runs.filter((r) => r.status === "failed").length,
    needs_review: runs.filter((r) => r.status === "needs_review").length,
    queued:      runs.filter((r) => r.status === "queued" || r.status === "running").length,
  };

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="Evidence Runs"
        subtitle="All evidence checks collected for AI system governance decisions"
        actions={
          <Link
            href={"/registry/systems" as Route}
            className="flex items-center gap-1.5 rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm text-[#374151] hover:bg-[#F8F5EF]"
          >
            Run from AI System
          </Link>
        }
      />

      <div className="px-4 py-6 md:px-6 xl:px-8 space-y-5">
        {/* Summary strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total runs",    value: counts.total,        color: "text-[#111111]" },
            { label: "Passed",        value: counts.passed,       color: "text-[#065F46]" },
            { label: "Failed",        value: counts.failed,       color: "text-[#991B1B]" },
            { label: "Needs review",  value: counts.needs_review, color: "text-[#92400E]" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-[#E7DED1] bg-white px-4 py-3">
              <p className={`text-2xl font-bold ${stat.color}`}>{loading ? "—" : stat.value}</p>
              <p className="text-xs text-[#6B7280] mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <Select value={statusF} onChange={(e) => setStatusF(e.target.value as EvidenceRunStatus | "all")} className="text-xs w-36">
            <option value="all">All statuses</option>
            {ALL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_STYLE[s].label}</option>)}
          </Select>
          <Select value={typeF} onChange={(e) => setTypeF(e.target.value as EvidenceType | "all")} className="text-xs w-44">
            <option value="all">All evidence types</option>
            {ALL_TYPES.map((t) => <option key={t} value={t}>{EVIDENCE_TYPE_LABELS[t]}</option>)}
          </Select>
          {(statusF !== "all" || typeF !== "all") && (
            <button onClick={() => { setStatusF("all"); setTypeF("all"); }} className="text-xs text-[#6B7280] hover:text-[#374151] underline">
              Clear filters
            </button>
          )}
        </div>

        {/* Table */}
        <div className="rounded-xl border border-[#E7DED1] bg-white overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[1fr_140px_120px_100px_90px_100px_32px] gap-3 px-4 py-2 border-b border-[#F1ECE3] bg-[#FBFAF7] text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wide">
            <span>AI System / Version</span>
            <span className="hidden sm:block">Evidence Type</span>
            <span className="hidden md:block">Policy</span>
            <span>Status</span>
            <span className="hidden md:block">Score</span>
            <span className="hidden sm:block">Completed</span>
            <span />
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#6B7280]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading evidence runs…
            </div>
          )}

          {!loading && error && (
            <div className="flex items-center gap-2 px-4 py-8 text-sm text-[#991B1B]">
              <AlertTriangle className="h-4 w-4" /> {error}
            </div>
          )}

          {!loading && !error && runs.length === 0 && (
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              <div className="rounded-full bg-[#EFF6FF] p-4">
                <FileText className="h-8 w-8 text-[#2563EB]" />
              </div>
              <div>
                <p className="font-semibold text-[#111111]">No evidence runs yet</p>
                <p className="text-sm text-[#6B7280] mt-1">
                  No evidence has been collected for this version yet. Run required checks from an AI System&apos;s Required Evidence tab.
                </p>
              </div>
              <Link
                href={"/registry/systems" as Route}
                className="rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
              >
                Go to AI Registry
              </Link>
            </div>
          )}

          {!loading && !error && runs.map((run) => {
            const cfg = STATUS_STYLE[run.status] ?? STATUS_STYLE.queued;
            const StatusIcon = cfg.icon;
            return (
              <Link
                key={run.id}
                href={`/evidence/runs/${run.id}` as Route}
                className="group grid grid-cols-[1fr_140px_120px_100px_90px_100px_32px] gap-3 px-4 py-3 border-b border-[#F1ECE3] last:border-0 hover:bg-[#FBFAF7] items-center transition-colors"
              >
                {/* System + version */}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#111111] truncate">{run.aiSystemName ?? run.aiSystemId.slice(0, 8)}</p>
                  <p className="text-[10px] text-[#9CA3AF]">
                    {run.aiSystemVersionNumber ? `v${run.aiSystemVersionNumber}` : "—"}
                    {run.blocking ? <span className="ml-2 text-[#C2410C]">blocking</span> : <span className="ml-2 text-[#9CA3AF]">non-blocking</span>}
                  </p>
                </div>
                {/* Type */}
                <span className="hidden sm:block text-xs text-[#374151] truncate">
                  {EVIDENCE_TYPE_LABELS[run.evidenceType] ?? run.evidenceType}
                </span>
                {/* Policy */}
                <span className="hidden md:block text-xs text-[#6B7280] truncate">
                  {run.policyPackName ?? "—"}
                </span>
                {/* Status */}
                <Badge className={`${cfg.cls} text-[10px] font-normal flex items-center gap-1 w-fit`}>
                  <StatusIcon className="h-3 w-3" />
                  {cfg.label}
                </Badge>
                {/* Score */}
                <span className="hidden md:block text-xs text-[#374151]">
                  {run.resultScore != null ? `${Math.round(run.resultScore * 100)}%` : "—"}
                </span>
                {/* Completed */}
                <span className="hidden sm:block text-[10px] text-[#9CA3AF]">
                  {run.completedAt ? fmtDate(run.completedAt) : run.startedAt ? fmtDate(run.startedAt) : "—"}
                </span>
                <ChevronRight className="h-4 w-4 text-[#D1C9BD] group-hover:text-[#2563EB]" />
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
