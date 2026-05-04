"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
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
  AuditEvent,
  CapabilityEvidenceRun,
  CapabilityVersion,
  CapabilityVersionStatus,
  DataSensitivity,
  EvidenceType,
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
  const [mode, setMode] = useState<"existing" | "custom">("existing");
  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customSector, setCustomSector] = useState<PolicyPack["sector"]>("general");
  const [customEvidence, setCustomEvidence] = useState<EvidenceType[]>(["deterministic_check", "workflow_regression"]);
  const [requiresApproval, setRequiresApproval] = useState(true);
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

  function toggleEvidence(type: EvidenceType) {
    setCustomEvidence((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  }

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

  async function handleCreateAndApply() {
    if (!activeWorkspaceId || !customName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const createRes = await fetch(`/api/policies/packs?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: customName.trim(),
          description: customDescription.trim() || null,
          sector: customSector,
          requiresApproval,
          requiredEvidence: customEvidence.map((evidenceType) => ({
            evidenceType,
            label: EVIDENCE_TYPE_LABELS[evidenceType],
            required: true,
            blocking: true,
          })),
        }),
      });
      const created = (await createRes.json()) as PolicyPack & { error?: string };
      if (!createRes.ok) throw new Error(created.error ?? "Failed to create custom policy");

      const applyRes = await fetch(`/api/registry/systems/${systemId}/policies?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyPackId: created.id }),
      });
      const applied = (await applyRes.json()) as { error?: string };
      if (!applyRes.ok) throw new Error(applied.error ?? "Custom policy was created but could not be applied");

      onApplied();
      onClose();
      setMode("existing");
      setCustomName("");
      setCustomDescription("");
      setCustomSector("general");
      setCustomEvidence(["deterministic_check", "workflow_regression"]);
      setRequiresApproval(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create custom policy");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl border-[#E7DED1] bg-white">
        <DialogHeader>
          <DialogTitle className="text-[#111111]">Apply Policy</DialogTitle>
          <DialogDescription className="text-[#6B7280]">Apply an existing policy pack or create a workspace custom policy for this AI system.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-[#E7DED1] bg-[#FAF7F0] p-1">
            <button
              type="button"
              onClick={() => setMode("existing")}
              className={`rounded-xl px-3 py-2 text-xs font-semibold ${mode === "existing" ? "bg-white text-[#111111] shadow-sm" : "text-[#6B7280]"}`}
            >
              Existing pack
            </button>
            <button
              type="button"
              onClick={() => setMode("custom")}
              className={`rounded-xl px-3 py-2 text-xs font-semibold ${mode === "custom" ? "bg-white text-[#111111] shadow-sm" : "text-[#6B7280]"}`}
            >
              Create custom policy
            </button>
          </div>
          {loading && <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-[#6B7280]" /></div>}
          {!loading && mode === "existing" && (
            <Select value={selectedId} onChange={(e) => setSel(e.target.value)}>
              <option value="">Select a policy pack…</option>
              {packs.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sector})</option>)}
            </Select>
          )}
          {mode === "custom" && (
            <div className="space-y-4">
              {/* Explainer */}
              <div className="rounded-xl border border-[#DBEAFE] bg-[#EFF6FF] px-4 py-3 text-xs text-[#1D4ED8] leading-relaxed">
                <p className="font-semibold mb-1">How custom policies work</p>
                <p>
                  A custom policy defines what evidence must be collected before this AI system can pass its release gate.
                  Each evidence type you select becomes a required check. Checks are automatically verified when real data
                  arrives from your connected integrations — you do not run them manually (except Human Approval).
                </p>
              </div>

              <div className="space-y-3 rounded-2xl border border-[#E7DED1] bg-[#FAF7F0] p-4">
                <label className="block text-xs font-semibold text-[#374151]">
                  Policy name
                  <input
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="e.g. Refund Agent Production Policy"
                    className="mt-1 w-full rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm text-[#111111] outline-none focus:border-[#2563EB]"
                  />
                </label>
                <label className="block text-xs font-semibold text-[#374151]">
                  Sector
                  <Select className="mt-1" value={customSector} onChange={(e) => setCustomSector(e.target.value as PolicyPack["sector"])}>
                    {["general", "retail", "bfsi", "healthcare", "pharma", "software", "software_support", "travel", "insurance"].map((sector) => (
                      <option key={sector} value={sector}>{sector.replaceAll("_", " ")}</option>
                    ))}
                  </Select>
                </label>
                <label className="block text-xs font-semibold text-[#374151]">
                  Description
                  <textarea
                    value={customDescription}
                    onChange={(e) => setCustomDescription(e.target.value)}
                    placeholder="Describe the control objective — e.g. 'All customer-facing refund decisions must pass deterministic checks and be approved before each release.'"
                    className="mt-1 min-h-[72px] w-full rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm text-[#111111] outline-none focus:border-[#2563EB]"
                  />
                </label>

                {/* Evidence picker with descriptions */}
                <div>
                  <p className="text-xs font-semibold text-[#374151] mb-1">Required evidence checks</p>
                  <p className="text-[11px] text-[#6B7280] mb-2">
                    Select the checks that must pass before a release gate can be approved. Each check is verified automatically by the indicated integration.
                  </p>
                  <div className="space-y-2">
                    {(Object.keys(EVIDENCE_TYPE_LABELS) as EvidenceType[]).map((type) => {
                      const m = EVIDENCE_TYPE_META[type];
                      const checked = customEvidence.includes(type);
                      return (
                        <label
                          key={type}
                          className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                            checked
                              ? "border-[#2563EB] bg-[#EFF6FF]"
                              : "border-[#E7DED1] bg-white hover:bg-[#FAFAF7]"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleEvidence(type)}
                            className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 accent-[#2563EB]"
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-[#111111]">{EVIDENCE_TYPE_LABELS[type]}</p>
                            <p className="text-[11px] text-[#6B7280] mt-0.5 leading-snug">{m.what}</p>
                            <p className="text-[10px] text-[#9CA3AF] mt-1">
                              Verified via:{" "}
                              <span className="font-medium text-[#6B7280]">{m.integrationLabel}</span>
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <label className="flex items-center gap-2 rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-xs text-[#374151]">
                  <input
                    type="checkbox"
                    checked={requiresApproval}
                    onChange={(e) => setRequiresApproval(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#2563EB]"
                  />
                  Require a manual approval step before the release gate can pass
                </label>

                {customEvidence.length > 0 && (
                  <div className="rounded-xl border border-[#E7DED1] bg-white px-3 py-2.5">
                    <p className="text-[11px] font-semibold text-[#374151] mb-1">Summary — {customEvidence.length} check{customEvidence.length !== 1 ? "s" : ""} selected</p>
                    <ul className="space-y-1">
                      {customEvidence.map((type) => (
                        <li key={type} className="flex items-center gap-2 text-[11px] text-[#6B7280]">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#2563EB] flex-shrink-0" />
                          <span className="font-medium text-[#374151]">{EVIDENCE_TYPE_LABELS[type]}</span>
                          <span>— via {EVIDENCE_TYPE_META[type].integrationLabel}</span>
                        </li>
                      ))}
                      {requiresApproval && (
                        <li className="flex items-center gap-2 text-[11px] text-[#6B7280]">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#7C3AED] flex-shrink-0" />
                          <span className="font-medium text-[#374151]">Human Approval</span>
                          <span>— manual review required</span>
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
          {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B]">{error}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-xl border border-[#E7DED1] px-4 py-2 text-sm text-[#374151] hover:bg-[#F8F5EF]">Cancel</button>
            <button
              type="button"
              disabled={(mode === "existing" ? !selectedId : !customName.trim()) || saving}
              onClick={mode === "existing" ? handleApply : handleCreateAndApply}
              className="rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50 flex items-center gap-1.5"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {mode === "existing" ? "Apply policy" : "Create and apply"}
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

  const [gateErrors, setGateErrors] = useState<Record<string, string>>({});

  async function promote(vid: string, status: CapabilityVersionStatus) {
    if (!activeWorkspaceId) return;
    setPromoting(vid);
    try {
      // For activation: use gate-checked endpoint
      if (status === "active") {
        const res = await fetch(
          `/api/registry/systems/${systemId}/versions/${vid}/activate?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
          { method: "POST" },
        );
        const json = (await res.json()) as { error?: string; decision?: string; reasons?: string[] };
        if (!res.ok) {
          const reason = json.reasons?.join("; ") ?? json.error ?? "Gate check failed";
          setGateErrors((prev) => ({ ...prev, [vid]: reason }));
          return;
        }
        setGateErrors((prev) => { const next = { ...prev }; delete next[vid]; return next; });
      } else {
        await fetch(`/api/registry/systems/${systemId}/versions/${vid}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
      }
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
    if (current === "approved") return "Activate (gate check)";
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
                {gateErrors[v.id] && (
                  <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B]">
                    <XCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                    <span>{gateErrors[v.id]}</span>
                    <Link href={`/release-gates/${v.id}` as Route} className="ml-1 underline flex-shrink-0">View gate</Link>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2 flex-shrink-0">
                <Link
                  href={`/release-gates/${v.id}` as Route}
                  className="flex items-center gap-1 rounded-lg border border-[#E7DED1] px-3 py-1.5 text-xs text-[#6B7280] hover:bg-[#F8F5EF]"
                >
                  <Shield className="h-3 w-3" /> Release Gate
                </Link>
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
          <Scale className="h-3.5 w-3.5" /> Apply or create policy
        </button>
      </div>

      {assignments.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Scale className="h-8 w-8 text-[#D1C9BD]" />
          <div>
            <p className="font-medium text-[#111111] text-sm">No policies applied</p>
            <p className="text-xs text-[#6B7280] mt-1">Apply a policy pack or create a custom policy to define governance rules and required evidence.</p>
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

// Per evidence type: what it checks, how to pass it, which integration sends it
const EVIDENCE_TYPE_META: Record<EvidenceType, {
  what: string;
  howToPass: string;
  integration: string;
  integrationHref: string;
  integrationLabel: string;
}> = {
  prompt_check: {
    what: "Validates that prompt templates meet policy constraints — no banned instructions, no PII leakage patterns.",
    howToPass: "Run your AI system via the VectorBea SDK or sidecar proxy. Each traced call automatically submits prompt evidence.",
    integration: "sdk",
    integrationHref: "/integrations/sdk",
    integrationLabel: "SDK integration",
  },
  deterministic_check: {
    what: "Verifies that identical inputs always produce the same output within an acceptable variance threshold.",
    howToPass: "Use the SDK `run()` context manager or CI/CD integration to submit paired input/output traces. The validator checks consistency across runs.",
    integration: "ci_cd",
    integrationHref: "/integrations/ci-cd",
    integrationLabel: "CI/CD integration",
  },
  behavioral_check: {
    what: "Tests the AI system against a curated dataset of expected input/output pairs to detect regressions.",
    howToPass: "Connect via SDK or OpenTelemetry and run your system against a test dataset. Evidence is submitted automatically from traced runs.",
    integration: "opentelemetry",
    integrationHref: "/integrations/opentelemetry",
    integrationLabel: "OpenTelemetry integration",
  },
  rag_grounding_check: {
    what: "Confirms that all generated answers are grounded in retrieved context — no hallucinated facts.",
    howToPass: "Instrument your RAG pipeline with the VectorBea SDK or connect via the RAG pipeline integration. Each retrieval + generation pair is checked.",
    integration: "rag_pipeline",
    integrationHref: "/integrations/rag",
    integrationLabel: "RAG pipeline integration",
  },
  mcp_tool_policy_check: {
    what: "Audits MCP tool calls to ensure only approved tools are invoked and no sensitive arguments are passed.",
    howToPass: "Wrap your MCP client with `vectorbea.wrap_mcp_client()` from the Python SDK, or connect the MCP server integration. Tool calls are logged automatically.",
    integration: "mcp_server",
    integrationHref: "/integrations/mcp",
    integrationLabel: "MCP server integration",
  },
  workflow_regression: {
    what: "Runs your AI workflow end-to-end against a baseline and flags any change in outputs, latency, or cost.",
    howToPass: "Add the VectorBea CI/CD step to your pipeline. Each deployment triggers a workflow run that is compared to the last passing baseline.",
    integration: "ci_cd",
    integrationHref: "/integrations/ci-cd",
    integrationLabel: "CI/CD integration",
  },
  provider_comparison: {
    what: "Compares responses across different LLM providers or model versions to surface quality regressions.",
    howToPass: "Connect at least one LLM provider integration and run your system via the SDK. The validator compares provider outputs automatically.",
    integration: "llm_provider",
    integrationHref: "/integrations/llm-providers",
    integrationLabel: "LLM provider integration",
  },
  human_approval: {
    what: "Requires a team member to manually review and approve the AI system before it can pass a release gate.",
    howToPass: "Click 'Run check' on this card — it creates a pending approval request. A workspace admin or editor must then approve it in the Approvals section.",
    integration: "manual_upload",
    integrationHref: "/governance/approvals",
    integrationLabel: "View pending approvals",
  },
  privacy_check: {
    what: "Scans AI inputs and outputs for PII, sensitive data patterns, and privacy policy violations.",
    howToPass: "Route traffic through the VectorBea sidecar proxy — it redacts and audits PII automatically. Alternatively use the SDK with privacy checks enabled.",
    integration: "sidecar",
    integrationHref: "/integrations/sidecar",
    integrationLabel: "Sidecar proxy integration",
  },
  security_check: {
    what: "Tests for prompt injection, jailbreak attempts, and other adversarial inputs in your AI system.",
    howToPass: "Connect via SDK or sidecar. The validator runs a set of adversarial test inputs against your system and checks that guardrails hold.",
    integration: "sidecar",
    integrationHref: "/integrations/sidecar",
    integrationLabel: "Sidecar proxy integration",
  },
};

const EVIDENCE_RUN_STATUS_STYLE: Record<string, string> = {
  passed:       "bg-[#ECFDF5] text-[#065F46]",
  failed:       "bg-[#FEF2F2] text-[#991B1B]",
  needs_review: "bg-[#FFFBEB] text-[#92400E]",
  running:      "bg-[#EFF6FF] text-[#1D4ED8]",
  queued:       "bg-[#F3F4F6] text-[#374151]",
  cancelled:    "bg-[#F3F4F6] text-[#9CA3AF]",
  timed_out:    "bg-[#FFF7ED] text-[#C2410C]",
};

function RequiredEvidenceTab({
  systemId,
  versionId,
  evidence,
  loading,
  error,
}: {
  systemId: string;
  versionId: string | null;
  evidence: RequiredEvidence[];
  loading: boolean;
  error: string | null;
}) {
  const { activeWorkspaceId } = useWorkspace();
  const [runs, setRuns]         = useState<CapabilityEvidenceRun[]>([]);
  const [runsLoading, setRL]    = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setSE]     = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId || !versionId) return;
    setRL(true);
    fetch(`/api/evidence/runs?workspaceId=${encodeURIComponent(activeWorkspaceId)}&versionId=${encodeURIComponent(versionId)}`)
      .then((r) => r.json())
      .then((data: unknown) => { if (Array.isArray(data)) setRuns(data as CapabilityEvidenceRun[]); })
      .catch(() => {})
      .finally(() => setRL(false));
  }, [activeWorkspaceId, versionId]);

  async function runCheck(evidenceType: EvidenceType, blocking: boolean, policyPackId: string | null) {
    if (!activeWorkspaceId) return;
    setStarting(evidenceType);
    setSE(null);
    try {
      const res = await fetch(`/api/evidence/runs?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiSystemId: systemId, aiSystemVersionId: versionId, evidenceType, blocking, policyPackId }),
      });
      const json = (await res.json()) as CapabilityEvidenceRun & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to start");
      setRuns((prev) => [json, ...prev]);
    } catch (e) {
      setSE(e instanceof Error ? e.message : "Failed to start evidence run");
    } finally {
      setStarting(null);
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-[#6B7280]" /></div>;
  if (error) return <div className="flex items-center gap-2 py-8 text-sm text-[#991B1B]"><AlertTriangle className="h-4 w-4" />{error}</div>;

  // Build a latest-run map per evidence type
  const latestRunByType = new Map<EvidenceType, CapabilityEvidenceRun>();
  for (const run of runs) {
    if (!latestRunByType.has(run.evidenceType)) latestRunByType.set(run.evidenceType, run);
  }

  if (evidence.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <FileText className="h-8 w-8 text-[#D1C9BD]" />
        <div>
          <p className="font-medium text-[#111111] text-sm">No required evidence</p>
          <p className="text-xs text-[#6B7280] mt-1">Apply a policy pack from the Policies tab to generate evidence requirements.</p>
        </div>
      </div>
    );
  }

  if (!versionId) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <GitBranch className="h-8 w-8 text-[#D1C9BD]" />
        <div>
          <p className="font-medium text-[#111111] text-sm">No version selected</p>
          <p className="text-xs text-[#6B7280] mt-1">Create a version in the Versions tab to run evidence checks.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {startError && (
        <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B]">{startError}</div>
      )}

      {/* Checklist */}
      {evidence.map((e) => {
        const latestRun = latestRunByType.get(e.evidenceType as EvidenceType);
        const runStatus = latestRun?.status;
        const isRunning = starting === e.evidenceType || runStatus === "running" || runStatus === "queued";
        const canRunFromUi = e.evidenceType === "human_approval";

        let statusIcon: React.ReactNode;
        let statusBadge: React.ReactNode = null;

        if (!latestRun) {
          statusIcon = <Shield className="h-4 w-4 text-[#9CA3AF]" />;
        } else if (runStatus === "passed") {
          statusIcon = <CheckCircle2 className="h-4 w-4 text-[#065F46]" />;
          statusBadge = <Badge className="bg-[#ECFDF5] text-[#065F46] text-[10px] font-normal">Passed</Badge>;
        } else if (runStatus === "failed") {
          statusIcon = <XCircle className="h-4 w-4 text-[#991B1B]" />;
          statusBadge = <Badge className="bg-[#FEF2F2] text-[#991B1B] text-[10px] font-normal">Failed</Badge>;
        } else if (runStatus === "needs_review") {
          statusIcon = <AlertTriangle className="h-4 w-4 text-[#92400E]" />;
          statusBadge = <Badge className="bg-[#FFFBEB] text-[#92400E] text-[10px] font-normal">Needs Review</Badge>;
        } else if (runStatus === "running" || runStatus === "queued") {
          statusIcon = <Loader2 className="h-4 w-4 text-[#1D4ED8] animate-spin" />;
          statusBadge = <Badge className="bg-[#EFF6FF] text-[#1D4ED8] text-[10px] font-normal">{runStatus === "running" ? "Running" : "Queued"}</Badge>;
        } else {
          statusIcon = <Shield className="h-4 w-4 text-[#9CA3AF]" />;
        }

        const meta = EVIDENCE_TYPE_META[e.evidenceType as EvidenceType];

        return (
          <div key={e.id} className="rounded-xl border border-[#E7DED1] bg-white overflow-hidden">
            {/* Header row */}
            <div className="flex items-start gap-3 p-4">
              <div className="mt-0.5 flex-shrink-0">{statusIcon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center flex-wrap gap-2">
                  <p className="font-medium text-[#111111] text-sm">{e.label}</p>
                  {statusBadge}
                  {e.blocking && <Badge className="bg-[#FEF2F2] text-[#991B1B] text-[10px] font-normal">blocking</Badge>}
                  {!e.required && <Badge className="bg-[#F3F4F6] text-[#6B7280] text-[10px] font-normal">optional</Badge>}
                </div>
                <p className="text-[10px] text-[#9CA3AF] mt-0.5">
                  {EVIDENCE_TYPE_LABELS[e.evidenceType as EvidenceType] ?? e.evidenceType}
                  {e.policyPackName && <> · from {e.policyPackName}</>}
                </p>
                {/* What this check validates */}
                {meta && (
                  <p className="text-xs text-[#6B7280] mt-1 leading-relaxed">{meta.what}</p>
                )}
                {e.description && !meta && (
                  <p className="text-xs text-[#6B7280] mt-1">{e.description}</p>
                )}
                {latestRun?.failureReason && (
                  <p className="text-xs text-[#991B1B] mt-1">↳ {latestRun.failureReason}</p>
                )}
                {latestRun?.resultSummary && runStatus !== "failed" && (
                  <p className="text-xs text-[#065F46] mt-1">↳ {latestRun.resultSummary}</p>
                )}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {latestRun && (
                  <Link
                    href={`/evidence/runs/${latestRun.id}` as Route}
                    className="rounded-lg border border-[#E7DED1] px-2.5 py-1.5 text-xs text-[#6B7280] hover:bg-[#F8F5EF]"
                  >
                    View run
                  </Link>
                )}
                <button
                  onClick={() => runCheck(e.evidenceType as EvidenceType, e.blocking, e.policyPackId)}
                  disabled={isRunning || !canRunFromUi}
                  className="flex items-center gap-1 rounded-lg bg-[#2563EB] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                >
                  {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  {canRunFromUi ? (latestRun ? "Re-run" : "Run check") : "Run check"}
                </button>
              </div>
            </div>

            {/* How-to-pass guidance — always shown when no passing run yet */}
            {meta && !latestRun && (
              <div className="border-t border-[#F1ECE3] bg-[#FAFAF7] px-4 py-3 flex items-start gap-3">
                <div className="mt-0.5 h-4 w-4 flex-shrink-0 rounded-full bg-[#FEF3C7] flex items-center justify-center">
                  <span className="text-[9px] font-bold text-[#92400E]">?</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-[#374151] mb-0.5">How to pass this check</p>
                  <p className="text-[11px] text-[#6B7280] leading-relaxed">{meta.howToPass}</p>
                  <Link
                    href={meta.integrationHref as Route}
                    className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-[#2563EB] hover:underline"
                  >
                    Set up {meta.integrationLabel} →
                  </Link>
                </div>
              </div>
            )}

            {/* Passed state — show last passed date */}
            {latestRun && runStatus === "passed" && latestRun.completedAt && (
              <div className="border-t border-[#F1ECE3] bg-[#F0FDF4] px-4 py-2 flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-[#16A34A] flex-shrink-0" />
                <p className="text-[11px] text-[#15803D]">
                  Passed on {new Date(latestRun.completedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}
                  {latestRun.resultScore != null && <> · Score: {Math.round(latestRun.resultScore * 100)}%</>}
                </p>
              </div>
            )}

            {/* Failed state — show what failed */}
            {latestRun && runStatus === "failed" && (
              <div className="border-t border-[#FEE2E2] bg-[#FEF2F2] px-4 py-2 flex items-start gap-2">
                <XCircle className="h-3.5 w-3.5 text-[#DC2626] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-[11px] text-[#991B1B] font-medium">Check failed — re-run after fixing the issue</p>
                  {meta && (
                    <Link href={meta.integrationHref as Route} className="text-[11px] text-[#991B1B] underline">
                      Review {meta.integrationLabel}
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* All runs history */}
      {runs.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] text-[#9CA3AF] uppercase tracking-wide font-semibold mb-2">All evidence runs for this version</p>
          <div className="rounded-xl border border-[#E7DED1] bg-white overflow-hidden">
            {runs.map((run) => (
              <Link
                key={run.id}
                href={`/evidence/runs/${run.id}` as Route}
                className="group flex items-center gap-3 px-4 py-2.5 border-b border-[#F1ECE3] last:border-0 hover:bg-[#FBFAF7]"
              >
                <Badge className={`${EVIDENCE_RUN_STATUS_STYLE[run.status] ?? "bg-[#F3F4F6]"} text-[10px] font-normal w-20 justify-center`}>
                  {run.status}
                </Badge>
                <span className="text-xs text-[#374151] flex-1">{EVIDENCE_TYPE_LABELS[run.evidenceType] ?? run.evidenceType}</span>
                {run.resultScore != null && <span className="text-xs text-[#374151]">{Math.round(run.resultScore * 100)}%</span>}
                <span className="text-[10px] text-[#9CA3AF]">{run.completedAt ? new Date(run.completedAt).toLocaleDateString() : "—"}</span>
                <ChevronRight className="h-3.5 w-3.5 text-[#D1C9BD] group-hover:text-[#2563EB]" />
              </Link>
            ))}
          </div>
        </div>
      )}
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
    fetch(`/api/governance/audit?workspaceId=${encodeURIComponent(activeWorkspaceId)}&aiSystemId=${encodeURIComponent(id)}`)
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
              systemId={id}
              versionId={system.activeVersion?.id ?? versions[0]?.id ?? null}
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
