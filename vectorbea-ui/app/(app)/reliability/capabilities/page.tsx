"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  ChevronRight,
  GitBranch,
  Globe,
  Layers,
  Loader2,
  Plus,
  Shield,
  Wrench,
  Zap,
} from "lucide-react";
import type { Route } from "next";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AiCapability, AiCapabilityType, BusinessDomain, ReliabilityRiskLevel } from "@/lib/api";
import { Select } from "@/components/ui/select";
import { useWorkspace } from "@/lib/workspace-context";
import { canUseAICapabilities } from "@/lib/behavioral-gate";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<AiCapabilityType, string> = {
  prompt:               "Prompt",
  skill:                "Skill",
  agent_workflow:       "Agent workflow",
  rag_workflow:         "RAG workflow",
  mcp_workflow:         "MCP workflow",
  content_generation:   "Content generation",
  classification:       "Classification",
  extraction:           "Extraction",
  customer_support:     "Customer support",
  internal_automation:  "Internal automation",
};

const TYPE_ICONS: Partial<Record<AiCapabilityType, React.ElementType>> = {
  prompt:              Layers,
  skill:               Wrench,
  agent_workflow:      Bot,
  rag_workflow:        Globe,
  mcp_workflow:        GitBranch,
  content_generation:  Zap,
  classification:      Shield,
};

const RISK_STYLE: Record<ReliabilityRiskLevel, string> = {
  low:      "bg-[#ECFDF5] text-[#065F46]",
  medium:   "bg-[#FFFBEB] text-[#92400E]",
  high:     "bg-[#FFF7ED] text-[#C2410C]",
  critical: "bg-[#FEF2F2] text-[#991B1B]",
};

const STATUS_STYLE: Record<string, string> = {
  passed:       "bg-[#ECFDF5] text-[#065F46]",
  failed:       "bg-[#FEF2F2] text-[#991B1B]",
  needs_review: "bg-[#FFFBEB] text-[#92400E]",
  unknown:      "bg-[#F3F4F6] text-[#6B7280]",
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" });
}

const ALL_TYPES: AiCapabilityType[] = [
  "prompt","skill","agent_workflow","rag_workflow","mcp_workflow",
  "content_generation","classification","extraction","customer_support","internal_automation",
];

const ALL_DOMAINS: BusinessDomain[] = [
  "customer_support","finance","claims","refunds","healthcare_triage",
  "pharma_documentation","travel_booking","software_support",
  "content_generation","internal_automation","sales","operations","general",
];

const ALL_RISKS: ReliabilityRiskLevel[] = ["low","medium","high","critical"];

// ─── Gate banner ──────────────────────────────────────────────────────────────

function GateBanner() {
  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="AI Capabilities" subtitle="Pro feature" />
      <div className="px-4 py-12 md:px-6 xl:px-8 flex flex-col items-center text-center max-w-lg mx-auto gap-6">
        <div className="rounded-full bg-[#EFF6FF] p-5"><Bot className="h-10 w-10 text-[#2563EB]" /></div>
        <div>
          <h2 className="text-2xl font-bold text-[#111111] mb-3">AI Capabilities — available on Pro</h2>
          <p className="text-sm text-[#6B7280] leading-relaxed">
            Register prompts, skills, agents, RAG workflows, and MCP workflows as versioned AI capabilities.
            Run deterministic reliability checks, capture workflow traces, and ensure safe rollout.
          </p>
        </div>
        <Link href="/settings/billing" className="rounded-xl bg-[#2563EB] px-6 py-3 text-sm font-semibold text-white hover:bg-[#1D4ED8]">
          Upgrade to Pro
        </Link>
      </div>
    </div>
  );
}

// ─── Create capability dialog ─────────────────────────────────────────────────

function CreateCapabilityDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (cap: AiCapability) => void;
}) {
  const { activeWorkspaceId } = useWorkspace();
  const [name, setName]             = useState("");
  const [description, setDesc]      = useState("");
  const [type, setType]             = useState<AiCapabilityType>("prompt");
  const [domain, setDomain]         = useState<BusinessDomain>("general");
  const [riskLevel, setRisk]        = useState<ReliabilityRiskLevel>("medium");
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim() || !activeWorkspaceId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/reliability/capabilities?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description || null, type, businessDomain: domain, riskLevel }),
      });
      const json = (await res.json()) as AiCapability & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to create");
      onCreated(json);
      setName(""); setDesc(""); setType("prompt"); setDomain("general"); setRisk("medium");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create capability");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg border-[#E7DED1] bg-white">
        <DialogHeader>
          <DialogTitle className="text-[#111111]">Create AI Capability</DialogTitle>
          <DialogDescription className="text-[#6B7280]">
            Register a prompt, skill, agent, workflow, or any AI behavior unit.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div>
            <label className="block mb-1 text-xs font-semibold text-[#374151]">Name *</label>
            <input
              className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-[#111111] focus:border-[#2563EB] focus:outline-none"
              placeholder="e.g. Refund policy agent"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="block mb-1 text-xs font-semibold text-[#374151]">Description</label>
            <textarea
              className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-[#111111] focus:border-[#2563EB] focus:outline-none resize-none"
              rows={2}
              placeholder="What does this capability do?"
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
          <div>
            <label className="block mb-1 text-xs font-semibold text-[#374151]">Business domain</label>
            <Select value={domain} onChange={(e) => setDomain(e.target.value as BusinessDomain)}>
              {ALL_DOMAINS.map((d) => <option key={d} value={d}>{d.replaceAll("_", " ")}</option>)}
            </Select>
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
              Create capability
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Capability card ──────────────────────────────────────────────────────────

function CapabilityCard({ cap }: { cap: AiCapability }) {
  const Icon = TYPE_ICONS[cap.type] ?? Layers;
  const isSynthetic = cap.id.startsWith("prompt:");
  const href = isSynthetic
    ? (`/prompts/${cap.promptId}` as Route)
    : (`/reliability/capabilities/${cap.id}` as Route);

  return (
    <Link href={href} className="block group">
      <div className="rounded-xl border border-[#E7DED1] bg-white p-4 hover:border-[#2563EB] hover:shadow-sm transition-all">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-[#EFF6FF] p-2 flex-shrink-0">
            <Icon className="h-4 w-4 text-[#2563EB]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-[#111111] text-sm leading-snug">{cap.name}</p>
                {cap.description && (
                  <p className="text-xs text-[#6B7280] mt-0.5 line-clamp-1">{cap.description}</p>
                )}
              </div>
              <ChevronRight className="h-4 w-4 text-[#6B7280] group-hover:text-[#2563EB] flex-shrink-0 mt-0.5" />
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <Badge className="bg-[#F3F4F6] text-[#374151] font-normal text-[10px]">{TYPE_LABELS[cap.type]}</Badge>
              <Badge className={`${RISK_STYLE[cap.riskLevel]} font-normal text-[10px]`}>{cap.riskLevel} risk</Badge>
              {cap.businessDomain !== "general" && (
                <Badge className="bg-[#F0F9FF] text-[#0369A1] font-normal text-[10px]">{cap.businessDomain.replaceAll("_", " ")}</Badge>
              )}
              {isSynthetic && <Badge className="bg-[#F3F4F6] text-[#6B7280] font-normal text-[10px]">prompt compat</Badge>}
              {cap.lastCheckStatus && (
                <Badge className={`${STATUS_STYLE[cap.lastCheckStatus]} font-normal text-[10px]`}>{cap.lastCheckStatus.replaceAll("_", " ")}</Badge>
              )}
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-4 text-[10px] text-[#6B7280] border-t border-[#F1ECE3] pt-2">
          {cap.versionCount != null && <span>{cap.versionCount} version{cap.versionCount !== 1 ? "s" : ""}</span>}
          {cap.activeVersion && <span className="text-[#065F46]">Active: v{cap.activeVersion.versionNumber}</span>}
          <span className="ml-auto">Created {fmtDate(cap.createdAt)}</span>
        </div>
      </div>
    </Link>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CapabilitiesPage() {
  const { activeWorkspaceId, planTier } = useWorkspace();
  const [caps, setCaps]         = useState<AiCapability[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [showCreate, setCreate] = useState(false);
  const [typeFilter, setTypeFilter] = useState<AiCapabilityType | "all">("all");

  useEffect(() => {
    if (!activeWorkspaceId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/reliability/capabilities?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json: AiCapability[] | { error?: string }) => {
        if (!cancelled) {
          if (!Array.isArray(json)) setError((json as { error?: string }).error ?? "Failed to load");
          else setCaps(json);
          setLoading(false);
        }
      })
      .catch((e: Error) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [activeWorkspaceId]);

  if (!canUseAICapabilities(planTier)) return <GateBanner />;

  const filtered = typeFilter === "all" ? caps : caps.filter((c) => c.type === typeFilter);

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="AI Capabilities" subtitle="Prompts, skills, agents, and workflows" />
      <div className="px-4 py-6 md:px-6 xl:px-8 space-y-5">

        {/* Header bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Bot className="h-5 w-5 text-[#2563EB]" />
            <h2 className="text-base font-semibold text-[#111111]">Capabilities</h2>
            {caps.length > 0 && <Badge className="bg-[#EFF6FF] text-[#1D4ED8]">{caps.length}</Badge>}
            {/* Type filter */}
            <Select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as AiCapabilityType | "all")}
              className="text-xs"
            >
              <option value="all">All types</option>
              {ALL_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </Select>
          </div>
          <button
            type="button"
            onClick={() => setCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
          >
            <Plus className="h-4 w-4" />New capability
          </button>
        </div>

        {/* Info callout */}
        <div className="rounded-xl border border-[#E7DED1] bg-white px-4 py-3 text-sm text-[#374151]">
          <span className="font-semibold text-[#111111]">AI Capabilities</span> represent any AI behavior unit — prompts, skills, agents, workflows.
          Existing prompts appear here automatically as <span className="font-medium">prompt compat</span> entries.
          Create native capability records to enable versioning, rules, and reliability checks.
        </div>

        {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error}</div>}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-[#6B7280]">
            <Loader2 className="h-4 w-4 animate-spin" />Loading capabilities…
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <Card className="border-[#E7DED1] bg-white">
            <CardContent className="py-16 text-center">
              <Bot className="h-10 w-10 text-[#D8CFC2] mx-auto mb-3" />
              <p className="text-sm font-semibold text-[#374151] mb-1">
                {typeFilter === "all" ? "No capabilities yet" : `No ${TYPE_LABELS[typeFilter as AiCapabilityType]} capabilities`}
              </p>
              <p className="text-xs text-[#6B7280] mb-4">
                Create your first AI Capability or link an existing prompt.
              </p>
              <button
                type="button"
                onClick={() => setCreate(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
              >
                <Plus className="h-4 w-4" />Create capability
              </button>
            </CardContent>
          </Card>
        )}

        {/* Grid */}
        {!loading && filtered.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((cap) => <CapabilityCard key={cap.id} cap={cap} />)}
          </div>
        )}
      </div>

      <CreateCapabilityDialog
        open={showCreate}
        onClose={() => setCreate(false)}
        onCreated={(cap) => setCaps((prev) => [cap, ...prev])}
      />
    </div>
  );
}
