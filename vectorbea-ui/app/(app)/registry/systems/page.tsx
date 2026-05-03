"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  ChevronRight,
  FileText,
  GitBranch,
  Globe,
  Layers,
  Loader2,
  Plus,
  Scale,
  Shield,
  Wrench,
  Zap,
} from "lucide-react";
import type { Route } from "next";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import type { AiCapability, AiCapabilityType, BusinessDomain, DataSensitivity, PolicyStatus, ReliabilityRiskLevel } from "@/lib/api";
import { canUseAICapabilities } from "@/lib/behavioral-gate";
import { useWorkspace } from "@/lib/workspace-context";

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<AiCapabilityType, string> = {
  prompt:              "Prompt",
  skill:               "Skill",
  agent_workflow:      "Agent Workflow",
  rag_workflow:        "RAG Workflow",
  mcp_workflow:        "MCP Workflow",
  content_generation:  "Content Generation",
  classification:      "Classification",
  extraction:          "Extraction",
  customer_support:    "Customer Support",
  internal_automation: "Internal Automation",
  custom:              "Custom",
};

const TYPE_ICONS: Partial<Record<AiCapabilityType, React.ElementType>> = {
  prompt:              Layers,
  skill:               Wrench,
  agent_workflow:      Bot,
  rag_workflow:        Globe,
  mcp_workflow:        GitBranch,
  content_generation:  Zap,
  classification:      Shield,
  extraction:          FileText,
};

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

const SENSITIVITY_STYLE: Record<DataSensitivity, string> = {
  public:       "bg-[#ECFDF5] text-[#065F46]",
  internal:     "bg-[#F3F4F6] text-[#374151]",
  confidential: "bg-[#FFFBEB] text-[#92400E]",
  restricted:   "bg-[#FFF7ED] text-[#C2410C]",
  regulated:    "bg-[#FEF2F2] text-[#991B1B]",
};

const ALL_TYPES: AiCapabilityType[] = [
  "prompt","skill","agent_workflow","rag_workflow","mcp_workflow",
  "content_generation","classification","extraction","customer_support","internal_automation","custom",
];

const ALL_RISKS: ReliabilityRiskLevel[] = ["low","medium","high","critical"];
const ALL_SENSITIVITIES: DataSensitivity[] = ["public","internal","confidential","restricted","regulated"];

const ALL_DOMAINS: BusinessDomain[] = [
  "customer_support","finance","claims","refunds","healthcare_triage",
  "pharma_documentation","travel_booking","software_support",
  "content_generation","internal_automation","sales","operations","general",
];

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" });
}

// ─── Gate banner ──────────────────────────────────────────────────────────────

function GateBanner() {
  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="AI Registry" subtitle="Register and govern your AI systems" />
      <div className="px-4 py-12 md:px-6 xl:px-8 flex flex-col items-center text-center max-w-lg mx-auto gap-6">
        <div className="rounded-full bg-[#EFF6FF] p-5"><Bot className="h-10 w-10 text-[#2563EB]" /></div>
        <div>
          <h2 className="text-2xl font-bold text-[#111111] mb-3">AI Registry — available on Pro</h2>
          <p className="text-sm text-[#6B7280] leading-relaxed">
            Register AI systems, apply governance policies, track version lifecycles, and gate releases
            with evaluation evidence. Covers all AI capability types.
          </p>
        </div>
        <Link href="/settings/billing" className="rounded-xl bg-[#2563EB] px-6 py-3 text-sm font-semibold text-white hover:bg-[#1D4ED8]">
          Upgrade to Pro
        </Link>
      </div>
    </div>
  );
}

// ─── Create AI System dialog ──────────────────────────────────────────────────

function CreateSystemDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (cap: AiCapability) => void;
}) {
  const { activeWorkspaceId } = useWorkspace();
  const [name, setName]               = useState("");
  const [description, setDesc]        = useState("");
  const [type, setType]               = useState<AiCapabilityType>("agent_workflow");
  const [domain, setDomain]           = useState<BusinessDomain>("general");
  const [riskLevel, setRisk]          = useState<ReliabilityRiskLevel>("medium");
  const [dataSensitivity, setSensit]  = useState<DataSensitivity>("internal");
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim() || !activeWorkspaceId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/registry/systems?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description || null, type, businessDomain: domain, riskLevel, dataSensitivity }),
      });
      const json = (await res.json()) as AiCapability & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to create");
      onCreated(json);
      setName(""); setDesc(""); setType("agent_workflow"); setDomain("general"); setRisk("medium"); setSensit("internal");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create AI system");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg border-[#E7DED1] bg-white">
        <DialogHeader>
          <DialogTitle className="text-[#111111]">Register AI System</DialogTitle>
          <DialogDescription className="text-[#6B7280]">
            Register a prompt, skill, agent, workflow, or custom AI behavior as a governed system.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div>
            <label className="block mb-1 text-xs font-semibold text-[#374151]">Name *</label>
            <input
              className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-[#111111] focus:border-[#2563EB] focus:outline-none"
              placeholder="e.g. Customer refund agent"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="block mb-1 text-xs font-semibold text-[#374151]">Description</label>
            <textarea
              className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-[#111111] focus:border-[#2563EB] focus:outline-none resize-none"
              rows={2}
              placeholder="What does this AI system do?"
              value={description}
              onChange={(e) => setDesc(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block mb-1 text-xs font-semibold text-[#374151]">Type *</label>
              <Select value={type} onChange={(e) => setType(e.target.value as AiCapabilityType)}>
                {ALL_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </Select>
            </div>
            <div>
              <label className="block mb-1 text-xs font-semibold text-[#374151]">Risk level</label>
              <Select value={riskLevel} onChange={(e) => setRisk(e.target.value as ReliabilityRiskLevel)}>
                {ALL_RISKS.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block mb-1 text-xs font-semibold text-[#374151]">Data sensitivity</label>
              <Select value={dataSensitivity} onChange={(e) => setSensit(e.target.value as DataSensitivity)}>
                {ALL_SENSITIVITIES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </Select>
            </div>
            <div>
              <label className="block mb-1 text-xs font-semibold text-[#374151]">Business domain</label>
              <Select value={domain} onChange={(e) => setDomain(e.target.value as BusinessDomain)}>
                {ALL_DOMAINS.map((d) => <option key={d} value={d}>{d.replaceAll("_", " ")}</option>)}
              </Select>
            </div>
          </div>
          {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B]">{error}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-xl border border-[#E7DED1] px-4 py-2 text-sm text-[#374151] hover:bg-[#F8F5EF]">Cancel</button>
            <button
              type="button"
              disabled={!name.trim() || saving}
              onClick={handleCreate}
              className="rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50 flex items-center gap-1.5"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Register system
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── System row ───────────────────────────────────────────────────────────────

function SystemRow({ cap }: { cap: AiCapability }) {
  const Icon = TYPE_ICONS[cap.type] ?? Layers;
  const isSynthetic = cap.id.startsWith("prompt:");
  const href = isSynthetic
    ? (`/prompts/${cap.promptId}` as Route)
    : (`/registry/systems/${cap.id}` as Route);
  const policyStatus = (cap.policyStatus ?? "no_policy") as PolicyStatus;

  return (
    <Link href={href} className="group block">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#F1ECE3] hover:bg-[#FBFAF7] transition-colors">
        {/* Icon + name */}
        <div className="rounded-lg bg-[#EFF6FF] p-1.5 flex-shrink-0">
          <Icon className="h-3.5 w-3.5 text-[#2563EB]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-[#111111] text-sm truncate">{cap.name}</p>
          {cap.description && (
            <p className="text-[10px] text-[#9CA3AF] truncate">{cap.description}</p>
          )}
        </div>
        {/* Type */}
        <div className="hidden sm:block w-32 flex-shrink-0">
          <span className="text-xs text-[#6B7280]">{TYPE_LABELS[cap.type] ?? cap.type}</span>
        </div>
        {/* Risk */}
        <div className="hidden md:block w-20 flex-shrink-0">
          <Badge className={`${RISK_STYLE[cap.riskLevel]} text-[10px] font-normal`}>
            {cap.riskLevel}
          </Badge>
        </div>
        {/* Sensitivity */}
        <div className="hidden lg:block w-24 flex-shrink-0">
          <Badge className={`${SENSITIVITY_STYLE[cap.dataSensitivity ?? "internal"]} text-[10px] font-normal`}>
            {cap.dataSensitivity ?? "internal"}
          </Badge>
        </div>
        {/* Policy */}
        <div className="hidden md:block w-32 flex-shrink-0">
          <Badge className={`${POLICY_STYLE[policyStatus]} text-[10px] font-normal`}>
            {POLICY_LABEL[policyStatus]}
          </Badge>
        </div>
        {/* Status */}
        <div className="w-24 flex-shrink-0">
          <Badge className={`${STATUS_STYLE[cap.status] ?? "bg-[#F3F4F6] text-[#6B7280]"} text-[10px] font-normal`}>
            {cap.status}
          </Badge>
        </div>
        {/* Versions */}
        <div className="hidden sm:block w-14 flex-shrink-0 text-xs text-[#6B7280] text-right">
          {cap.versionCount ?? 0}v
        </div>
        <ChevronRight className="h-4 w-4 text-[#D1C9BD] group-hover:text-[#2563EB] flex-shrink-0" />
      </div>
    </Link>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RegistrySystemsPage() {
  const { activeWorkspaceId, planTier } = useWorkspace();
  const [systems, setSystems]     = useState<AiCapability[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [showCreate, setCreate]   = useState(false);
  const [typeFilter, setTypeF]    = useState<AiCapabilityType | "all">("all");
  const [riskFilter, setRiskF]    = useState<ReliabilityRiskLevel | "all">("all");
  const [statusFilter, setStatusF] = useState<string>("all");
  const [policyFilter, setPolicyF] = useState<string>("all");

  const gated = !canUseAICapabilities(planTier);

  useEffect(() => {
    if (!activeWorkspaceId || gated) { setLoading(false); return; }
    setLoading(true);
    fetch(`/api/registry/systems?workspaceId=${encodeURIComponent(activeWorkspaceId)}`)
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setSystems(data as AiCapability[]);
        else setError((data as { error?: string }).error ?? "Failed to load");
      })
      .catch(() => setError("Failed to load AI systems"))
      .finally(() => setLoading(false));
  }, [activeWorkspaceId, gated]);

  if (gated) return <GateBanner />;

  const filtered = systems.filter((s) => {
    if (typeFilter !== "all" && s.type !== typeFilter) return false;
    if (riskFilter !== "all" && s.riskLevel !== riskFilter) return false;
    if (statusFilter !== "all" && s.status !== statusFilter) return false;
    if (policyFilter !== "all" && (s.policyStatus ?? "no_policy") !== policyFilter) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="AI Registry"
        subtitle="Register, version, and govern every AI system in your organization"
        actions={
          <button
            onClick={() => setCreate(true)}
            className="flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
          >
            <Plus className="h-4 w-4" />
            Register system
          </button>
        }
      />

      <div className="px-4 py-6 md:px-6 xl:px-8 space-y-5">
        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <Select
            value={typeFilter}
            onChange={(e) => setTypeF(e.target.value as AiCapabilityType | "all")}
            className="text-xs w-36"
          >
            <option value="all">All types</option>
            {ALL_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </Select>
          <Select
            value={riskFilter}
            onChange={(e) => setRiskF(e.target.value as ReliabilityRiskLevel | "all")}
            className="text-xs w-32"
          >
            <option value="all">All risks</option>
            {ALL_RISKS.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)} risk</option>)}
          </Select>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusF(e.target.value)}
            className="text-xs w-36"
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="blocked">Blocked</option>
            <option value="under_review">Under review</option>
          </Select>
          <Select
            value={policyFilter}
            onChange={(e) => setPolicyF(e.target.value)}
            className="text-xs w-40"
          >
            <option value="all">All policy states</option>
            <option value="no_policy">No policy</option>
            <option value="assigned">Policy assigned</option>
            <option value="satisfied">Policy satisfied</option>
            <option value="incomplete">Incomplete</option>
            <option value="violation">Violation</option>
          </Select>
          {(typeFilter !== "all" || riskFilter !== "all" || statusFilter !== "all" || policyFilter !== "all") && (
            <button
              onClick={() => { setTypeF("all"); setRiskF("all"); setStatusF("all"); setPolicyF("all"); }}
              className="text-xs text-[#6B7280] hover:text-[#374151] underline"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total systems", value: systems.length, color: "text-[#111111]" },
            { label: "Active", value: systems.filter((s) => s.status === "active").length, color: "text-[#065F46]" },
            { label: "No policy", value: systems.filter((s) => (s.policyStatus ?? "no_policy") === "no_policy").length, color: "text-[#92400E]" },
            { label: "Blocked", value: systems.filter((s) => s.status === "blocked").length, color: "text-[#991B1B]" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-[#E7DED1] bg-white px-4 py-3">
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
              <p className="text-xs text-[#6B7280] mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="rounded-xl border border-[#E7DED1] bg-white overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-[#F1ECE3] bg-[#FBFAF7]">
            <div className="w-5 flex-shrink-0" />
            <div className="flex-1 text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wide">Name</div>
            <div className="hidden sm:block w-32 flex-shrink-0 text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wide">Type</div>
            <div className="hidden md:block w-20 flex-shrink-0 text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wide">Risk</div>
            <div className="hidden lg:block w-24 flex-shrink-0 text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wide">Sensitivity</div>
            <div className="hidden md:block w-32 flex-shrink-0 text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wide">Policy</div>
            <div className="w-24 flex-shrink-0 text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wide">Status</div>
            <div className="hidden sm:block w-14 flex-shrink-0 text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wide text-right">Ver.</div>
            <div className="w-4 flex-shrink-0" />
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#6B7280]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading AI systems…
            </div>
          )}

          {!loading && error && (
            <div className="flex items-center gap-2 px-4 py-8 text-sm text-[#991B1B]">
              <AlertTriangle className="h-4 w-4" /> {error}
            </div>
          )}

          {!loading && !error && filtered.length === 0 && systems.length === 0 && (
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              <div className="rounded-full bg-[#EFF6FF] p-4">
                <Bot className="h-8 w-8 text-[#2563EB]" />
              </div>
              <div>
                <p className="font-semibold text-[#111111]">No AI systems registered yet</p>
                <p className="text-sm text-[#6B7280] mt-1">Register your first AI system to start applying policies and collecting release evidence.</p>
              </div>
              <button
                onClick={() => setCreate(true)}
                className="flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
              >
                <Plus className="h-4 w-4" /> Register system
              </button>
            </div>
          )}

          {!loading && !error && filtered.length === 0 && systems.length > 0 && (
            <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-[#6B7280]">
              <Scale className="h-8 w-8 text-[#D1C9BD]" />
              No systems match the current filters.
            </div>
          )}

          {!loading && !error && filtered.map((cap) => (
            <SystemRow key={cap.id} cap={cap} />
          ))}
        </div>
      </div>

      <CreateSystemDialog
        open={showCreate}
        onClose={() => setCreate(false)}
        onCreated={(cap) => setSystems((prev) => [cap, ...prev])}
      />
    </div>
  );
}
