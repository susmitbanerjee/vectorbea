"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Route } from "next";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  PlayCircle,
  RefreshCw,
  Shield,
  ShieldX,
  XCircle,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  CapabilityVersion,
  EvidenceType,
  ReleaseGateCheck,
  ReleaseGateResult,
  ReleaseGateStatus,
} from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DECISION_CFG: Record<ReleaseGateStatus, { label: string; cls: string; icon: typeof CheckCircle2; detail: string }> = {
  safe_to_release: {
    label: "Safe to Release",
    cls: "bg-[#ECFDF5] text-[#065F46]",
    icon: CheckCircle2,
    detail: "All required checks passed. This version is ready to activate.",
  },
  needs_review: {
    label: "Needs Review",
    cls: "bg-[#FFFBEB] text-[#92400E]",
    icon: AlertTriangle,
    detail: "One or more checks require human review before release.",
  },
  blocked: {
    label: "Blocked",
    cls: "bg-[#FEF2F2] text-[#991B1B]",
    icon: XCircle,
    detail: "One or more blocking checks have failed. Fix issues before releasing.",
  },
  missing_evidence: {
    label: "Missing Evidence",
    cls: "bg-[#FFF7ED] text-[#C2410C]",
    icon: ShieldX,
    detail: "Required evidence has not been collected for this version.",
  },
};

const CHECK_ICON: Record<ReleaseGateCheck["status"], React.ElementType> = {
  pass:    CheckCircle2,
  fail:    XCircle,
  missing: ShieldX,
  pending: Clock,
};

const CHECK_COLOR: Record<ReleaseGateCheck["status"], string> = {
  pass:    "text-[#065F46]",
  fail:    "text-[#991B1B]",
  missing: "text-[#C2410C]",
  pending: "text-[#92400E]",
};

const EVIDENCE_TYPE_LABELS: Record<string, string> = {
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
  incident_check:       "Incident Check",
  policy_check:         "Policy Check",
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReleaseGateDetailPage() {
  const { versionId } = useParams<{ versionId: string }>();
  const { activeWorkspaceId } = useWorkspace();
  const [gate, setGate]     = useState<ReleaseGateResult | null>(null);
  const [version, setVer]   = useState<CapabilityVersion | null>(null);
  const [loading, setLoad]  = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [activating, setAct] = useState(false);
  const [activateError, setActErr] = useState<string | null>(null);
  const [activateSuccess, setActOk] = useState(false);

  const loadGate = useCallback(() => {
    if (!versionId || !activeWorkspaceId) return;
    setLoad(true);
    setError(null);

    // Load version info and gate in parallel
    // We need the systemId to call the gate API
    fetch(`/api/evidence/runs?workspaceId=${encodeURIComponent(activeWorkspaceId)}&versionId=${encodeURIComponent(versionId)}&limit=1`)
      .catch(() => null); // warm up, ignore

    // First get the version to get aiSystemId
    const supaQuery = `/api/registry/systems/unknown/versions/${versionId}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`;
    // We don't know the system id, so we use a dedicated gate-by-versionId approach
    // The gate API uses versionId directly: /api/registry/systems/[id]/versions/[versionId]/gate
    // We need to find the system ID first — use a helper endpoint
    fetch(`/api/evidence/gate?workspaceId=${encodeURIComponent(activeWorkspaceId)}&versionId=${encodeURIComponent(versionId)}`)
      .then((r) => r.json())
      .then((data: unknown) => {
        const d = data as (ReleaseGateResult & { error?: string; version?: CapabilityVersion });
        if (d.error) setError(d.error);
        else {
          setGate(d);
          if (d.version) setVer(d.version);
        }
      })
      .catch(() => setError("Failed to load release gate"))
      .finally(() => setLoad(false));
  }, [versionId, activeWorkspaceId]);

  useEffect(() => { loadGate(); }, [loadGate]);

  async function handleActivate() {
    if (!gate || !activeWorkspaceId) return;
    setAct(true);
    setActErr(null);
    try {
      const res = await fetch(
        `/api/registry/systems/${gate.aiSystemId}/versions/${versionId}/activate?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
        { method: "POST" },
      );
      const json = (await res.json()) as { error?: string; decision?: string; reasons?: string[] };
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to activate");
      }
      setActOk(true);
      loadGate();
    } catch (e) {
      setActErr(e instanceof Error ? e.message : "Failed to activate");
    } finally {
      setAct(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8F5EF]">
        <AppHeader title="Release Gate" subtitle="Evaluating…" />
        <div className="flex flex-col items-center gap-3 py-20">
          <Loader2 className="h-6 w-6 animate-spin text-[#2563EB]" />
          <p className="text-sm text-[#6B7280]">Computing release gate decision…</p>
        </div>
      </div>
    );
  }

  if (error || !gate) {
    return (
      <div className="min-h-screen bg-[#F8F5EF]">
        <AppHeader title="Release Gate" subtitle="Error" />
        <div className="px-4 py-12 flex flex-col items-center gap-4 text-center">
          <AlertTriangle className="h-8 w-8 text-[#C2410C]" />
          <p className="text-sm text-[#6B7280]">{error ?? "Release gate not found"}</p>
          <Link href={"/release-gates" as Route} className="text-sm text-[#2563EB] hover:underline flex items-center gap-1">
            <ChevronLeft className="h-3.5 w-3.5" /> Back to Release Gates
          </Link>
        </div>
      </div>
    );
  }

  const decisionCfg = DECISION_CFG[gate.decision];
  const DecisionIcon = decisionCfg.icon;

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="Release Gate"
        subtitle={version ? `${version.versionNumber} · ${version.capabilityId ?? ""}` : `Version ${versionId.slice(0, 8)}`}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={loadGate}
              className="flex items-center gap-1.5 rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm text-[#374151] hover:bg-[#F8F5EF]"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          </div>
        }
      />

      <div className="px-4 py-6 md:px-6 xl:px-8 max-w-3xl space-y-5">
        {/* Back */}
        <Link href={"/release-gates" as Route} className="text-sm text-[#6B7280] hover:text-[#374151] flex items-center gap-1">
          <ChevronLeft className="h-3.5 w-3.5" /> Release Gates
        </Link>

        {/* Decision card */}
        <div className={`rounded-xl border-2 p-5 ${gate.decision === "safe_to_release" ? "border-[#6EE7B7] bg-[#ECFDF5]" : gate.decision === "blocked" ? "border-[#FECACA] bg-[#FEF2F2]" : gate.decision === "missing_evidence" ? "border-[#FED7AA] bg-[#FFF7ED]" : "border-[#FDE68A] bg-[#FFFBEB]"}`}>
          <div className="flex items-center gap-3">
            <div className={`rounded-full p-2.5 ${gate.decision === "safe_to_release" ? "bg-[#D1FAE5]" : gate.decision === "blocked" ? "bg-[#FEE2E2]" : gate.decision === "missing_evidence" ? "bg-[#FFEDD5]" : "bg-[#FEF3C7]"}`}>
              <DecisionIcon className={`h-5 w-5 ${decisionCfg.cls.split(" ")[1]}`} />
            </div>
            <div>
              <h2 className={`text-lg font-bold ${decisionCfg.cls.split(" ")[1]}`}>{decisionCfg.label}</h2>
              <p className="text-sm text-[#374151] mt-0.5">{decisionCfg.detail}</p>
            </div>
          </div>

          {gate.reasons.length > 0 && (
            <ul className="mt-4 space-y-1.5">
              {gate.reasons.map((reason, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-[#374151]">
                  <XCircle className="h-4 w-4 text-[#C2410C] flex-shrink-0 mt-0.5" />
                  {reason}
                </li>
              ))}
            </ul>
          )}

          {/* Activation CTA */}
          {gate.decision === "safe_to_release" && !activateSuccess && (
            <div className="mt-4 pt-4 border-t border-[#A7F3D0]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-[#065F46] font-medium">Ready to activate this version?</p>
                <button
                  onClick={handleActivate}
                  disabled={activating}
                  className="flex items-center gap-1.5 rounded-xl bg-[#059669] px-4 py-2 text-sm font-semibold text-white hover:bg-[#047857] disabled:opacity-50"
                >
                  {activating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="h-3.5 w-3.5" />}
                  Activate version
                </button>
              </div>
              {activateError && <p className="mt-2 text-sm text-[#991B1B]">{activateError}</p>}
            </div>
          )}

          {activateSuccess && (
            <div className="mt-4 pt-4 border-t border-[#A7F3D0] flex items-center gap-2 text-[#065F46]">
              <CheckCircle2 className="h-4 w-4" />
              <p className="text-sm font-medium">Version activated successfully!</p>
            </div>
          )}

          {/* Pending approval CTA */}
          {gate.decision === "needs_review" && gate.checks.some((c) => c.evidenceType === "human_approval" && (c.status === "pending" || c.status === "missing")) && (
            <div className="mt-4 pt-4 border-t border-[#FDE68A]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-[#92400E]">Human approval required to proceed.</p>
                <Link
                  href={"/governance/approvals" as Route}
                  className="flex items-center gap-1.5 rounded-xl border border-[#D97706] px-4 py-2 text-sm font-semibold text-[#92400E] hover:bg-[#FEF3C7]"
                >
                  <BadgeCheck className="h-3.5 w-3.5" /> Review approvals
                </Link>
              </div>
            </div>
          )}

          {/* Missing evidence CTA */}
          {gate.decision === "missing_evidence" && (
            <div className="mt-4 pt-4 border-t border-[#FED7AA]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-[#C2410C]">Collect missing evidence to unblock this release.</p>
                <Link
                  href={`/registry/systems/${gate.aiSystemId}` as Route}
                  className="flex items-center gap-1.5 rounded-xl border border-[#F97316] px-4 py-2 text-sm font-semibold text-[#C2410C] hover:bg-[#FFEDD5]"
                >
                  Run checks <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Gate checks */}
        <Card className="border-[#E7DED1]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-[#111111]">Gate checks</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {gate.checks.map((check, i) => {
              const CkIcon = CHECK_ICON[check.status];
              return (
                <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-[#F1ECE3] last:border-0">
                  <CkIcon className={`h-4 w-4 flex-shrink-0 ${CHECK_COLOR[check.status]}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-[#111111]">{check.label}</p>
                      {check.blocking && <Badge className="bg-[#FFF7ED] text-[#C2410C] text-[10px] font-normal">blocking</Badge>}
                      <span className="text-[10px] text-[#9CA3AF]">{EVIDENCE_TYPE_LABELS[check.evidenceType] ?? check.evidenceType}</span>
                    </div>
                    {check.detail && <p className="text-xs text-[#6B7280] mt-0.5">{check.detail}</p>}
                  </div>
                  {check.evidenceRunId && (
                    <Link
                      href={`/evidence/runs/${check.evidenceRunId}` as Route}
                      className="text-xs text-[#2563EB] hover:underline flex items-center gap-1 flex-shrink-0"
                    >
                      View run <ChevronRight className="h-3 w-3" />
                    </Link>
                  )}
                  {check.approvalRequestId && !check.evidenceRunId && (
                    <Link
                      href={"/governance/approvals" as Route}
                      className="text-xs text-[#2563EB] hover:underline flex items-center gap-1 flex-shrink-0"
                    >
                      View approval <ChevronRight className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Footer meta */}
        <p className="text-[10px] text-[#9CA3AF] text-center">
          Gate evaluated {fmtDate(gate.evaluatedAt)} · Refresh to recompute
        </p>
      </div>
    </div>
  );
}
