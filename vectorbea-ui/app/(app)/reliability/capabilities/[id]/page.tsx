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
  DollarSign,
  FileCode2,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  XCircle,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type {
  AiCapability,
  CapabilityCostAnalytics,
  CapabilityVersion,
  CapabilityVersionStatus,
  ReliabilityCheckReport,
  ReliabilityRule,
  ReliabilityRuleType,
  ReliabilityRiskLevel,
  WorkflowTrace,
} from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function fmtMs(ms: number | null | undefined) {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtCost(cost: number | null | undefined) {
  if (cost == null) return "—";
  if (cost < 0.0001) return "<$0.0001";
  return `$${cost.toFixed(4)}`;
}

const RISK_STYLE: Record<string, string> = {
  low: "bg-[#ECFDF5] text-[#065F46]", medium: "bg-[#FFFBEB] text-[#92400E]",
  high: "bg-[#FFF7ED] text-[#C2410C]", critical: "bg-[#FEF2F2] text-[#991B1B]",
};
const VER_STYLE: Record<CapabilityVersionStatus, string> = {
  draft: "bg-[#F3F4F6] text-[#374151]",
  candidate: "bg-[#EFF6FF] text-[#1D4ED8]",
  active: "bg-[#ECFDF5] text-[#065F46]",
  deprecated: "bg-[#F3F4F6] text-[#6B7280]",
};
const CHECK_STYLE: Record<string, string> = {
  passed: "bg-[#ECFDF5] text-[#065F46]",
  failed: "bg-[#FEF2F2] text-[#991B1B]",
  needs_review: "bg-[#FFFBEB] text-[#92400E]",
  error: "bg-[#FEF2F2] text-[#991B1B]",
};

const RULE_TYPES: ReliabilityRuleType[] = [
  "tool_required","tool_forbidden","tool_sequence","argument_validation",
  "cost_threshold","latency_threshold","max_tool_calls",
  "output_contains","output_not_contains","regex_check","pii_detection",
  "human_handoff_required","final_action_condition","tool_result_condition",
  "business_policy","business_outcome","schema_validation",
];

const RULE_TYPE_LABELS: Record<ReliabilityRuleType, string> = {
  tool_required: "Tool required",
  tool_forbidden: "Tool forbidden",
  tool_sequence: "Tool sequence",
  argument_validation: "Argument validation",
  cost_threshold: "Cost threshold",
  latency_threshold: "Latency threshold",
  max_tool_calls: "Max tool calls",
  output_contains: "Output contains",
  output_not_contains: "Output not contains",
  regex_check: "Regex check",
  pii_detection: "PII detection",
  human_handoff_required: "Human handoff required",
  final_action_condition: "Final action condition",
  tool_result_condition: "Tool result condition",
  business_policy: "Business policy",
  business_outcome: "Business outcome",
  schema_validation: "Schema validation",
};

// ─── Config fields per rule type ──────────────────────────────────────────────

function ConfigFields({ ruleType, config, setConfig }: {
  ruleType: ReliabilityRuleType;
  config: Record<string, unknown>;
  setConfig: (c: Record<string, unknown>) => void;
}) {
  function field(key: string, label: string, placeholder?: string, type = "text") {
    return (
      <div key={key}>
        <label className="block mb-1 text-[10px] font-semibold text-[#6B7280] uppercase tracking-wider">{label}</label>
        <input
          type={type}
          className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-1.5 text-xs text-[#111111] focus:border-[#2563EB] focus:outline-none"
          placeholder={placeholder}
          value={String(config[key] ?? "")}
          onChange={(e) => setConfig({ ...config, [key]: type === "number" ? Number(e.target.value) : e.target.value })}
        />
      </div>
    );
  }

  switch (ruleType) {
    case "tool_required":     return field("required_tool", "Required tool name", "e.g. getOrder");
    case "tool_forbidden":    return field("forbidden_tool", "Forbidden tool name", "e.g. deleteAccount");
    case "tool_sequence":
      return <div className="grid grid-cols-2 gap-2">{field("required_before", "Must run before", "e.g. checkEligibility")}{field("target_tool", "Target tool", "e.g. createRefund")}</div>;
    case "cost_threshold":    return field("max_cost", "Max cost (USD)", "0.05", "number");
    case "latency_threshold": return field("max_latency_ms", "Max latency (ms)", "4000", "number");
    case "max_tool_calls":
      return <div className="grid grid-cols-2 gap-2">{field("tool", "Tool name", "e.g. searchPolicy")}{field("max_calls", "Max calls", "2", "number")}</div>;
    case "output_contains":   return field("text", "Required text", "e.g. confirmation");
    case "output_not_contains": return field("text", "Forbidden text", "e.g. unauthorized");
    case "regex_check":       return field("pattern", "Regex pattern", "e.g. \\d{4}-\\d{4}");
    case "argument_validation":
      return (
        <div className="space-y-2">
          {field("tool", "Tool name", "e.g. createRefund")}
          {field("argument", "Argument", "e.g. refundAmount")}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block mb-1 text-[10px] font-semibold text-[#6B7280] uppercase tracking-wider">Operator</label>
              <select
                className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-1.5 text-xs text-[#111111]"
                value={String(config.operator ?? "<=")}
                onChange={(e) => setConfig({ ...config, operator: e.target.value })}
              >
                {["==", "!=", "<", "<=", ">", ">="].map((op) => <option key={op} value={op}>{op}</option>)}
              </select>
            </div>
            {field("compare_to_result_field", "Compare to result field", "e.g. eligibleAmount")}
          </div>
        </div>
      );
    case "final_action_condition": return field("expected_action", "Expected action", "e.g. escalate_to_human");
    case "tool_result_condition":
      return (
        <div className="space-y-2">
          {field("tool", "Tool name", "e.g. checkEligibility")}
          {field("result_field", "Result field", "e.g. eligible")}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block mb-1 text-[10px] font-semibold text-[#6B7280] uppercase tracking-wider">Operator</label>
              <select
                className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-1.5 text-xs text-[#111111]"
                value={String(config.operator ?? "==")}
                onChange={(e) => setConfig({ ...config, operator: e.target.value })}
              >
                {["==", "!=", "<", "<=", ">", ">="].map((op) => <option key={op} value={op}>{op}</option>)}
              </select>
            </div>
            {field("value", "Expected value", "e.g. true")}
          </div>
        </div>
      );
    default:
      return (
        <div>
          <label className="block mb-1 text-[10px] font-semibold text-[#6B7280] uppercase tracking-wider">Config (JSON)</label>
          <textarea
            className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-1.5 text-xs text-[#111111] font-mono resize-none"
            rows={3}
            value={JSON.stringify(config, null, 2)}
            onChange={(e) => { try { setConfig(JSON.parse(e.target.value)); } catch { /* ignore */ } }}
          />
        </div>
      );
  }
}

// ─── Add rule dialog ──────────────────────────────────────────────────────────

function AddRuleDialog({
  open,
  onClose,
  capabilityId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  capabilityId: string;
  onCreated: (rule: ReliabilityRule) => void;
}) {
  const { activeWorkspaceId } = useWorkspace();
  const [name, setName]           = useState("");
  const [description, setDesc]    = useState("");
  const [ruleType, setType]       = useState<ReliabilityRuleType>("tool_required");
  const [severity, setSeverity]   = useState<ReliabilityRiskLevel>("medium");
  const [config, setConfig]       = useState<Record<string, unknown>>({});
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim() || !activeWorkspaceId) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/reliability/rules?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description || null, ruleType, severity, config, capabilityId }),
      });
      const json = (await res.json()) as ReliabilityRule & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to create");
      onCreated(json);
      setName(""); setDesc(""); setType("tool_required"); setSeverity("medium"); setConfig({});
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl border-[#E7DED1] bg-white max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[#111111]">Add reliability rule</DialogTitle>
          <DialogDescription className="text-[#6B7280]">Deterministic check — no LLM required.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div>
            <label className="block mb-1 text-xs font-semibold text-[#374151]">Rule name *</label>
            <input className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-[#111111] focus:border-[#2563EB] focus:outline-none" placeholder="e.g. Refund requires eligibility check" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block mb-1 text-xs font-semibold text-[#374151]">Rule type *</label>
              <select className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-xs text-[#111111]" value={ruleType} onChange={(e) => { setType(e.target.value as ReliabilityRuleType); setConfig({}); }}>
                {RULE_TYPES.map((t) => <option key={t} value={t}>{RULE_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="block mb-1 text-xs font-semibold text-[#374151]">Severity</label>
              <select className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-xs text-[#111111]" value={severity} onChange={(e) => setSeverity(e.target.value as ReliabilityRiskLevel)}>
                {(["low","medium","high","critical"] as const).map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
          </div>
          {/* Dynamic config fields */}
          <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">Rule configuration</p>
            <ConfigFields ruleType={ruleType} config={config} setConfig={setConfig} />
          </div>
          <div>
            <label className="block mb-1 text-xs font-semibold text-[#374151]">Description (optional)</label>
            <textarea className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-1.5 text-xs text-[#111111] resize-none" rows={2} value={description} onChange={(e) => setDesc(e.target.value)} />
          </div>
          {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B]">{error}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-xl border border-[#E7DED1] px-4 py-2 text-sm text-[#374151] hover:bg-[#F8F5EF]">Cancel</button>
            <button type="button" disabled={!name.trim() || saving} onClick={handleCreate} className="rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50 flex items-center gap-1.5">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save rule
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

type Tab = "overview" | "versions" | "traces" | "rules" | "checks" | "cost";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CapabilityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { activeWorkspaceId } = useWorkspace();

  const [cap, setCap]             = useState<AiCapability | null>(null);
  const [versions, setVersions]   = useState<CapabilityVersion[]>([]);
  const [traces, setTraces]       = useState<WorkflowTrace[]>([]);
  const [rules, setRules]         = useState<ReliabilityRule[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [tab, setTab]             = useState<Tab>("overview");
  const [showAddRule, setAddRule] = useState(false);
  const [selectedTrace, setTrace] = useState<WorkflowTrace | null>(null);
  const [checkReport, setReport]  = useState<ReliabilityCheckReport | null>(null);
  const [running, setRunning]     = useState(false);
  const [costAnalytics, setCostAnalytics] = useState<CapabilityCostAnalytics | null>(null);
  const [costLoading, setCostLoading] = useState(false);

  const load = useCallback(async () => {
    if (!activeWorkspaceId || !id) return;
    setLoading(true); setError(null);
    try {
      const [capRes, versionRes, tracesRes, rulesRes] = await Promise.all([
        fetch(`/api/reliability/capabilities/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
        fetch(`/api/reliability/capabilities/${encodeURIComponent(id)}/versions?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
        fetch(`/api/reliability/traces?workspaceId=${encodeURIComponent(activeWorkspaceId)}&capabilityId=${encodeURIComponent(id)}&limit=20`, { cache: "no-store" }),
        fetch(`/api/reliability/rules?workspaceId=${encodeURIComponent(activeWorkspaceId)}&capabilityId=${encodeURIComponent(id)}`, { cache: "no-store" }),
      ]);
      const [capJson, verJson, tracesJson, rulesJson] = await Promise.all([capRes.json(), versionRes.json(), tracesRes.json(), rulesRes.json()]);
      if (!capRes.ok) throw new Error(capJson.error ?? "Not found");
      setCap(capJson as AiCapability);
      setVersions(Array.isArray(verJson) ? verJson as CapabilityVersion[] : []);
      setTraces(Array.isArray(tracesJson) ? tracesJson as WorkflowTrace[] : []);
      setRules(Array.isArray(rulesJson) ? rulesJson as ReliabilityRule[] : []);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, [activeWorkspaceId, id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!activeWorkspaceId || !id || tab !== "cost" || costAnalytics) return;
    let cancelled = false;
    setCostLoading(true);
    fetch(`/api/reliability/capabilities/${encodeURIComponent(id)}/cost?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" })
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (cancelled) return;
        if (!ok) throw new Error(json.error ?? "Failed to load cost analytics");
        setCostAnalytics(json as CapabilityCostAnalytics);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setCostLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeWorkspaceId, id, tab, costAnalytics]);

  async function runChecks(trace: WorkflowTrace) {
    if (!activeWorkspaceId || running) return;
    setRunning(true); setReport(null);
    try {
      const res = await fetch(`/api/reliability/checks?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowTraceId: trace.id, capabilityId: id }),
      });
      const json = await res.json() as ReliabilityCheckReport & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setReport(json);
      setTab("checks");
    } catch (e) {
      console.error(e);
    } finally { setRunning(false); }
  }

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>;
  if (error || !cap) return <div className="px-4 py-8"><div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error ?? "Capability not found"}</div></div>;

  const tabItems: Array<{ key: Tab; label: string; count?: number }> = [
    { key: "overview",  label: "Overview" },
    { key: "versions",  label: "Versions",  count: versions.length },
    { key: "traces",    label: "Traces",    count: traces.length },
    { key: "rules",     label: "Rules",     count: rules.length },
    { key: "checks",    label: "Checks" },
    { key: "cost",      label: "Cost" },
  ];

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title={cap.name} subtitle={`${cap.type.replaceAll("_", " ")} · ${cap.businessDomain.replaceAll("_", " ")}`} />
      <div className="px-4 py-6 md:px-6 xl:px-8 space-y-5">

        {/* Breadcrumb */}
        <Link href="/reliability/capabilities" className="inline-flex items-center gap-1.5 text-xs text-[#6B7280] hover:text-[#2563EB]">
          <ChevronLeft className="h-3.5 w-3.5" />Back to capabilities
        </Link>

        {/* Header card */}
        <Card className="border-[#E7DED1] bg-white">
          <CardContent className="pt-4 pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  <Badge className="bg-[#EFF6FF] text-[#1D4ED8]">{cap.type.replaceAll("_", " ")}</Badge>
                  <Badge className={RISK_STYLE[cap.riskLevel]}>{cap.riskLevel} risk</Badge>
                  <Badge className="bg-[#F0F9FF] text-[#0369A1]">{cap.businessDomain.replaceAll("_", " ")}</Badge>
                  <Badge className={cap.status === "active" ? "bg-[#ECFDF5] text-[#065F46]" : "bg-[#F3F4F6] text-[#6B7280]"}>{cap.status}</Badge>
                </div>
                {cap.description && <p className="text-sm text-[#6B7280]">{cap.description}</p>}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#6B7280]">
                  {cap.versionCount != null && <span><span className="font-medium text-[#374151]">Versions</span> {cap.versionCount}</span>}
                  {cap.activeVersion && <span><span className="font-medium text-[#374151]">Active</span> v{cap.activeVersion.versionNumber}</span>}
                  <span><span className="font-medium text-[#374151]">Rules</span> {rules.length}</span>
                  <span><span className="font-medium text-[#374151]">Created</span> {fmtDate(cap.createdAt)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/reliability/capabilities/${id}/regression-suites`} className="inline-flex items-center gap-1 rounded-xl border border-[#D8CFC2] bg-white px-3 py-2 text-xs font-medium text-[#111111] hover:bg-[#F8F5EF]">
                  <GitBranch className="h-3.5 w-3.5" />Regression suites
                </Link>
                <button type="button" onClick={() => void load()} className="flex items-center gap-1 text-xs text-[#6B7280] hover:text-[#2563EB]">
                  <RefreshCw className="h-3.5 w-3.5" />Refresh
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <div className="flex gap-0.5 rounded-xl border border-[#E7DED1] bg-[#F1EDE6] p-1 overflow-x-auto">
          {tabItems.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                tab === t.key ? "bg-white text-[#111111] shadow-sm" : "text-[#6B7280] hover:text-[#374151]"
              }`}
            >
              {t.label}
              {t.count != null && t.count > 0 && (
                <span className="rounded bg-[#EFF6FF] text-[#1D4ED8] px-1.5 py-0.5 text-[10px] font-semibold">{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Overview tab ── */}
        {tab === "overview" && (
          <div className="grid gap-5 md:grid-cols-2">
            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="pb-2"><CardTitle className="text-[#111111] text-sm">Details</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {[
                  ["Type", cap.type.replaceAll("_", " ")],
                  ["Business domain", cap.businessDomain.replaceAll("_", " ")],
                  ["Risk level", cap.riskLevel],
                  ["Status", cap.status],
                  ["Created", fmtDate(cap.createdAt)],
                  ["Updated", fmtDate(cap.updatedAt)],
                  ...(cap.promptId ? [["Prompt ID", cap.promptId.slice(0, 8) + "…"]] : []),
                ].map(([label, value]) => (
                  <div key={String(label)} className="flex justify-between text-xs">
                    <span className="font-medium text-[#374151]">{label}</span>
                    <span className="text-[#6B7280]">{value}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="pb-2"><CardTitle className="text-[#111111] text-sm">Recent activity</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {traces.slice(0, 5).map((t) => (
                  <div key={t.id} className="flex items-center justify-between text-xs">
                    <span className="text-[#374151] truncate max-w-[180px]">{t.userInput?.slice(0, 40) ?? t.id.slice(0, 8)}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge className={t.status === "completed" ? "bg-[#ECFDF5] text-[#065F46]" : "bg-[#FEF2F2] text-[#991B1B]"}>{t.status}</Badge>
                      <span className="text-[#6B7280]">{fmtMs(t.totalLatencyMs)}</span>
                    </div>
                  </div>
                ))}
                {traces.length === 0 && <p className="text-xs text-[#6B7280]">No traces yet</p>}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Versions tab ── */}
        {tab === "versions" && (
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-[#111111]">Versions</CardTitle>
            </CardHeader>
            <CardContent>
              {versions.length === 0 ? (
                <p className="text-sm text-[#6B7280]">No versions yet. Create one via the API: POST /api/reliability/capabilities/{"{id}"}/versions</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#EFE7DA] text-xs text-[#6B7280]">
                        <th className="py-2 text-left font-semibold">Version</th>
                        <th className="py-2 text-left font-semibold">Name</th>
                        <th className="py-2 text-left font-semibold">Status</th>
                        <th className="py-2 text-left font-semibold">Created</th>
                        <th className="py-2 text-left font-semibold">Activated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {versions.map((v) => (
                        <tr key={v.id} className="border-b border-[#F1ECE3] last:border-0">
                          <td className="py-2.5 font-mono text-[#111111] font-semibold">{v.versionNumber}</td>
                          <td className="py-2.5 text-[#374151]">{v.name ?? "—"}</td>
                          <td className="py-2.5"><Badge className={VER_STYLE[v.status]}>{v.status}</Badge></td>
                          <td className="py-2.5 text-[#6B7280] text-xs">{fmtDate(v.createdAt)}</td>
                          <td className="py-2.5 text-[#6B7280] text-xs">{fmtDate(v.activatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Traces tab ── */}
        {tab === "traces" && (
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-[#111111]">Workflow traces</CardTitle>
              <span className="text-xs text-[#6B7280]">Last 20</span>
            </CardHeader>
            <CardContent>
              {traces.length === 0 ? (
                <p className="text-sm text-[#6B7280]">No traces yet. Send workflow traces via POST /api/reliability/traces</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#EFE7DA] text-xs text-[#6B7280]">
                        <th className="py-2 text-left font-semibold">Input</th>
                        <th className="py-2 text-left font-semibold">Status</th>
                        <th className="py-2 text-right font-semibold">Latency</th>
                        <th className="py-2 text-right font-semibold">Cost</th>
                        <th className="py-2 text-left font-semibold">Created</th>
                        <th className="py-2 text-right font-semibold">Run checks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {traces.map((t) => (
                        <tr key={t.id} className="border-b border-[#F1ECE3] last:border-0">
                          <td className="py-2.5 text-[#374151] max-w-[200px] truncate text-xs">{t.userInput?.slice(0, 50) ?? t.id.slice(0, 8)}</td>
                          <td className="py-2.5">
                            <Badge className={t.status === "completed" ? "bg-[#ECFDF5] text-[#065F46]" : "bg-[#FEF2F2] text-[#991B1B]"}>{t.status}</Badge>
                          </td>
                          <td className="py-2.5 text-right text-[#374151] text-xs">{fmtMs(t.totalLatencyMs)}</td>
                          <td className="py-2.5 text-right text-[#374151] text-xs">{fmtCost(t.totalCostEstimate)}</td>
                          <td className="py-2.5 text-[#6B7280] text-xs">{fmtDate(t.createdAt)}</td>
                          <td className="py-2.5 text-right">
                            <button
                              type="button"
                              disabled={running}
                              onClick={() => void runChecks(t)}
                              className="text-xs text-[#2563EB] hover:text-[#1D4ED8] disabled:opacity-50 flex items-center gap-1 ml-auto"
                            >
                              {running && selectedTrace?.id === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Shield className="h-3 w-3" />}
                              Run
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Rules tab ── */}
        {tab === "rules" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-[#111111]">{rules.length} rule{rules.length !== 1 ? "s" : ""}</p>
              <button type="button" onClick={() => setAddRule(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]">
                <Plus className="h-4 w-4" />Add rule
              </button>
            </div>
            {rules.length === 0 ? (
              <Card className="border-[#E7DED1] bg-white">
                <CardContent className="py-10 text-center">
                  <Shield className="h-8 w-8 text-[#D8CFC2] mx-auto mb-2" />
                  <p className="text-sm font-medium text-[#374151] mb-1">No rules yet</p>
                  <p className="text-xs text-[#6B7280] mb-3">Add deterministic rules to verify this capability&apos;s behavior — no LLM required.</p>
                  <button type="button" onClick={() => setAddRule(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]">
                    <Plus className="h-4 w-4" />Add first rule
                  </button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {rules.map((rule) => (
                  <Card key={rule.id} className="border-[#E7DED1] bg-white">
                    <CardContent className="py-3 px-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-[#111111]">{rule.name}</span>
                            <Badge className={RISK_STYLE[rule.severity]}>{rule.severity}</Badge>
                            <Badge className="bg-[#F0F9FF] text-[#0369A1] text-[10px]">{RULE_TYPE_LABELS[rule.ruleType]}</Badge>
                            {!rule.enabled && <Badge className="bg-[#F3F4F6] text-[#6B7280] text-[10px]">disabled</Badge>}
                          </div>
                          {rule.plainEnglish && (
                            <p className="text-xs text-[#374151] italic">&ldquo;{rule.plainEnglish}&rdquo;</p>
                          )}
                          {rule.description && <p className="text-xs text-[#6B7280]">{rule.description}</p>}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Checks tab ── */}
        {tab === "checks" && (
          <div className="space-y-4">
            {!checkReport && (
              <Card className="border-[#E7DED1] bg-white">
                <CardContent className="py-10 text-center">
                  <Shield className="h-8 w-8 text-[#D8CFC2] mx-auto mb-2" />
                  <p className="text-sm font-medium text-[#374151] mb-1">No check report yet</p>
                  <p className="text-xs text-[#6B7280]">Go to the Traces tab and click Run on a trace to generate a reliability check report.</p>
                </CardContent>
              </Card>
            )}
            {checkReport && <ReliabilityReport report={checkReport} />}
          </div>
        )}

        {tab === "cost" && (
          <div className="space-y-4">
            {costLoading && (
              <div className="flex items-center gap-2 text-sm text-[#6B7280]">
                <Loader2 className="h-4 w-4 animate-spin" />Loading cost analytics…
              </div>
            )}
            {!costLoading && costAnalytics && (
              <>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <Card className="border-[#E7DED1] bg-white"><CardContent className="pt-4"><p className="text-xs text-[#6B7280]">Cost per run</p><p className="mt-2 text-2xl font-semibold text-[#111111]">{fmtCost(costAnalytics.averageCostPerRun)}</p></CardContent></Card>
                  <Card className="border-[#E7DED1] bg-white"><CardContent className="pt-4"><p className="text-xs text-[#6B7280]">Cost per successful run</p><p className="mt-2 text-2xl font-semibold text-[#065F46]">{fmtCost(costAnalytics.costPerSuccessfulRun)}</p></CardContent></Card>
                  <Card className="border-[#E7DED1] bg-white"><CardContent className="pt-4"><p className="text-xs text-[#6B7280]">Failure cost</p><p className="mt-2 text-2xl font-semibold text-[#991B1B]">{fmtCost(costAnalytics.totalFailureCost)}</p></CardContent></Card>
                  <Card className="border-[#E7DED1] bg-white"><CardContent className="pt-4"><p className="text-xs text-[#6B7280]">Retry cost</p><p className="mt-2 text-2xl font-semibold text-[#92400E]">{fmtCost(costAnalytics.totalRetryCost)}</p></CardContent></Card>
                </div>

                <div className="grid gap-5 xl:grid-cols-2">
                  <Card className="border-[#E7DED1] bg-white">
                    <CardHeader className="pb-2"><CardTitle className="text-[#111111] text-sm">Provider and model cost</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                      {costAnalytics.costByProvider.map((entry) => (
                        <div key={`${entry.provider}-${entry.model}`} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-medium text-[#111111]">{entry.provider} · {entry.model}</p>
                            <p className="text-sm font-semibold text-[#111111]">{fmtCost(entry.averageCost)}</p>
                          </div>
                          <p className="mt-1 text-xs text-[#6B7280]">{entry.runs} runs · {entry.successRate}% success · total {fmtCost(entry.totalCost)}</p>
                        </div>
                      ))}
                      {costAnalytics.costByProvider.length === 0 && <p className="text-sm text-[#6B7280]">No provider cost breakdown yet.</p>}
                    </CardContent>
                  </Card>

                  <Card className="border-[#E7DED1] bg-white">
                    <CardHeader className="pb-2"><CardTitle className="text-[#111111] text-sm">Step level cost breakdown</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                      {costAnalytics.stepCostBreakdown.slice(0, 8).map((step) => (
                        <div key={`${step.stepName}-${step.stepType}`} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-medium text-[#111111]">{step.stepName}</p>
                            <p className="text-sm font-semibold text-[#111111]">{fmtCost(step.totalCost)}</p>
                          </div>
                          <p className="mt-1 text-xs text-[#6B7280]">{step.stepType} · avg {fmtCost(step.averageCost)} · {step.runs} runs</p>
                        </div>
                      ))}
                      {costAnalytics.mostExpensiveTool && (
                        <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-sm text-[#92400E]">
                          Most expensive tool: <span className="font-semibold">{costAnalytics.mostExpensiveTool.toolName}</span> · total {fmtCost(costAnalytics.mostExpensiveTool.totalCost)}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <AddRuleDialog
        open={showAddRule}
        onClose={() => setAddRule(false)}
        capabilityId={id}
        onCreated={(rule) => setRules((prev) => [rule, ...prev])}
      />
    </div>
  );
}

// ─── Reliability check report component ──────────────────────────────────────

function ReliabilityReport({ report }: { report: ReliabilityCheckReport }) {
  const statusStyle = CHECK_STYLE[report.overallStatus] ?? CHECK_STYLE.error;
  const statusIcon = report.overallStatus === "passed" ? CheckCircle2 :
    report.overallStatus === "failed" ? XCircle : AlertTriangle;
  const StatusIcon = statusIcon;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <Card className={`border ${report.overallStatus === "passed" ? "border-[#A7F3D0] bg-[#ECFDF5]" : report.overallStatus === "failed" ? "border-[#FECACA] bg-[#FEF2F2]" : "border-[#FDE68A] bg-[#FFFBEB]"}`}>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-2 mb-3">
            <StatusIcon className={`h-5 w-5 ${report.overallStatus === "passed" ? "text-[#065F46]" : report.overallStatus === "failed" ? "text-[#991B1B]" : "text-[#92400E]"}`} />
            <span className="font-bold text-[#111111]">Reliability check: <span className={statusStyle.split(" ")[1]!}>{report.overallStatus.replaceAll("_", " ")}</span></span>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <div><span className="font-medium text-[#065F46]">{report.passedCount}</span> <span className="text-[#6B7280]">passed</span></div>
            <div><span className="font-medium text-[#991B1B]">{report.failedCount}</span> <span className="text-[#6B7280]">failed</span></div>
            <div><span className="font-medium text-[#6B7280]">{report.skippedCount}</span> <span className="text-[#6B7280]">skipped</span></div>
            {report.criticalFailures.length > 0 && (
              <div><span className="font-bold text-[#991B1B]">{report.criticalFailures.length}</span> <span className="text-[#991B1B]">critical failures</span></div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Critical failures */}
      {report.criticalFailures.length > 0 && (
        <Card className="border-[#FECACA] bg-white">
          <CardHeader className="pb-2"><CardTitle className="text-[#991B1B] text-sm flex items-center gap-1.5"><XCircle className="h-4 w-4" />Critical failures</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {report.criticalFailures.map((r) => (
              <div key={r.id} className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs">
                <div className="font-semibold text-[#991B1B]">{r.rule?.name ?? r.ruleId}</div>
                <div className="text-[#7F1D1D] mt-0.5">{r.message}</div>
                {r.rule?.plainEnglish && <div className="text-[#6B7280] mt-0.5 italic">Expected: {r.rule.plainEnglish}</div>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* All results */}
      <Card className="border-[#E7DED1] bg-white">
        <CardHeader className="pb-2"><CardTitle className="text-[#111111] text-sm">All rule results</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#EFE7DA] text-xs text-[#6B7280]">
                  <th className="py-2 text-left font-semibold">Rule</th>
                  <th className="py-2 text-left font-semibold">Type</th>
                  <th className="py-2 text-left font-semibold">Severity</th>
                  <th className="py-2 text-left font-semibold">Status</th>
                  <th className="py-2 text-left font-semibold">Message</th>
                </tr>
              </thead>
              <tbody>
                {report.allResults.map((r, i) => (
                  <tr key={r.id || i} className="border-b border-[#F1ECE3] last:border-0">
                    <td className="py-2.5 font-medium text-[#111111] text-xs">{r.rule?.name ?? r.ruleId.slice(0, 8)}</td>
                    <td className="py-2.5 text-xs text-[#374151]">{r.rule ? RULE_TYPE_LABELS[r.rule.ruleType] : "—"}</td>
                    <td className="py-2.5"><Badge className={RISK_STYLE[r.severity]}>{r.severity}</Badge></td>
                    <td className="py-2.5">
                      <Badge className={CHECK_STYLE[r.status] ?? "bg-[#F3F4F6] text-[#374151]"}>{r.status}</Badge>
                    </td>
                    <td className="py-2.5 text-xs text-[#6B7280] max-w-[240px]">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
