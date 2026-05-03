"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Route } from "next";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Clock,
  FileText,
  Loader2,
  PlayCircle,
  Shield,
  XCircle,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EvidenceRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { activeWorkspaceId } = useWorkspace();
  const [run, setRun]         = useState<CapabilityEvidenceRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [newStatus, setNewStatus] = useState<EvidenceRunStatus | "">("");
  const [updateNote, setNote] = useState("");
  const [updateError, setUE] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !activeWorkspaceId) return;
    setLoading(true);
    fetch(`/api/evidence/runs/${id}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`)
      .then((r) => r.json())
      .then((data: unknown) => {
        const d = data as CapabilityEvidenceRun & { error?: string };
        if (d.error) setError(d.error);
        else setRun(d);
      })
      .catch(() => setError("Failed to load evidence run"))
      .finally(() => setLoading(false));
  }, [id, activeWorkspaceId]);

  async function handleUpdateStatus() {
    if (!newStatus || !activeWorkspaceId) return;
    setUpdating(true);
    setUE(null);
    try {
      const res = await fetch(`/api/evidence/runs/${id}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: newStatus,
          resultSummary: updateNote || null,
          failureReason: newStatus === "failed" ? (updateNote || null) : null,
        }),
      });
      const json = (await res.json()) as CapabilityEvidenceRun & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to update");
      setRun(json);
      setNewStatus("");
      setNote("");
    } catch (e) {
      setUE(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setUpdating(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8F5EF]">
        <AppHeader title="Evidence Run" subtitle="Loading…" />
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-[#6B7280]" /></div>
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="min-h-screen bg-[#F8F5EF]">
        <AppHeader title="Evidence Run" subtitle="Not found" />
        <div className="px-4 py-12 flex flex-col items-center gap-4 text-center">
          <AlertTriangle className="h-8 w-8 text-[#C2410C]" />
          <p className="text-sm text-[#6B7280]">{error ?? "Evidence run not found"}</p>
          <Link href={"/evidence/runs" as Route} className="text-sm text-[#2563EB] hover:underline flex items-center gap-1">
            <ChevronLeft className="h-3.5 w-3.5" /> Back to Evidence Runs
          </Link>
        </div>
      </div>
    );
  }

  const cfg = STATUS_STYLE[run.status] ?? STATUS_STYLE.queued;
  const StatusIcon = cfg.icon;

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title={EVIDENCE_TYPE_LABELS[run.evidenceType] ?? run.evidenceType}
        subtitle={`${run.aiSystemName ?? "AI System"} · ${run.aiSystemVersionNumber ? `v${run.aiSystemVersionNumber}` : "No version"}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge className={`${cfg.cls} text-xs font-normal flex items-center gap-1`}>
              <StatusIcon className="h-3.5 w-3.5" />
              {cfg.label}
            </Badge>
            {run.blocking && (
              <Badge className="bg-[#FFF7ED] text-[#C2410C] text-xs font-normal flex items-center gap-1">
                <Shield className="h-3 w-3" /> Blocking
              </Badge>
            )}
          </div>
        }
      />

      <div className="px-4 py-6 md:px-6 xl:px-8 max-w-3xl space-y-5">
        {/* Back link */}
        <Link href={"/evidence/runs" as Route} className="text-sm text-[#6B7280] hover:text-[#374151] flex items-center gap-1">
          <ChevronLeft className="h-3.5 w-3.5" /> All Evidence Runs
        </Link>

        {/* Header card */}
        <Card className="border-[#E7DED1]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-[#111111]">Run details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {[
                { label: "Evidence type", value: EVIDENCE_TYPE_LABELS[run.evidenceType] ?? run.evidenceType },
                { label: "AI System", value: run.aiSystemName ?? run.aiSystemId },
                { label: "Version", value: run.aiSystemVersionNumber ? `v${run.aiSystemVersionNumber}` : "—" },
                { label: "Policy pack", value: run.policyPackName ?? "—" },
                { label: "Blocking", value: run.blocking ? "Yes" : "No" },
                { label: "Started by", value: run.startedBy },
                { label: "Started at", value: fmtDate(run.startedAt) },
                { label: "Completed at", value: fmtDate(run.completedAt) },
              ].map((f) => (
                <div key={f.label}>
                  <dt className="text-[10px] text-[#9CA3AF] uppercase tracking-wide font-semibold">{f.label}</dt>
                  <dd className="mt-0.5 text-sm text-[#111111] truncate">{f.value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        {/* Results */}
        {(run.resultSummary || run.failureReason || run.resultScore != null) && (
          <Card className="border-[#E7DED1]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-[#111111]">Results</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {run.resultScore != null && (
                <div>
                  <p className="text-[10px] text-[#9CA3AF] uppercase tracking-wide font-semibold">Score</p>
                  <p className="mt-0.5 text-2xl font-bold text-[#111111]">{Math.round(run.resultScore * 100)}%</p>
                </div>
              )}
              {run.resultSummary && (
                <div>
                  <p className="text-[10px] text-[#9CA3AF] uppercase tracking-wide font-semibold">Summary</p>
                  <p className="mt-0.5 text-sm text-[#374151]">{run.resultSummary}</p>
                </div>
              )}
              {run.failureReason && (
                <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3">
                  <p className="text-xs font-semibold text-[#991B1B] mb-1">Failure reason</p>
                  <p className="text-sm text-[#374151]">{run.failureReason}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* human_approval: link to approval request */}
        {run.evidenceType === "human_approval" && run.underlyingRunId && (
          <Card className="border-[#E7DED1]">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[#111111]">Approval request created</p>
                  <p className="text-xs text-[#6B7280] mt-0.5">Review and approve or reject this release in the Approvals page.</p>
                </div>
                <Link
                  href={"/governance/approvals" as Route}
                  className="text-sm text-[#2563EB] hover:underline flex items-center gap-1"
                >
                  View approvals <ChevronLeft className="h-3.5 w-3.5 rotate-180" />
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Update status (for manual evidence or review) */}
        {!["passed", "failed", "cancelled"].includes(run.status) && (
          <Card className="border-[#E7DED1]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-[#111111]">Update status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-[#6B7280]">
                Manually update this evidence run&apos;s status. For human-reviewed checks or external tool results.
              </p>
              <div className="flex gap-2">
                <Select value={newStatus} onChange={(e) => setNewStatus(e.target.value as EvidenceRunStatus | "")} className="text-sm flex-1">
                  <option value="">Select new status…</option>
                  {ALL_STATUSES.filter((s) => s !== run.status).map((s) => (
                    <option key={s} value={s}>{STATUS_STYLE[s].label}</option>
                  ))}
                </Select>
              </div>
              <textarea
                className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111] focus:border-[#2563EB] focus:outline-none resize-none"
                rows={2}
                placeholder={newStatus === "failed" ? "Failure reason (required)…" : "Notes or summary (optional)…"}
                value={updateNote}
                onChange={(e) => setNote(e.target.value)}
              />
              {updateError && (
                <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B]">{updateError}</div>
              )}
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={!newStatus || updating}
                  onClick={handleUpdateStatus}
                  className="flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                >
                  {updating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Update status
                </button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Raw metadata */}
        {Object.keys(run.resultMetadata ?? {}).length > 0 && (
          <Card className="border-[#E7DED1]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-[#111111]">Raw details</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-[10px] text-[#374151] bg-[#FBFAF7] rounded-lg p-3 overflow-auto max-h-48 whitespace-pre-wrap">
                {JSON.stringify(run.resultMetadata, null, 2)}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
