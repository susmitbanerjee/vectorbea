"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  GitBranch,
  Loader2,
  Plus,
  Scale,
  Shield,
  XCircle,
} from "lucide-react";
import type { Route } from "next";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import type {
  AiCapability,
  AiIncident,
  AuditEvent,
  CapabilityVersion,
  CapabilityVersionStatus,
  DataSensitivity,
  PolicyPack,
  PolicyStatus,
  ReliabilityRiskLevel,
  RequiredEvidence,
} from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" });
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

const RISK_STYLE: Record<ReliabilityRiskLevel, string> = {
  low:      "bg-[#ECFDF5] text-[#065F46]",
  medium:   "bg-[#FFFBEB] text-[#92400E]",
  high:     "bg-[#FFF7ED] text-[#C2410C]",
  critical: "bg-[#FEF2F2] text-[#991B1B]",
};

const STATUS_STYLE: Record<string, string> = {
  draft:        "bg-[#F3F4F6] text-[#374151]",
  active:       "bg-[#ECFDF5] text-[#065F46]",
  blocked:      "bg-[#FEF2F2] text-[#991B1B]",
  under_review: "bg-[#FFFBEB] text-[#92400E]",
  archived:     "bg-[#F3F4F6] text-[#9CA3AF]",
};

const SENSITIVITY_STYLE: Record<DataSensitivity, string> = {
  public:       "bg-[#ECFDF5] text-[#065F46]",
  internal:     "bg-[#F3F4F6] text-[#374151]",
  confidential: "bg-[#FFFBEB] text-[#92400E]",
  restricted:   "bg-[#FFF7ED] text-[#C2410C]",
  regulated:    "bg-[#FEF2F2] text-[#991B1B]",
};

const POLICY_STYLE: Record<PolicyStatus, string> = {
  no_policy:  "bg-[#F3F4F6] text-[#6B7280]",
  assigned:   "bg-[#EFF6FF] text-[#1D4ED8]",
  satisfied:  "bg-[#ECFDF5] text-[#065F46]",
  incomplete: "bg-[#FFFBEB] text-[#92400E]",
  violation:  "bg-[#FEF2F2] text-[#991B1B]",
};

const POLICY_LABEL: Record<PolicyStatus, string> = {
  no_policy:  "No policy",
  assigned:   "Policy assigned",
  satisfied:  "Policy satisfied",
  incomplete: "Incomplete",
  violation:  "Violation",
};

const VER_STYLE: Record<CapabilityVersionStatus, string> = {
  draft:      "bg-[#F3F4F6] text-[#374151]",
  candidate:  "bg-[#EFF6FF] text-[#1D4ED8]",
  approved:   "bg-[#F0FDF4] text-[#15803D]",
  active:     "bg-[#ECFDF5] text-[#065F46]",
  blocked:    "bg-[#FEF2F2] text-[#991B1B]",
  deprecated: "bg-[#F3F4F6] text-[#9CA3AF]",
};

const TABS = ["Overview", "Versions", "Policies", "Required Evidence", "Audit"] as const;
type Tab = typeof TABS[number];

// ─── Policy assignment type ────────────────────────────────────────────────────

type PolicyAssignment = {
  id: string;
  policyPackId: string;
  policyPackName: string | null;
  policyPackSector: string | null;
  status: string;
  appliedAt: string;
};

// ─── Create version dialog ────────────────────────────────────────────────────

function CreateVersionDialog({
  open,
  systemId,
  onClose,
  onCreated,
}: {
  open: boolean;
  systemId: string;
  onClose: () => void;
  onCreated: (v: CapabilityVersion) => void;
}) {
  const { activeWorkspaceId } = useWorkspace();
  const [versionNumber, setVNum] = useState("");
  const [name, setName]          = useState("");
  const [saving, setSaving]      = useState(false);
  const [error, setError]        = useState<string | null>(null);

  async function handleCreate() {
    if (!activeWorkspaceId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/registry/systems/${systemId}/versions?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionNumber: versionNumber.trim() || undefined, name: name.trim() || null, status: "draft" }),
      });
      const json = (await res.json()) as CapabilityVersion & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to create");
      onCreated(json);
      setVNum(""); setName("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create version");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm border-[#E7DED1] bg-white">
        <DialogHeader>
          <DialogTitle className="text-[#111111]">New Version</DialogTitle>
          <DialogDescription className="text-[#6B7280]">Create a new draft version of this AI system.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div>
            <label className="block mb-1 text-xs font-semibold text-[#374151]">Version number</label>
            <input
              className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-[#111111] focus:border-[#2563EB] focus:outline-none"
              placeholder="Auto-assigned if blank (e.g. v2)"
              value={versionNumber}
              onChange={(e) => setVNum(e.target.value)}
            />
          </div>
          <div>
            <label className="block mb-1 text-xs font-semibold text-[#374151]">Version name (optional)</label>
            <input
              className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-[#111111] focus:border-[#2563EB] focus:outline-none"
              placeholder="e.g. Improved prompt clarity"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B]">{error}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-xl border border-[#E7DED1] px-4 py-2 text-sm text-[#374151] hover:bg-[#F8F5EF]">Cancel</button>
            <button
              type="button"
              disabled={saving}
              onClick={handleCreate}
              className="rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50 flex items-center gap-1.5"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create version
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Apply policy dialog ──────────────────────────────────────────────────────

function ApplyPolicyDialog({
  open,
  systemId,
  onClose,
  onApplied,
}: {
  open: boolean;
  systemId: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const { activeWorkspaceId } = useWorkspace();
  const [packs, setPacks]   = useState<(PolicyPack & { appliedToCapabilityIds?: string[] })[]>([]);
  const [loading, setLoad]  = useState(true);
  const [selectedId, setSel] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!open || !activeWorkspaceId) return;
    setLoad(true);
    fetch(`/api/policies/packs?workspaceId=${encodeURIComponent(activeWorkspaceId)}`)
      .then((r) => r.json())
      .then((data: unknown) => { if (Array.isArray(data)) setPacks(data as typeof packs); })
      .catch(() => {})
      .finally(() => setLoad(false));
  }, [open, activeWorkspaceId]);

  async function handleApply() {
    if (!selectedId || !activeWorkspaceId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/registry/systems/${systemId}/policies?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyPackId: selectedId }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to apply");
      onApplied();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply policy");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm border-[#E7DED1] bg-white">
        <DialogHeader>
          <DialogTitle className="text-[#111111]">Apply Policy Pack</DialogTitle>
          <DialogDescription className="text-[#6B7280]">Select a policy pack to apply to this AI system.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {loading && <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-[#6B7280]" /></div>}
          {!loading && (
            <Select value={selectedId} onChange={(e) => setSel(e.target.value)}>
              <option value="">Select a policy pack…</option>
              {packs.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sector})</option>)}
            </Select>
          )}
          {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B]">{error}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-xl border border-[#E7DED1] px-4 py-2 text-sm text-[#374151] hover:bg-[#F8F5EF]">Cancel</button>
            <button
              type="button"
              disabled={!selectedId || saving}
              onClick={handleApply}
              className="rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50 flex items-center gap-1.5"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Apply policy
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tab views ────────────────────────────────────────────────────────────────

function OverviewTab({ system }: { system: AiCapability }) {
  const fields = [
    { label: "Type", value: system.type.replaceAll("_", " ") },
    { label: "Business domain", value: system.businessDomain.replaceAll("_", " ") },
    { label: "Risk level", value: <Badge className={`${RISK_STYLE[system.riskLevel]} text-[10px] font-normal`}>{system.riskLevel}</Badge> },
    { label: "Data sensitivity", value: <Badge className={`${SENSITIVITY_STYLE[system.dataSensitivity ?? "internal"]} text-[10px] font-normal`}>{system.dataSensitivity ?? "internal"}</Badge> },
    { label: "Status", value: <Badge className={`${STATUS_STYLE[system.status] ?? "bg-[#F3F4F6]"} text-[10px] font-normal`}>{system.status}</Badge> },
    { label: "Policy status", value: <Badge className={`${POLICY_STYLE[(system.policyStatus ?? "no_policy") as PolicyStatus]} text-[10px] font-normal`}>{POLICY_LABEL[(system.policyStatus ?? "no_policy") as PolicyStatus]}</Badge> },
    { label: "Versions", value: system.versionCount ?? 0 },
    { label: "Active version", value: system.activeVersion ? system.activeVersion.versionNumber : "None" },
    { label: "Created", value: fmtDate(system.createdAt) },
    { label: "Last updated", value: fmtDate(system.updatedAt) },
  ];

  return (
    <div className="space-y-4">
      {system.description && (
        <Card className="border-[#E7DED1]">
          <CardContent className="pt-4 text-sm text-[#374151]">{system.description}</CardContent>
        </Card>
      )}
      <Card className="border-[#E7DED1]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-[#111111]">System details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
            {fields.map((f) => (
              <div key={f.label}>
                <dt className="text-[10px] text-[#9CA3AF] uppercase tracking-wide font-semibold">{f.label}</dt>
                <dd className="mt-0.5 text-sm text-[#111111]">{f.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function VersionsTab({
  systemId,
  versions,
  loading,
  error,
  onRefresh,
  onNewVersion,
}: {
  systemId: string;
  versions: CapabilityVersion[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onNewVersion: () => void;
}) {
  const { activeWorkspaceId } = useWorkspace();
  const [promoting, setPromoting] = useState<string | null>(null);

  async function promote(versionId: string, status: CapabilityVersionStatus) {
    if (!activeWorkspaceId) return;
    setPromoting(versionId);
    try {
      await fetch(`/api/registry/systems/${systemId}/versions/${versionId}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      onRefresh();
    } finally {
      setPromoting(null);
    }
  }

  const nextStatus = (current: CapabilityVersionStatus): CapabilityVersionStatus | null => {
    if (current === "draft") return "candidate";
    if (current === "candidate") return "approved";
    if (current === "approved") return "active";
    return null;
  };

  const nextLabel = (current: CapabilityVersionStatus): string => {
    if (current === "draft") return "Promote to candidate";
    if (current === "candidate") return "Mark approved";
    if (current === "approved") return "Activate";
    return "";
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-[#6B7280]" /></div>;
  if (error) return <div className="flex items-center gap-2 py-8 text-sm text-[#991B1B]"><AlertTriangle className="h-4 w-4" />{error}</div>;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={onNewVersion}
          className="flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
        >
          <Plus className="h-3.5 w-3.5" /> New version
        </button>
      </div>

      {versions.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <GitBranch className="h-8 w-8 text-[#D1C9BD]" />
          <p className="text-sm text-[#6B7280]">No versions yet. Create the first version to start the release lifecycle.</p>
        </div>
      )}

      {versions.map((v) => {
        const next = nextStatus(v.status);
        return (
          <div key={v.id} className="rounded-xl border border-[#E7DED1] bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[#111111] text-sm">{v.versionNumber}</span>
                  {v.name && <span className="text-xs text-[#6B7280]">— {v.name}</span>}
                  <Badge className={`${VER_STYLE[v.status]} text-[10px] font-normal`}>{v.status}</Badge>
                </div>
                <div className="mt-1 flex gap-4 text-[10px] text-[#9CA3AF]">
                  <span>Created {fmtDate(v.createdAt)}</span>
                  {v.activatedAt && <span className="text-[#065F46]">Activated {fmtDate(v.activatedAt)}</span>}
                  {v.deprecatedAt && <span className="text-[#9CA3AF]">Deprecated {fmtDate(v.deprecatedAt)}</span>}
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {next && (
                  <button
                    onClick={() => promote(v.id, next)}
                    disabled={promoting === v.id}
                    className="flex items-center gap-1 rounded-lg border border-[#2563EB] px-3 py-1.5 text-xs font-medium text-[#2563EB] hover:bg-[#EFF6FF] disabled:opacity-50"
                  >
                    {promoting === v.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronRight className="h-3 w-3" />}
                    {nextLabel(v.status)}
                  </button>
                )}
                {v.status === "active" && (
                  <button
                    onClick={() => promote(v.id, "deprecated")}
                    disabled={promoting === v.id}
                    className="rounded-lg border border-[#E7DED1] px-3 py-1.5 text-xs text-[#6B7280] hover:bg-[#F8F5EF] disabled:opacity-50"
                  >
                    Deprecate
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PoliciesTab({
  systemId,
  assignments,
  loading,
  error,
  onRefresh,
  onApplyPolicy,
}: {
  systemId: string;
  assignments: PolicyAssignment[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onApplyPolicy: () => void;
}) {
  const { activeWorkspaceId } = useWorkspace();
  const [removing, setRemoving] = useState<string | null>(null);

  async function removePolicy(policyPackId: string) {
    if (!activeWorkspaceId) return;
    setRemoving(policyPackId);
    try {
      await fetch(`/api/registry/systems/${systemId}/policies?workspaceId=${encodeURIComponent(activeWorkspaceId)}&policyPackId=${encodeURIComponent(policyPackId)}`, { method: "DELETE" });
      onRefresh();
    } finally {
      setRemoving(null);
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-[#6B7280]" /></div>;
  if (error) return <div className="flex items-center gap-2 py-8 text-sm text-[#991B1B]"><AlertTriangle className="h-4 w-4" />{error}</div>;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={onApplyPolicy}
          className="flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
        >
          <Scale className="h-3.5 w-3.5" /> Apply policy pack
        </button>
      </div>

      {assignments.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Scale className="h-8 w-8 text-[#D1C9BD]" />
          <div>
            <p className="font-medium text-[#111111] text-sm">No policies applied</p>
            <p className="text-xs text-[#6B7280] mt-1">Apply a policy pack to define governance rules and required evidence.</p>
          </div>
        </div>
      )}

      {assignments.map((a) => (
        <div key={a.id} className="flex items-center justify-between rounded-xl border border-[#E7DED1] bg-white p-4">
          <div>
            <p className="font-medium text-[#111111] text-sm">{a.policyPackName ?? a.policyPackId}</p>
            <div className="flex gap-3 mt-1 text-[10px] text-[#9CA3AF]">
              {a.policyPackSector && <span>{a.policyPackSector}</span>}
              <span>Applied {fmtDate(a.appliedAt)}</span>
              <Badge className={`${a.status === "active" ? "bg-[#ECFDF5] text-[#065F46]" : "bg-[#F3F4F6] text-[#9CA3AF]"} text-[10px] font-normal`}>
                {a.status}
              </Badge>
            </div>
          </div>
          <button
            onClick={() => removePolicy(a.policyPackId)}
            disabled={removing === a.policyPackId}
            className="text-xs text-[#6B7280] hover:text-[#991B1B] disabled:opacity-50"
          >
            {removing === a.policyPackId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
          </button>
        </div>
      ))}
    </div>
  );
}

function RequiredEvidenceTab({
  evidence,
  loading,
  error,
}: {
  evidence: RequiredEvidence[];
  loading: boolean;
  error: string | null;
}) {
  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-[#6B7280]" /></div>;
  if (error) return <div className="flex items-center gap-2 py-8 text-sm text-[#991B1B]"><AlertTriangle className="h-4 w-4" />{error}</div>;

  if (evidence.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <FileText className="h-8 w-8 text-[#D1C9BD]" />
        <div>
          <p className="font-medium text-[#111111] text-sm">No required evidence</p>
          <p className="text-xs text-[#6B7280] mt-1">Apply a policy pack to generate required evidence checks.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {evidence.map((e) => (
        <div key={e.id} className="flex items-start gap-3 rounded-xl border border-[#E7DED1] bg-white p-4">
          <div className={`mt-0.5 flex-shrink-0 rounded-full p-1 ${e.blocking ? "bg-[#FEF2F2]" : "bg-[#FFFBEB]"}`}>
            {e.blocking
              ? <Shield className="h-3.5 w-3.5 text-[#991B1B]" />
              : <CheckCircle2 className="h-3.5 w-3.5 text-[#92400E]" />
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium text-[#111111] text-sm">{e.label}</p>
              {e.blocking && <Badge className="bg-[#FEF2F2] text-[#991B1B] text-[10px] font-normal">blocking</Badge>}
              {!e.required && <Badge className="bg-[#F3F4F6] text-[#6B7280] text-[10px] font-normal">optional</Badge>}
            </div>
            <p className="text-[10px] text-[#9CA3AF] mt-0.5">
              {e.evidenceType.replaceAll("_", " ")}
              {e.policyPackName && <> · from {e.policyPackName}</>}
            </p>
            {e.description && <p className="text-xs text-[#6B7280] mt-1">{e.description}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function AuditTab({
  events,
  loading,
  error,
}: {
  events: AuditEvent[];
  loading: boolean;
  error: string | null;
}) {
  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-[#6B7280]" /></div>;
  if (error) return <div className="flex items-center gap-2 py-8 text-sm text-[#991B1B]"><AlertTriangle className="h-4 w-4" />{error}</div>;

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <Clock className="h-8 w-8 text-[#D1C9BD]" />
        <p className="text-sm text-[#6B7280]">No audit events yet for this system.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {events.map((e) => (
        <div key={e.id} className="flex items-start gap-3 px-4 py-3 border-b border-[#F1ECE3] last:border-0">
          <Clock className="h-3.5 w-3.5 text-[#9CA3AF] mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-[#111111]">{e.eventType.replaceAll("_", " ")}</p>
            {e.entityName && <p className="text-xs text-[#6B7280]">{e.entityName}</p>}
          </div>
          <span className="text-[10px] text-[#9CA3AF] flex-shrink-0">{fmtDateTime(e.createdAt)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SystemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { activeWorkspaceId } = useWorkspace();
  const [system, setSystem]         = useState<AiCapability | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [activeTab, setActiveTab]   = useState<Tab>("Overview");

  const [versions, setVersions]         = useState<CapabilityVersion[]>([]);
  const [versionsLoading, setVL]        = useState(false);
  const [versionsError, setVE]          = useState<string | null>(null);

  const [assignments, setAssignments]   = useState<PolicyAssignment[]>([]);
  const [assignLoad, setAssignLoad]     = useState(false);
  const [assignError, setAssignError]   = useState<string | null>(null);

  const [evidence, setEvidence]         = useState<RequiredEvidence[]>([]);
  const [evidLoad, setEvidLoad]         = useState(false);
  const [evidError, setEvidError]       = useState<string | null>(null);

  const [auditEvents, setAuditEvents]   = useState<AuditEvent[]>([]);
  const [auditLoad, setAuditLoad]       = useState(false);
  const [auditError, setAuditError]     = useState<string | null>(null);

  const [showNewVersion, setNewVersion] = useState(false);
  const [showApplyPolicy, setApplyPol]  = useState(false);

  // Load system
  useEffect(() => {
    if (!id || !activeWorkspaceId) return;
    setLoading(true);
    fetch(`/api/registry/systems/${id}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`)
      .then((r) => r.json())
      .then((data: unknown) => {
        const d = data as AiCapability & { error?: string };
        if (d.error) setError(d.error);
        else setSystem(d);
      })
      .catch(() => setError("Failed to load AI system"))
      .finally(() => setLoading(false));
  }, [id, activeWorkspaceId]);

  const loadVersions = useCallback(() => {
    if (!id || !activeWorkspaceId) return;
    setVL(true);
    fetch(`/api/registry/systems/${id}/versions?workspaceId=${encodeURIComponent(activeWorkspaceId)}`)
      .then((r) => r.json())
      .then((data: unknown) => { if (Array.isArray(data)) setVersions(data as CapabilityVersion[]); else setVE((data as { error?: string }).error ?? "Failed"); })
      .catch(() => setVE("Failed to load versions"))
      .finally(() => setVL(false));
  }, [id, activeWorkspaceId]);

  const loadAssignments = useCallback(() => {
    if (!id || !activeWorkspaceId) return;
    setAssignLoad(true);
    fetch(`/api/registry/systems/${id}/policies?workspaceId=${encodeURIComponent(activeWorkspaceId)}`)
      .then((r) => r.json())
      .then((data: unknown) => { if (Array.isArray(data)) setAssignments(data as PolicyAssignment[]); else setAssignError((data as { error?: string }).error ?? "Failed"); })
      .catch(() => setAssignError("Failed to load policies"))
      .finally(() => setAssignLoad(false));
  }, [id, activeWorkspaceId]);

  const loadEvidence = useCallback(() => {
    if (!id || !activeWorkspaceId) return;
    setEvidLoad(true);
    fetch(`/api/registry/systems/${id}/required-evidence?workspaceId=${encodeURIComponent(activeWorkspaceId)}`)
      .then((r) => r.json())
      .then((data: unknown) => { if (Array.isArray(data)) setEvidence(data as RequiredEvidence[]); else setEvidError((data as { error?: string }).error ?? "Failed"); })
      .catch(() => setEvidError("Failed to load evidence"))
      .finally(() => setEvidLoad(false));
  }, [id, activeWorkspaceId]);

  const loadAudit = useCallback(() => {
    if (!id || !activeWorkspaceId) return;
    setAuditLoad(true);
    fetch(`/api/governance/audit?workspaceId=${encodeURIComponent(activeWorkspaceId)}&entityType=ai_system`)
      .then((r) => r.json())
      .then((data: unknown) => { if (Array.isArray(data)) setAuditEvents(data as AuditEvent[]); })
      .catch(() => setAuditError("Failed to load audit events"))
      .finally(() => setAuditLoad(false));
  }, [id, activeWorkspaceId]);

  // Load tab data on tab switch
  useEffect(() => {
    if (activeTab === "Versions" && versions.length === 0 && !versionsLoading) loadVersions();
    if (activeTab === "Policies" && assignments.length === 0 && !assignLoad) loadAssignments();
    if (activeTab === "Required Evidence" && evidence.length === 0 && !evidLoad) loadEvidence();
    if (activeTab === "Audit" && auditEvents.length === 0 && !auditLoad) loadAudit();
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8F5EF]">
        <AppHeader title="AI System" subtitle="Loading…" />
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-[#6B7280]" /></div>
      </div>
    );
  }

  if (error || !system) {
    return (
      <div className="min-h-screen bg-[#F8F5EF]">
        <AppHeader title="AI System" subtitle="Not found" />
        <div className="px-4 py-12 flex flex-col items-center gap-4 text-center">
          <AlertTriangle className="h-8 w-8 text-[#C2410C]" />
          <p className="text-sm text-[#6B7280]">{error ?? "AI system not found"}</p>
          <Link href={"/registry/systems" as Route} className="text-sm text-[#2563EB] hover:underline flex items-center gap-1">
            <ChevronLeft className="h-3.5 w-3.5" /> Back to AI Registry
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title={system.name}
        subtitle={`${system.type.replaceAll("_", " ")} · ${system.businessDomain.replaceAll("_", " ")}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge className={`${STATUS_STYLE[system.status] ?? "bg-[#F3F4F6]"} text-xs font-normal`}>{system.status}</Badge>
            <Badge className={`${RISK_STYLE[system.riskLevel]} text-xs font-normal`}>{system.riskLevel} risk</Badge>
          </div>
        }
      />

      <div className="px-4 py-6 md:px-6 xl:px-8">
        {/* Tabs */}
        <div className="flex gap-1 border-b border-[#E7DED1] mb-6 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                activeTab === tab
                  ? "border-[#2563EB] text-[#2563EB]"
                  : "border-transparent text-[#6B7280] hover:text-[#374151]"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="max-w-3xl">
          {activeTab === "Overview" && <OverviewTab system={system} />}
          {activeTab === "Versions" && (
            <VersionsTab
              systemId={id}
              versions={versions}
              loading={versionsLoading}
              error={versionsError}
              onRefresh={loadVersions}
              onNewVersion={() => setNewVersion(true)}
            />
          )}
          {activeTab === "Policies" && (
            <PoliciesTab
              systemId={id}
              assignments={assignments}
              loading={assignLoad}
              error={assignError}
              onRefresh={loadAssignments}
              onApplyPolicy={() => setApplyPol(true)}
            />
          )}
          {activeTab === "Required Evidence" && (
            <RequiredEvidenceTab
              evidence={evidence}
              loading={evidLoad}
              error={evidError}
            />
          )}
          {activeTab === "Audit" && (
            <AuditTab
              events={auditEvents}
              loading={auditLoad}
              error={auditError}
            />
          )}
        </div>
      </div>

      <CreateVersionDialog
        open={showNewVersion}
        systemId={id}
        onClose={() => setNewVersion(false)}
        onCreated={(v) => { setVersions((prev) => [v, ...prev]); }}
      />

      <ApplyPolicyDialog
        open={showApplyPolicy}
        systemId={id}
        onClose={() => setApplyPol(false)}
        onApplied={() => { loadAssignments(); loadEvidence(); }}
      />
    </div>
  );
}
