"use client";

import { useEffect, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import {
  BarChart3,
  ClipboardList,
  Download,
  Loader2,
  Scale,
  Shield,
  Siren,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  AiCapability,
  AiIncident,
  ApprovalRequest,
  AuditEvent,
  CapabilityEvidenceRun,
  PolicyPack,
} from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Report section wrapper ───────────────────────────────────────────────────

function ReportSection({
  icon: Icon,
  title,
  subtitle,
  onExport,
  loading,
  children,
}: {
  icon: typeof Shield;
  title: string;
  subtitle: string;
  onExport?: () => void;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-[#E7DED1]">
      <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#EFF6FF]">
            <Icon className="h-4 w-4 text-[#2563EB]" />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold text-[#111111]">{title}</CardTitle>
            <p className="text-xs text-[#6B7280] mt-0.5">{subtitle}</p>
          </div>
        </div>
        {onExport && (
          <button
            type="button"
            onClick={onExport}
            disabled={loading}
            className="flex items-center gap-1 rounded-lg border border-[#E7DED1] bg-white px-2.5 py-1.5 text-xs text-[#374151] hover:bg-[#F8F5EF] disabled:opacity-40 shrink-0"
          >
            <Download className="h-3 w-3" /> Export
          </button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-[#6B7280]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : children}
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GovernanceReportsPage() {
  const { activeWorkspaceId } = useWorkspace();

  const [systems,   setSystems]   = useState<AiCapability[]>([]);
  const [runs,      setRuns]      = useState<CapabilityEvidenceRun[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [incidents, setIncidents] = useState<AiIncident[]>([]);
  const [auditEvts, setAuditEvts] = useState<AuditEvent[]>([]);
  const [policies,  setPolicies]  = useState<PolicyPack[]>([]);

  const [loadSys,  setLoadSys]  = useState(true);
  const [loadRuns, setLoadRuns] = useState(true);
  const [loadApp,  setLoadApp]  = useState(true);
  const [loadInc,  setLoadInc]  = useState(true);
  const [loadAud,  setLoadAud]  = useState(true);
  const [loadPol,  setLoadPol]  = useState(true);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    const ws = encodeURIComponent(activeWorkspaceId);

    fetch(`/api/registry/systems?workspaceId=${ws}`).then((r) => r.json()).then((d: unknown) => { if (Array.isArray(d)) setSystems(d as AiCapability[]); }).finally(() => setLoadSys(false));
    fetch(`/api/evidence/runs?workspaceId=${ws}&limit=200`).then((r) => r.json()).then((d: unknown) => { if (Array.isArray(d)) setRuns(d as CapabilityEvidenceRun[]); }).finally(() => setLoadRuns(false));
    fetch(`/api/governance/approvals?workspaceId=${ws}`).then((r) => r.json()).then((d: unknown) => { if (Array.isArray(d)) setApprovals(d as ApprovalRequest[]); }).finally(() => setLoadApp(false));
    fetch(`/api/incidents?workspaceId=${ws}`).then((r) => r.json()).then((d: unknown) => { if (Array.isArray(d)) setIncidents(d as AiIncident[]); }).finally(() => setLoadInc(false));
    fetch(`/api/governance/audit?workspaceId=${ws}`).then((r) => r.json()).then((d: unknown) => { if (Array.isArray(d)) setAuditEvts(d as AuditEvent[]); }).finally(() => setLoadAud(false));
    fetch(`/api/governance/policy-packs?workspaceId=${ws}`).then((r) => r.json()).then((d: unknown) => { if (Array.isArray(d)) setPolicies(d as PolicyPack[]); }).finally(() => setLoadPol(false));
  }, [activeWorkspaceId]);

  // ── Derived stats ──────────────────────────────────────────────────────────

  const highRiskSystems = systems.filter((s) => s.riskLevel === "high" || s.riskLevel === "critical");
  const runsPassed      = runs.filter((r) => r.status === "passed");
  const runsFailed      = runs.filter((r) => r.status === "failed");
  const pendingAppvs    = approvals.filter((a) => a.status === "pending");
  const openIncidents   = incidents.filter((i) => i.status === "open" || i.status === "investigating");
  const criticalInc     = incidents.filter((i) => i.severity === "critical");
  const blockedEvts     = auditEvts.filter((e) => e.eventType === "release_blocked");

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="Reports"
        subtitle="Audit-ready governance reports for AI system releases"
      />

      <div className="px-4 py-6 md:px-6 xl:px-8 space-y-5">

        {/* ── 1. AI System Governance Report ─────────────────────────────── */}
        <ReportSection
          icon={Shield}
          title="AI System Governance"
          subtitle="Registration, risk classification, and policy coverage for all AI systems"
          onExport={() => downloadJson("ai-system-governance.json", systems)}
          loading={loadSys}
        >
          {systems.length === 0 ? (
            <p className="text-sm text-[#6B7280] py-4 text-center">No AI systems registered.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {[
                  { label: "Total systems",  value: systems.length,          color: "text-[#111111]" },
                  { label: "High / Critical", value: highRiskSystems.length,  color: "text-[#991B1B]" },
                  { label: "Active",         value: systems.filter((s) => s.activeVersion?.id).length, color: "text-[#065F46]" },
                  { label: "With policy",    value: systems.filter((s) => (s.assignedPolicyPackIds?.length ?? 0) > 0).length, color: "text-[#1D4ED8]" },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2">
                    <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
                    <p className="text-[10px] text-[#9CA3AF] mt-0.5">{stat.label}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-[#E7DED1] overflow-hidden">
                <div className="grid grid-cols-[1fr_80px_80px_100px] gap-3 px-3 py-2 bg-[#FBFAF7] border-b border-[#F1ECE3] text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wide">
                  <span>System</span><span>Type</span><span>Risk</span><span>Status</span>
                </div>
                {systems.slice(0, 10).map((s) => (
                  <div key={s.id} className="grid grid-cols-[1fr_80px_80px_100px] gap-3 px-3 py-2 border-b border-[#F1ECE3] last:border-0 text-xs items-center">
                    <Link href={`/registry/systems/${s.id}` as Route} className="text-[#2563EB] hover:underline truncate">{s.name}</Link>
                    <span className="text-[#374151]">{s.type}</span>
                    <Badge className={s.riskLevel === "critical" || s.riskLevel === "high" ? "bg-[#FEF2F2] text-[#991B1B] text-[10px] font-normal" : "bg-[#F3F4F6] text-[#374151] text-[10px] font-normal"}>{s.riskLevel ?? "—"}</Badge>
                    <span className="text-[#374151]">{s.activeVersion?.id ? "Active" : "No active ver."}</span>
                  </div>
                ))}
                {systems.length > 10 && <p className="px-3 py-2 text-xs text-[#9CA3AF]">+ {systems.length - 10} more — export for full list</p>}
              </div>
            </>
          )}
        </ReportSection>

        {/* ── 2. Release Evidence Report ─────────────────────────────────── */}
        <ReportSection
          icon={ClipboardList}
          title="Release Evidence"
          subtitle="Pass/fail summary of all evidence checks across AI systems"
          onExport={() => downloadJson("release-evidence.json", runs)}
          loading={loadRuns}
        >
          {runs.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-[#6B7280]">No evidence runs yet.</p>
              <Link href={"/evidence/runs" as Route} className="mt-2 inline-block text-xs text-[#2563EB] hover:underline">View Evidence Runs →</Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="rounded-xl border border-[#E7DED1] bg-[#ECFDF5] px-3 py-2">
                  <p className="text-xl font-bold text-[#065F46]">{runsPassed.length}</p>
                  <p className="text-[10px] text-[#065F46] mt-0.5">Passed</p>
                </div>
                <div className="rounded-xl border border-[#E7DED1] bg-[#FEF2F2] px-3 py-2">
                  <p className="text-xl font-bold text-[#991B1B]">{runsFailed.length}</p>
                  <p className="text-[10px] text-[#991B1B] mt-0.5">Failed</p>
                </div>
                <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2">
                  <p className="text-xl font-bold text-[#111111]">{runs.length}</p>
                  <p className="text-[10px] text-[#9CA3AF] mt-0.5">Total</p>
                </div>
              </div>
              <div className="rounded-xl border border-[#E7DED1] overflow-hidden">
                <div className="grid grid-cols-[1fr_140px_90px_100px] gap-3 px-3 py-2 bg-[#FBFAF7] border-b border-[#F1ECE3] text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wide">
                  <span>System</span><span>Evidence type</span><span>Status</span><span>Completed</span>
                </div>
                {runs.slice(0, 10).map((r) => (
                  <div key={r.id} className="grid grid-cols-[1fr_140px_90px_100px] gap-3 px-3 py-2 border-b border-[#F1ECE3] last:border-0 text-xs items-center">
                    <Link href={`/evidence/runs/${r.id}` as Route} className="text-[#2563EB] hover:underline truncate">{r.aiSystemName ?? r.aiSystemId.slice(0, 8)}</Link>
                    <span className="text-[#374151] truncate">{r.evidenceType.replaceAll("_", " ")}</span>
                    <Badge className={r.status === "passed" ? "bg-[#ECFDF5] text-[#065F46] text-[10px] font-normal" : r.status === "failed" ? "bg-[#FEF2F2] text-[#991B1B] text-[10px] font-normal" : "bg-[#F3F4F6] text-[#374151] text-[10px] font-normal"}>{r.status}</Badge>
                    <span className="text-[#9CA3AF]">{fmtDate(r.completedAt)}</span>
                  </div>
                ))}
                {runs.length > 10 && <p className="px-3 py-2 text-xs text-[#9CA3AF]">+ {runs.length - 10} more — export for full list</p>}
              </div>
            </>
          )}
        </ReportSection>

        {/* ── 3. Policy Compliance Report ────────────────────────────────── */}
        <ReportSection
          icon={Scale}
          title="Policy Compliance"
          subtitle="Policy pack coverage and rule compliance across registered AI systems"
          onExport={() => downloadJson("policy-compliance.json", { policies, systems })}
          loading={loadPol || loadSys}
        >
          {policies.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-[#6B7280]">No policy packs configured.</p>
              <Link href={"/governance/policy-packs" as Route} className="mt-2 inline-block text-xs text-[#2563EB] hover:underline">Configure Policies →</Link>
            </div>
          ) : (
            <div className="space-y-3">
              {policies.map((p) => {
                const assignedCount = systems.filter((s) => s.assignedPolicyPackIds?.includes(p.id)).length;
                return (
                  <div key={p.id} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-[#111111]">{p.name}</p>
                        <p className="text-xs text-[#6B7280] mt-0.5">v{p.version} · {p.sector}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-[#111111]">{assignedCount}</p>
                        <p className="text-[10px] text-[#9CA3AF]">systems</p>
                      </div>
                    </div>
                    {Array.isArray(p.requiredEvidence) && p.requiredEvidence.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(p.requiredEvidence as Array<{ evidenceType: string }>).map((e) => (
                          <span key={e.evidenceType} className="rounded-full bg-[#EFF6FF] px-2 py-0.5 text-[10px] text-[#1D4ED8]">
                            {e.evidenceType.replaceAll("_", " ")}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ReportSection>

        {/* ── 4. Incident Report ─────────────────────────────────────────── */}
        <ReportSection
          icon={Siren}
          title="Incident Report"
          subtitle="Open, investigating, and resolved incidents with severity breakdown"
          onExport={() => downloadJson("incident-report.json", incidents)}
          loading={loadInc}
        >
          {incidents.length === 0 ? (
            <p className="text-sm text-[#6B7280] py-4 text-center">No incidents recorded.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {[
                  { label: "Open",     value: openIncidents.length,         color: "text-[#991B1B]" },
                  { label: "Critical", value: criticalInc.length,            color: "text-[#C2410C]" },
                  { label: "Resolved", value: incidents.filter((i) => i.status === "resolved").length, color: "text-[#065F46]" },
                  { label: "Total",    value: incidents.length,              color: "text-[#111111]" },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2">
                    <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-[10px] text-[#9CA3AF] mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-[#E7DED1] overflow-hidden">
                <div className="grid grid-cols-[1fr_80px_130px_100px] gap-3 px-3 py-2 bg-[#FBFAF7] border-b border-[#F1ECE3] text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wide">
                  <span>Title</span><span>Severity</span><span>Status</span><span>Created</span>
                </div>
                {incidents.slice(0, 10).map((inc) => (
                  <div key={inc.id} className="grid grid-cols-[1fr_80px_130px_100px] gap-3 px-3 py-2 border-b border-[#F1ECE3] last:border-0 text-xs items-center">
                    <Link href={`/incidents/${inc.id}` as Route} className="text-[#2563EB] hover:underline truncate">{inc.title}</Link>
                    <Badge className={inc.severity === "critical" ? "bg-[#FEF2F2] text-[#991B1B] text-[10px] font-normal" : inc.severity === "high" ? "bg-[#FFF7ED] text-[#C2410C] text-[10px] font-normal" : "bg-[#FFFBEB] text-[#92400E] text-[10px] font-normal"}>{inc.severity}</Badge>
                    <span className="text-[#374151]">{inc.status.replaceAll("_", " ")}</span>
                    <span className="text-[#9CA3AF]">{fmtDate(inc.createdAt)}</span>
                  </div>
                ))}
                {incidents.length > 10 && <p className="px-3 py-2 text-xs text-[#9CA3AF]">+ {incidents.length - 10} more — export for full list</p>}
              </div>
            </>
          )}
        </ReportSection>

        {/* ── 5. Audit Report ────────────────────────────────────────────── */}
        <ReportSection
          icon={BarChart3}
          title="Audit Report"
          subtitle="Release gates, approval decisions, and key governance actions"
          onExport={() => downloadJson("audit-report.json", auditEvts)}
          loading={loadAud || loadApp}
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              { label: "Releases blocked", value: blockedEvts.length,           color: "text-[#991B1B]" },
              { label: "Pending approvals", value: pendingAppvs.length,         color: "text-[#92400E]" },
              { label: "Approvals done",    value: approvals.filter((a) => a.status !== "pending").length, color: "text-[#065F46]" },
              { label: "Audit events",      value: auditEvts.length,            color: "text-[#111111]" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2">
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[10px] text-[#9CA3AF] mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
          {auditEvts.length === 0 ? (
            <p className="text-sm text-[#6B7280] py-4 text-center">No audit events yet.</p>
          ) : (
            <div className="rounded-xl border border-[#E7DED1] overflow-hidden">
              <div className="grid grid-cols-[140px_120px_1fr_100px] gap-3 px-3 py-2 bg-[#FBFAF7] border-b border-[#F1ECE3] text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wide">
                <span>Event</span><span>Entity type</span><span>Entity</span><span>When</span>
              </div>
              {auditEvts.slice(0, 12).map((evt) => (
                <div key={evt.id} className="grid grid-cols-[140px_120px_1fr_100px] gap-3 px-3 py-2 border-b border-[#F1ECE3] last:border-0 text-xs items-center">
                  <span className="truncate text-[#374151]">{evt.eventType.replaceAll("_", " ")}</span>
                  <span className="text-[#374151]">{evt.entityType}</span>
                  <span className="text-[#6B7280] truncate">{evt.entityName ?? evt.entityId.slice(0, 12)}</span>
                  <span className="text-[#9CA3AF]">{fmtDate(evt.createdAt)}</span>
                </div>
              ))}
              {auditEvts.length > 12 && (
                <div className="flex items-center justify-between px-3 py-2 text-xs text-[#9CA3AF]">
                  <span>+ {auditEvts.length - 12} more events</span>
                  <Link href={"/governance/audit" as Route} className="text-[#2563EB] hover:underline">View full audit trail →</Link>
                </div>
              )}
            </div>
          )}
        </ReportSection>

      </div>
    </div>
  );
}
