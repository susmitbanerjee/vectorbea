"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FlaskConical,
  GripVertical,
  Info,
  Loader2,
  PlusCircle,
  Save,
  Settings2,
  Shield,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { Route } from "next";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuPanel,
  DropdownMenuPanelRadioItem,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  BehavioralDataset,
  BehavioralDatasetItem,
  BehavioralPromptType,
  EvaluationRubric,
  ProviderArenaCandidateInput,
  BehavioralEvaluationRunView,
  RubricDimension,
  RubricRule,
  RubricRuleType,
  RubricSeverity,
  RiskLevel,
} from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { canUseBehavioralEvaluations } from "@/lib/behavioral-gate";

// ── Constants ──────────────────────────────────────────────────────────────────

const PROMPT_TYPE_LABELS: Record<BehavioralPromptType, string> = {
  customer_support: "Customer support",
  rag_answer: "RAG answer",
  summarization: "Summarization",
  classification: "Classification",
  extraction: "Extraction",
  agent_workflow: "Agent workflow",
  general: "General",
};

const RISK_LEVEL_COLORS: Record<RiskLevel, string> = {
  low:      "bg-[#ECFDF5] text-[#065F46]",
  medium:   "bg-[#FFFBEB] text-[#92400E]",
  high:     "bg-[#FFF7ED] text-[#9A3412]",
  critical: "bg-[#FEF2F2] text-[#991B1B]",
};

const SEVERITY_COLORS: Record<RubricSeverity, string> = {
  low:      "bg-[#F0FDF4] text-[#166534]",
  medium:   "bg-[#FFFBEB] text-[#92400E]",
  high:     "bg-[#FFF7ED] text-[#9A3412]",
  critical: "bg-[#FEF2F2] text-[#991B1B]",
};

// Default dimension templates by prompt type
const DEFAULT_DIMENSIONS: Record<BehavioralPromptType, Array<{ name: string; weight: number; description: string }>> = {
  customer_support: [
    { name: "Policy compliance",    weight: 35, description: "Response adheres to company policy and handles edge cases correctly" },
    { name: "Helpfulness",          weight: 25, description: "Response fully addresses the customer need" },
    { name: "Tone",                 weight: 15, description: "Response uses appropriate tone — empathetic but professional" },
    { name: "Specificity",          weight: 15, description: "Response includes concrete next steps or answers" },
    { name: "Safety",               weight: 10, description: "No harmful advice, medical, legal, or financial guidance without caveats" },
  ],
  rag_answer: [
    { name: "Faithfulness to context",  weight: 35, description: "All claims are grounded in the retrieved context" },
    { name: "Answer relevance",          weight: 25, description: "Response directly addresses the question" },
    { name: "Citation quality",          weight: 15, description: "Sources are referenced clearly when appropriate" },
    { name: "Completeness",              weight: 15, description: "All important aspects of the question are addressed" },
    { name: "No hallucination",          weight: 10, description: "No fabricated facts beyond the provided context" },
  ],
  summarization: [
    { name: "Faithfulness",                  weight: 35, description: "Summary does not contradict the source material" },
    { name: "Coverage",                      weight: 25, description: "Key points from the source are included" },
    { name: "Conciseness",                   weight: 15, description: "No unnecessary padding or repetition" },
    { name: "Important detail preservation", weight: 15, description: "Critical facts, numbers, and names are retained" },
    { name: "No invented facts",             weight: 10, description: "No claims that are not present in the source" },
  ],
  classification: [
    { name: "Label accuracy",    weight: 40, description: "Correct category or label is assigned" },
    { name: "Reasoning quality", weight: 30, description: "Rationale for the classification is sound" },
    { name: "Confidence calibration", weight: 20, description: "Confidence score reflects actual certainty" },
    { name: "Edge case handling", weight: 10, description: "Ambiguous inputs are handled gracefully" },
  ],
  extraction: [
    { name: "Schema validity",       weight: 30, description: "Output conforms to the required schema" },
    { name: "Field correctness",     weight: 30, description: "Extracted field values match the source" },
    { name: "No invented values",    weight: 20, description: "No values are hallucinated from missing data" },
    { name: "Missing value handling",weight: 20, description: "Null or absent fields are handled per spec" },
  ],
  agent_workflow: [
    { name: "Goal completion",   weight: 35, description: "Agent achieves the stated objective" },
    { name: "Tool use quality",  weight: 25, description: "Correct tools are called with valid arguments" },
    { name: "No hallucination",  weight: 20, description: "No invented results or tool outputs" },
    { name: "Safety",            weight: 20, description: "No destructive actions without confirmation" },
  ],
  general: [
    { name: "Accuracy",       weight: 35, description: "Output is factually correct and complete" },
    { name: "Relevance",      weight: 25, description: "Output directly addresses the input" },
    { name: "Quality",        weight: 20, description: "Output is well-written and clear" },
    { name: "Safety",         weight: 20, description: "Output is safe and appropriate" },
  ],
};

// ── Tabs ───────────────────────────────────────────────────────────────────────

type Tab = "items" | "rubric" | "scenarios" | "runs";

const TABS: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
  { id: "items",     label: "Items",     icon: ClipboardList },
  { id: "rubric",    label: "Rubric",    icon: Settings2 },
  { id: "scenarios", label: "Scenarios", icon: BookOpen },
  { id: "runs",      label: "Runs",      icon: FlaskConical },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function weightColor(total: number): string {
  if (total === 100) return "text-[#065F46]";
  if (total > 100) return "text-red-600";
  return "text-[#B45309]";
}

// ── Items tab ──────────────────────────────────────────────────────────────────

function ItemsTab({
  datasetId,
  workspaceId,
}: {
  datasetId: string;
  workspaceId: string;
}) {
  const [items, setItems] = useState<BehavioralDatasetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add item form
  const [showAdd, setShowAdd] = useState(false);
  const [input, setInput] = useState("");
  const [context, setContext] = useState("");
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("medium");
  const [tagsInput, setTagsInput] = useState("");
  const [referenceOutput, setReferenceOutput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Edit
  const [editId, setEditId] = useState<string | null>(null);
  const [editInput, setEditInput] = useState("");
  const [editContext, setEditContext] = useState("");
  const [editRisk, setEditRisk] = useState<RiskLevel>("medium");
  const [editTags, setEditTags] = useState("");
  const [editRef, setEditRef] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Expand
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // CSV import
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/evaluations/behavioral/${encodeURIComponent(datasetId)}/items?workspaceId=${encodeURIComponent(workspaceId)}`,
        { cache: "no-store" },
      );
      const json = await res.json() as BehavioralDatasetItem[] | { error: string };
      if (!res.ok) throw new Error((json as { error: string }).error);
      setItems(json as BehavioralDatasetItem[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load items");
    } finally {
      setLoading(false);
    }
  }, [datasetId, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const handleAdd = async () => {
    if (!input.trim()) { setSaveError("Input is required"); return; }
    setSaving(true); setSaveError(null);
    try {
      const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
      const res = await fetch(
        `/api/evaluations/behavioral/${encodeURIComponent(datasetId)}/items?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: input.trim(),
            context: context.trim() || null,
            riskLevel,
            tags,
            referenceOutput: referenceOutput.trim() || null,
          }),
        },
      );
      const json = await res.json() as BehavioralDatasetItem & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      setItems((prev) => [...prev, json]);
      setShowAdd(false); setInput(""); setContext(""); setRiskLevel("medium"); setTagsInput(""); setReferenceOutput("");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(
        `/api/evaluations/behavioral/${encodeURIComponent(datasetId)}/items/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(workspaceId)}`,
        { method: "DELETE" },
      );
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch { /* silent */ }
  };

  const startEdit = (item: BehavioralDatasetItem) => {
    setEditId(item.id);
    setEditInput(item.input);
    setEditContext(item.context ?? "");
    setEditRisk(item.riskLevel);
    setEditTags(item.tags.join(", "));
    setEditRef(item.referenceOutput ?? "");
  };

  const saveEdit = async () => {
    if (!editId) return;
    setEditSaving(true);
    try {
      const tags = editTags.split(",").map((t) => t.trim()).filter(Boolean);
      const res = await fetch(
        `/api/evaluations/behavioral/${encodeURIComponent(datasetId)}/items/${encodeURIComponent(editId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: editInput.trim(),
            context: editContext.trim() || null,
            riskLevel: editRisk,
            tags,
            referenceOutput: editRef.trim() || null,
          }),
        },
      );
      const json = await res.json() as BehavioralDatasetItem & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      setItems((prev) => prev.map((i) => i.id === editId ? json : i));
      setEditId(null);
    } catch { /* silent */ }
    finally { setEditSaving(false); }
  };

  const handleCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target?.result as string;
      const lines = text.trim().split(/\r?\n/);
      if (lines.length < 2) return;
      const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
      const rows = lines.slice(1).map((line) => {
        const vals = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
        const row: Record<string, string> = {};
        headers.forEach((h, i) => { row[h] = vals[i] ?? ""; });
        return row;
      }).filter((r) => r.input?.trim());

      if (rows.length === 0) return;

      const res = await fetch(
        `/api/evaluations/behavioral/${encodeURIComponent(datasetId)}/items?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: rows.map((r) => ({
              input: r.input,
              context: r.context || null,
              riskLevel: (["low","medium","high","critical"].includes(r.risk_level) ? r.risk_level : "medium") as RiskLevel,
              tags: r.tags ? r.tags.split("|").map((t: string) => t.trim()) : [],
              referenceOutput: r.reference_output || null,
            })),
          }),
        },
      );
      if (res.ok) void load();
    };
    reader.readAsText(file);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-[#6B7280]">
        <Loader2 className="h-4 w-4 animate-spin" />Loading items…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-[#6B7280]">{items.length} item{items.length !== 1 ? "s" : ""}</p>
        <div className="ml-auto flex gap-2">
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCSV} />
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-[#E7DED1] text-xs"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />Import CSV
          </Button>
          <Button
            size="sm"
            onClick={() => setShowAdd((v) => !v)}
            className="gap-1.5 bg-[#2563EB] text-white hover:bg-[#1D4ED8] text-xs"
          >
            {showAdd ? <X className="h-3.5 w-3.5" /> : <PlusCircle className="h-3.5 w-3.5" />}
            {showAdd ? "Cancel" : "Add item"}
          </Button>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <Card className="border-[#E7DED1] bg-white">
          <CardContent className="space-y-3 p-4">
            {saveError && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                {saveError}
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                Input <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111] placeholder:text-[#9CA3AF] focus:border-[#2563EB] focus:outline-none resize-none"
                placeholder="The user message or prompt input…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Context</label>
                <textarea
                  rows={2}
                  className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111] placeholder:text-[#9CA3AF] focus:border-[#2563EB] focus:outline-none resize-none"
                  placeholder="Optional system context or retrieved docs…"
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Reference output (optional)</label>
                <textarea
                  rows={2}
                  className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111] placeholder:text-[#9CA3AF] focus:border-[#2563EB] focus:outline-none resize-none"
                  placeholder="Known-good response for reference…"
                  value={referenceOutput}
                  onChange={(e) => setReferenceOutput(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Tags</label>
                <input
                  className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111] placeholder:text-[#9CA3AF] focus:border-[#2563EB] focus:outline-none"
                  placeholder="refund, angry customer, policy-sensitive"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                />
                <p className="text-[11px] text-[#9CA3AF]">Comma-separated</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Risk level</label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 text-sm capitalize text-[#111111]"
                    >
                      <span className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${RISK_LEVEL_COLORS[riskLevel]}`}>
                        {riskLevel}
                      </span>
                      <ChevronDown className="h-4 w-4 text-[#9CA3AF]" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
                    <DropdownMenuRadioGroup value={riskLevel} onValueChange={(v) => setRiskLevel(v as RiskLevel)}>
                      {(["low","medium","high","critical"] as RiskLevel[]).map((r) => (
                        <DropdownMenuPanelRadioItem key={r} value={r} className="capitalize">{r}</DropdownMenuPanelRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuPanel>
                </DropdownMenu>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleAdd}
                disabled={saving}
                className="gap-2 bg-[#2563EB] text-white hover:bg-[#1D4ED8] text-sm"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
                Add item
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* CSV hint */}
      <div className="rounded-xl border border-[#E7DED1] bg-[#FAFAF7] px-4 py-3 text-xs text-[#6B7280]">
        <strong className="text-[#374151]">CSV import format:</strong>{" "}
        <code className="rounded bg-[#F1ECE3] px-1">input</code> (required),{" "}
        <code className="rounded bg-[#F1ECE3] px-1">context</code>,{" "}
        <code className="rounded bg-[#F1ECE3] px-1">risk_level</code> (low/medium/high/critical),{" "}
        <code className="rounded bg-[#F1ECE3] px-1">tags</code> (pipe-separated),{" "}
        <code className="rounded bg-[#F1ECE3] px-1">reference_output</code>
      </div>

      {/* Empty state */}
      {items.length === 0 && !showAdd && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[#E7DED1] bg-white py-12 text-center">
          <ClipboardList className="h-8 w-8 text-[#9CA3AF]" />
          <p className="text-sm font-medium text-[#374151]">No items yet</p>
          <p className="text-xs text-[#9CA3AF]">Add inputs manually or import a CSV</p>
        </div>
      )}

      {/* Items table */}
      {items.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-[#E7DED1] bg-white">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#F1ECE3] bg-[#FAFAF7]" style={{ boxShadow: "inset 0 -1px 0 #F1ECE3" }}>
                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[#6B7280]">Input</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[#6B7280]">Context</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[#6B7280]">Tags</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[#6B7280]">Risk</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[#6B7280]">Added</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-[#6B7280]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F5F0E8]">
              {items.map((item) => (
                <React.Fragment key={item.id}>
                  {editId === item.id ? (
                    <tr className="bg-[#FAFAF7]">
                      <td colSpan={6} className="p-4">
                        <div className="space-y-3">
                          <textarea
                            rows={3}
                            className="w-full rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm text-[#111111] focus:border-[#2563EB] focus:outline-none resize-none"
                            value={editInput}
                            onChange={(e) => setEditInput(e.target.value)}
                          />
                          <div className="grid gap-3 sm:grid-cols-3">
                            <div>
                              <label className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Context</label>
                              <input
                                className="mt-1 w-full rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm text-[#111111] focus:border-[#2563EB] focus:outline-none"
                                value={editContext}
                                onChange={(e) => setEditContext(e.target.value)}
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Tags</label>
                              <input
                                className="mt-1 w-full rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm text-[#111111] focus:border-[#2563EB] focus:outline-none"
                                value={editTags}
                                onChange={(e) => setEditTags(e.target.value)}
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Risk</label>
                              <select
                                className="mt-1 w-full rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm text-[#111111] focus:border-[#2563EB] focus:outline-none capitalize"
                                value={editRisk}
                                onChange={(e) => setEditRisk(e.target.value as RiskLevel)}
                              >
                                {(["low","medium","high","critical"] as RiskLevel[]).map((r) => (
                                  <option key={r} value={r} className="capitalize">{r}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Reference output</label>
                            <input
                              className="mt-1 w-full rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm text-[#111111] focus:border-[#2563EB] focus:outline-none"
                              value={editRef}
                              onChange={(e) => setEditRef(e.target.value)}
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={saveEdit} disabled={editSaving} className="gap-1.5 bg-[#2563EB] text-white hover:bg-[#1D4ED8]">
                              {editSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Cancel</Button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr
                      className="group cursor-pointer hover:bg-[#FAFAF7] transition-colors"
                      onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                    >
                      <td className="max-w-[280px] px-4 py-3">
                        <p className="truncate text-[#111111] font-medium">{item.input}</p>
                        {expandedId === item.id && (
                          <p className="mt-1 whitespace-pre-wrap text-[#374151]">{item.input}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[#6B7280]">
                        {item.context ? (
                          <span className="rounded-md bg-[#F1ECE3] px-2 py-0.5 text-[10px] font-medium text-[#374151]">Yes</span>
                        ) : (
                          <span className="text-[#D1C9BD]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {item.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="rounded bg-[#F1ECE3] px-1.5 py-0.5 text-[10px] font-medium text-[#374151]">
                              {tag}
                            </span>
                          ))}
                          {item.tags.length > 3 && (
                            <span className="text-[#9CA3AF]">+{item.tags.length - 3}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded px-2 py-0.5 text-[10px] font-medium capitalize ${RISK_LEVEL_COLORS[item.riskLevel]}`}>
                          {item.riskLevel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#9CA3AF]">
                        {new Date(item.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); startEdit(item); }}
                            className="rounded p-1 text-[#9CA3AF] hover:text-[#2563EB]"
                            title="Edit"
                          >
                            <Settings2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void handleDelete(item.id); }}
                            className="rounded p-1 text-[#9CA3AF] hover:text-red-500"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setExpandedId(expandedId === item.id ? null : item.id); }}
                            className="rounded p-1 text-[#9CA3AF] hover:text-[#374151]"
                          >
                            {expandedId === item.id
                              ? <ChevronRight className="h-3.5 w-3.5 rotate-90" />
                              : <ChevronRight className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Rubric Builder tab ─────────────────────────────────────────────────────────

function RubricBuilderTab({
  dataset,
  workspaceId,
}: {
  dataset: BehavioralDataset;
  workspaceId: string;
}) {
  const [rubric, setRubric] = useState<EvaluationRubric | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Rubric creation form
  const [showCreateRubric, setShowCreateRubric] = useState(false);
  const [rubricName, setRubricName] = useState("");
  const [rubricGoal, setRubricGoal] = useState("");
  const [rubricPassThreshold, setRubricPassThreshold] = useState(80);
  const [judgeModel, setJudgeModel] = useState("gpt-4o");
  const [judgeProvider, setJudgeProvider] = useState("openai");
  const [creatingRubric, setCreatingRubric] = useState(false);
  const [createRubricError, setCreateRubricError] = useState<string | null>(null);

  // Dimension form
  const [showAddDim, setShowAddDim] = useState(false);
  const [dimName, setDimName] = useState("");
  const [dimDesc, setDimDesc] = useState("");
  const [dimWeight, setDimWeight] = useState(20);
  const [dimPassThreshold, setDimPassThreshold] = useState(70);
  const [savingDim, setSavingDim] = useState(false);
  const [dimError, setDimError] = useState<string | null>(null);

  // Edit dimension
  const [editDimId, setEditDimId] = useState<string | null>(null);
  const [editDimName, setEditDimName] = useState("");
  const [editDimDesc, setEditDimDesc] = useState("");
  const [editDimWeight, setEditDimWeight] = useState(20);
  const [editDimPass, setEditDimPass] = useState(70);
  const [editDimSaving, setEditDimSaving] = useState(false);

  // Rule form
  const [showAddRule, setShowAddRule] = useState<RubricRuleType | null>(null);
  const [ruleDesc, setRuleDesc] = useState("");
  const [ruleSeverity, setRuleSeverity] = useState<RubricSeverity>("medium");
  const [savingRule, setSavingRule] = useState(false);
  const [ruleError, setRuleError] = useState<string | null>(null);

  // General rubric save
  const [savingRubric, setSavingRubric] = useState(false);

  const loadRubric = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/evaluations/rubrics?workspaceId=${encodeURIComponent(workspaceId)}&datasetId=${encodeURIComponent(dataset.id)}`,
        { cache: "no-store" },
      );
      const json = await res.json() as EvaluationRubric[] | { error: string };
      if (!res.ok) throw new Error((json as { error: string }).error);
      const rubrics = json as EvaluationRubric[];
      if (rubrics.length > 0) {
        // Load full detail for first rubric
        const detailRes = await fetch(
          `/api/evaluations/rubrics/${encodeURIComponent(rubrics[0].id)}?workspaceId=${encodeURIComponent(workspaceId)}`,
          { cache: "no-store" },
        );
        const detail = await detailRes.json() as EvaluationRubric & { error?: string };
        if (detailRes.ok) setRubric(detail);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load rubric");
    } finally {
      setLoading(false);
    }
  }, [dataset.id, workspaceId]);

  useEffect(() => { void loadRubric(); }, [loadRubric]);

  const createRubric = async () => {
    if (!rubricName.trim()) { setCreateRubricError("Name is required"); return; }
    setCreatingRubric(true); setCreateRubricError(null);
    try {
      const res = await fetch(
        `/api/evaluations/rubrics?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            datasetId: dataset.id,
            name: rubricName.trim(),
            promptType: dataset.promptType,
            goal: rubricGoal.trim() || null,
            passThreshold: rubricPassThreshold,
            judgeModel: judgeModel.trim() || null,
            judgeProvider: judgeProvider.trim() || null,
          }),
        },
      );
      const json = await res.json() as EvaluationRubric & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to create");
      setRubric({ ...json, dimensions: [], rules: [] });
      setShowCreateRubric(false);
      setRubricName(""); setRubricGoal("");
    } catch (e) {
      setCreateRubricError(e instanceof Error ? e.message : "Failed to create rubric");
    } finally {
      setCreatingRubric(false);
    }
  };

  const addDefaultDimensions = async () => {
    if (!rubric) return;
    const defaults = DEFAULT_DIMENSIONS[dataset.promptType] ?? DEFAULT_DIMENSIONS.general;
    for (let i = 0; i < defaults.length; i++) {
      const d = defaults[i];
      await fetch(
        `/api/evaluations/rubrics/${encodeURIComponent(rubric.id)}/dimensions?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: d.name, description: d.description, weight: d.weight, passThreshold: 70, ord: i }),
        },
      );
    }
    void loadRubric();
  };

  const handleAddDim = async () => {
    if (!rubric || !dimName.trim()) { setDimError("Name is required"); return; }
    setSavingDim(true); setDimError(null);
    try {
      const res = await fetch(
        `/api/evaluations/rubrics/${encodeURIComponent(rubric.id)}/dimensions?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: dimName.trim(),
            description: dimDesc.trim() || null,
            weight: dimWeight,
            passThreshold: dimPassThreshold,
            ord: (rubric.dimensions?.length ?? 0),
          }),
        },
      );
      const json = await res.json() as RubricDimension & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      setRubric((r) => r ? { ...r, dimensions: [...(r.dimensions ?? []), json] } : r);
      setShowAddDim(false); setDimName(""); setDimDesc(""); setDimWeight(20); setDimPassThreshold(70);
    } catch (e) {
      setDimError(e instanceof Error ? e.message : "Failed to save dimension");
    } finally {
      setSavingDim(false);
    }
  };

  const handleDeleteDim = async (dimId: string) => {
    if (!rubric) return;
    await fetch(
      `/api/evaluations/rubrics/${encodeURIComponent(rubric.id)}/dimensions/${encodeURIComponent(dimId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
      { method: "DELETE" },
    );
    setRubric((r) => r ? { ...r, dimensions: (r.dimensions ?? []).filter((d) => d.id !== dimId) } : r);
  };

  const startEditDim = (d: RubricDimension) => {
    setEditDimId(d.id);
    setEditDimName(d.name);
    setEditDimDesc(d.description ?? "");
    setEditDimWeight(d.weight);
    setEditDimPass(d.passThreshold);
  };

  const saveEditDim = async () => {
    if (!rubric || !editDimId) return;
    setEditDimSaving(true);
    try {
      const res = await fetch(
        `/api/evaluations/rubrics/${encodeURIComponent(rubric.id)}/dimensions/${encodeURIComponent(editDimId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: editDimName.trim(),
            description: editDimDesc.trim() || null,
            weight: editDimWeight,
            passThreshold: editDimPass,
          }),
        },
      );
      const json = await res.json() as RubricDimension & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      setRubric((r) => r ? { ...r, dimensions: (r.dimensions ?? []).map((d) => d.id === editDimId ? json : d) } : r);
      setEditDimId(null);
    } finally { setEditDimSaving(false); }
  };

  const handleAddRule = async (ruleType: RubricRuleType) => {
    if (!rubric || !ruleDesc.trim()) { setRuleError("Description is required"); return; }
    setSavingRule(true); setRuleError(null);
    try {
      const res = await fetch(
        `/api/evaluations/rubrics/${encodeURIComponent(rubric.id)}/rules?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ruleType, description: ruleDesc.trim(), severity: ruleSeverity }),
        },
      );
      const json = await res.json() as RubricRule & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      setRubric((r) => r ? { ...r, rules: [...(r.rules ?? []), json] } : r);
      setShowAddRule(null); setRuleDesc(""); setRuleSeverity("medium");
    } catch (e) {
      setRuleError(e instanceof Error ? e.message : "Failed to save rule");
    } finally { setSavingRule(false); }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!rubric) return;
    await fetch(
      `/api/evaluations/rubrics/${encodeURIComponent(rubric.id)}/rules/${encodeURIComponent(ruleId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
      { method: "DELETE" },
    );
    setRubric((r) => r ? { ...r, rules: (r.rules ?? []).filter((ru) => ru.id !== ruleId) } : r);
  };

  const saveRubricMeta = async (patch: Partial<{ goal: string; passThreshold: number; judgeModel: string; judgeProvider: string }>) => {
    if (!rubric) return;
    setSavingRubric(true);
    try {
      const res = await fetch(
        `/api/evaluations/rubrics/${encodeURIComponent(rubric.id)}?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      const json = await res.json() as EvaluationRubric & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      setRubric((r) => r ? { ...r, ...json } : r);
    } finally { setSavingRubric(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-[#6B7280]">
        <Loader2 className="h-4 w-4 animate-spin" />Loading rubric…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
    );
  }

  // ── No rubric yet ──
  if (!rubric && !showCreateRubric) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-[#E7DED1] bg-white py-14 text-center">
        <Settings2 className="h-10 w-10 text-[#9CA3AF]" />
        <div>
          <p className="text-[16px] font-semibold text-[#111111]">No rubric yet</p>
          <p className="mt-1 text-sm text-[#6B7280]">
            Define how outputs should be scored — no reference answers needed.
          </p>
        </div>
        <Button
          onClick={() => setShowCreateRubric(true)}
          className="gap-2 bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
        >
          <PlusCircle className="h-4 w-4" />
          Create rubric
        </Button>
      </div>
    );
  }

  // ── Create rubric form ──
  if (!rubric && showCreateRubric) {
    return (
      <Card className="border-[#E7DED1] bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">New rubric</CardTitle>
          <CardDescription>Define the scoring goal and judge settings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {createRubricError && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              {createRubricError}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Rubric name *</label>
              <input
                className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                placeholder="e.g. Support quality rubric v1"
                value={rubricName}
                onChange={(e) => setRubricName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Pass threshold</label>
              <div className="flex items-center gap-3">
                <input
                  type="range" min={0} max={100} step={5}
                  className="w-full accent-[#2563EB]"
                  value={rubricPassThreshold}
                  onChange={(e) => setRubricPassThreshold(Number(e.target.value))}
                />
                <span className="w-10 text-right text-sm font-semibold text-[#111111]">{rubricPassThreshold}%</span>
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Goal</label>
            <textarea
              rows={2}
              className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none resize-none"
              placeholder="What should an ideal response achieve for this prompt type?"
              value={rubricGoal}
              onChange={(e) => setRubricGoal(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Judge provider</label>
              <input
                className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                placeholder="openai"
                value={judgeProvider}
                onChange={(e) => setJudgeProvider(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Judge model</label>
              <input
                className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                placeholder="gpt-4o"
                value={judgeModel}
                onChange={(e) => setJudgeModel(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={createRubric}
              disabled={creatingRubric}
              className="gap-2 bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
            >
              {creatingRubric ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings2 className="h-4 w-4" />}
              Create rubric
            </Button>
            <Button variant="ghost" onClick={() => setShowCreateRubric(false)}>Cancel</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!rubric) return null;

  const dims = rubric.dimensions ?? [];
  const rules = rubric.rules ?? [];
  const totalWeight = dims.reduce((s, d) => s + d.weight, 0);
  const mustDo    = rules.filter((r) => r.ruleType === "must_do");
  const mustNotDo = rules.filter((r) => r.ruleType === "must_not_do");
  const hardFails = rules.filter((r) => r.ruleType === "hard_fail");

  // ── Rubric editor ──
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-[#111111]">{rubric.name}</h3>
          <p className="mt-0.5 text-sm text-[#6B7280]">
            {PROMPT_TYPE_LABELS[rubric.promptType]} · Pass threshold{" "}
            <span className="font-semibold text-[#111111]">{rubric.passThreshold}%</span>
            {rubric.judgeProvider && (
              <> · Judge: <span className="font-medium text-[#374151]">{rubric.judgeProvider}/{rubric.judgeModel}</span></>
            )}
          </p>
        </div>
        {savingRubric && <Loader2 className="mt-1 h-4 w-4 animate-spin text-[#2563EB]" />}
      </div>

      {/* ── 1. Goal ── */}
      <section>
        <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">
          Goal
        </label>
        <textarea
          rows={2}
          className="w-full rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm text-[#111111] placeholder:text-[#9CA3AF] focus:border-[#2563EB] focus:outline-none resize-none"
          placeholder="What should an ideal output achieve for this prompt type?"
          defaultValue={rubric.goal ?? ""}
          onBlur={(e) => {
            if (e.target.value !== (rubric.goal ?? "")) {
              void saveRubricMeta({ goal: e.target.value });
            }
          }}
        />
      </section>

      {/* ── 2. Judge settings ── */}
      <section className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1.5">
            Pass threshold
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range" min={0} max={100} step={5}
              className="w-full accent-[#2563EB]"
              defaultValue={rubric.passThreshold}
              onMouseUp={(e) => void saveRubricMeta({ passThreshold: Number((e.target as HTMLInputElement).value) })}
            />
            <span className="w-10 shrink-0 text-right text-sm font-semibold text-[#111111]">
              {rubric.passThreshold}%
            </span>
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1.5">
            Judge provider
          </label>
          <input
            className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
            defaultValue={rubric.judgeProvider ?? ""}
            placeholder="openai"
            onBlur={(e) => void saveRubricMeta({ judgeProvider: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1.5">
            Judge model
          </label>
          <input
            className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
            defaultValue={rubric.judgeModel ?? ""}
            placeholder="gpt-4o"
            onBlur={(e) => void saveRubricMeta({ judgeModel: e.target.value })}
          />
        </div>
      </section>

      {/* ── 3. Scoring dimensions ── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-[#111111]">Scoring dimensions</h4>
            <p className="text-xs text-[#6B7280]">
              Total weight:{" "}
              <span className={`font-bold ${weightColor(totalWeight)}`}>{totalWeight}%</span>
              {totalWeight !== 100 && (
                <span className="ml-2 inline-flex items-center gap-1 text-[#B45309]">
                  <AlertTriangle className="h-3 w-3" />
                  {totalWeight < 100 ? `Need ${100 - totalWeight}% more` : `${totalWeight - 100}% over`}
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            {dims.length === 0 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-[#E7DED1] text-xs"
                onClick={addDefaultDimensions}
              >
                <Sparkles className="h-3.5 w-3.5 text-[#B45309]" />
                Use {PROMPT_TYPE_LABELS[dataset.promptType]} defaults
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-[#E7DED1] text-xs"
              onClick={() => setShowAddDim((v) => !v)}
            >
              {showAddDim ? <X className="h-3.5 w-3.5" /> : <PlusCircle className="h-3.5 w-3.5" />}
              {showAddDim ? "Cancel" : "Add dimension"}
            </Button>
          </div>
        </div>

        {/* Add dimension form */}
        {showAddDim && (
          <Card className="mb-3 border-[#E7DED1] bg-[#FAFAF7]">
            <CardContent className="space-y-3 p-4">
              {dimError && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{dimError}</div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Name *</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                    placeholder="e.g. Policy compliance"
                    value={dimName}
                    onChange={(e) => setDimName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Description</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                    placeholder="What does this dimension measure?"
                    value={dimDesc}
                    onChange={(e) => setDimDesc(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    Weight (remaining: {100 - totalWeight}%)
                  </label>
                  <div className="mt-1 flex items-center gap-3">
                    <input
                      type="range" min={0} max={100} step={5}
                      className="w-full accent-[#2563EB]"
                      value={dimWeight}
                      onChange={(e) => setDimWeight(Number(e.target.value))}
                    />
                    <span className="w-10 shrink-0 text-right text-sm font-semibold text-[#111111]">{dimWeight}%</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    Dimension pass threshold
                  </label>
                  <div className="mt-1 flex items-center gap-3">
                    <input
                      type="range" min={0} max={100} step={5}
                      className="w-full accent-[#2563EB]"
                      value={dimPassThreshold}
                      onChange={(e) => setDimPassThreshold(Number(e.target.value))}
                    />
                    <span className="w-10 shrink-0 text-right text-sm font-semibold text-[#111111]">{dimPassThreshold}%</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleAddDim}
                  disabled={savingDim}
                  className="gap-1.5 bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
                >
                  {savingDim ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlusCircle className="h-3.5 w-3.5" />}
                  Add
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowAddDim(false); setDimError(null); }}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Dimension list */}
        {dims.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#E7DED1] bg-white py-8 text-center text-sm text-[#9CA3AF]">
            No dimensions yet — add one above or use the prompt type defaults
          </div>
        ) : (
          <div className="space-y-2">
            {dims.map((dim) => (
              <div key={dim.id} className="rounded-xl border border-[#E7DED1] bg-white">
                {editDimId === dim.id ? (
                  <div className="p-4 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Name</label>
                        <input
                          className="mt-1 w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                          value={editDimName}
                          onChange={(e) => setEditDimName(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Description</label>
                        <input
                          className="mt-1 w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                          value={editDimDesc}
                          onChange={(e) => setEditDimDesc(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Weight</label>
                        <div className="mt-1 flex items-center gap-3">
                          <input type="range" min={0} max={100} step={5} className="w-full accent-[#2563EB]" value={editDimWeight} onChange={(e) => setEditDimWeight(Number(e.target.value))} />
                          <span className="w-8 text-right text-sm font-semibold">{editDimWeight}%</span>
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Pass threshold</label>
                        <div className="mt-1 flex items-center gap-3">
                          <input type="range" min={0} max={100} step={5} className="w-full accent-[#2563EB]" value={editDimPass} onChange={(e) => setEditDimPass(Number(e.target.value))} />
                          <span className="w-8 text-right text-sm font-semibold">{editDimPass}%</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveEditDim} disabled={editDimSaving} className="gap-1.5 bg-[#2563EB] text-white hover:bg-[#1D4ED8]">
                        {editDimSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditDimId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 px-4 py-3">
                    <GripVertical className="h-4 w-4 shrink-0 text-[#D1C9BD]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[#111111] text-sm">{dim.name}</span>
                        <span className="text-xs text-[#9CA3AF]">pass ≥ {dim.passThreshold}%</span>
                      </div>
                      {dim.description && (
                        <p className="mt-0.5 text-xs text-[#6B7280] truncate">{dim.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {/* Weight bar */}
                      <div className="hidden sm:flex items-center gap-2">
                        <div className="h-1.5 w-20 rounded-full bg-[#F1ECE3]">
                          <div
                            className="h-1.5 rounded-full bg-[#2563EB]"
                            style={{ width: `${dim.weight}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-[#374151] w-8 text-right">{dim.weight}%</span>
                      </div>
                      <button type="button" onClick={() => startEditDim(dim)} className="rounded p-1 text-[#9CA3AF] hover:text-[#2563EB]">
                        <Settings2 className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => void handleDeleteDim(dim.id)} className="rounded p-1 text-[#9CA3AF] hover:text-red-500">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 4. Rules ── */}
      {(
        [
          {
            type: "must_do" as RubricRuleType,
            label: "Must satisfy",
            description: "Conditions the output must meet",
            icon: Info,
            color: "text-[#065F46] bg-[#ECFDF5] border-[#A7F3D0]",
            rules: mustDo,
          },
          {
            type: "must_not_do" as RubricRuleType,
            label: "Must avoid",
            description: "Patterns the output should never contain",
            icon: AlertTriangle,
            color: "text-[#92400E] bg-[#FFFBEB] border-[#FDE68A]",
            rules: mustNotDo,
          },
          {
            type: "hard_fail" as RubricRuleType,
            label: "Hard fail conditions",
            description: "Automatic failure — overrides scoring",
            icon: Shield,
            color: "text-[#991B1B] bg-[#FEF2F2] border-[#FECACA]",
            rules: hardFails,
          },
        ] as Array<{
          type: RubricRuleType;
          label: string;
          description: string;
          icon: React.ElementType;
          color: string;
          rules: RubricRule[];
        }>
      ).map(({ type, label, description, icon: Icon, color, rules: sectionRules }) => (
        <section key={type}>
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon className={`h-4 w-4 ${color.split(" ")[0]}`} />
              <div>
                <h4 className="text-sm font-semibold text-[#111111]">{label}</h4>
                <p className="text-xs text-[#6B7280]">{description}</p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-[#E7DED1] text-xs"
              onClick={() => setShowAddRule(showAddRule === type ? null : type)}
            >
              {showAddRule === type ? <X className="h-3.5 w-3.5" /> : <PlusCircle className="h-3.5 w-3.5" />}
              {showAddRule === type ? "Cancel" : "Add"}
            </Button>
          </div>

          {showAddRule === type && (
            <Card className="mb-2 border-[#E7DED1] bg-[#FAFAF7]">
              <CardContent className="space-y-3 p-3">
                {ruleError && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{ruleError}</div>
                )}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2 space-y-1">
                    <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Description *</label>
                    <input
                      className="w-full rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                      placeholder={
                        type === "must_do" ? "Always acknowledge the customer's issue first"
                        : type === "must_not_do" ? "Never suggest contacting a competitor"
                        : "Response contains PII data"
                      }
                      value={ruleDesc}
                      onChange={(e) => setRuleDesc(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Severity</label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-[#E7DED1] bg-white px-3 text-sm"
                        >
                          <span className={`rounded px-2 py-0.5 text-[10px] font-medium capitalize ${SEVERITY_COLORS[ruleSeverity]}`}>
                            {ruleSeverity}
                          </span>
                          <ChevronDown className="h-4 w-4 text-[#9CA3AF]" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
                        <DropdownMenuRadioGroup value={ruleSeverity} onValueChange={(v) => setRuleSeverity(v as RubricSeverity)}>
                          {(["low","medium","high","critical"] as RubricSeverity[]).map((s) => (
                            <DropdownMenuPanelRadioItem key={s} value={s} className="capitalize">{s}</DropdownMenuPanelRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuPanel>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => void handleAddRule(type)}
                    disabled={savingRule}
                    className="gap-1.5 bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
                  >
                    {savingRule ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlusCircle className="h-3.5 w-3.5" />}
                    Add {type === "hard_fail" ? "hard fail" : "rule"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {sectionRules.length === 0 ? (
            <div className={`rounded-xl border px-4 py-3 text-xs text-center ${color}`}>
              No {label.toLowerCase()} rules — add one above
            </div>
          ) : (
            <div className="space-y-1.5">
              {sectionRules.map((rule) => (
                <div key={rule.id} className={`flex items-start gap-3 rounded-xl border px-4 py-2.5 ${color}`}>
                  <p className="flex-1 text-sm leading-relaxed">{rule.description}</p>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-medium capitalize ${SEVERITY_COLORS[rule.severity]}`}>
                      {rule.severity}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleDeleteRule(rule.id)}
                      className="rounded p-0.5 text-current opacity-50 hover:opacity-100"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

// ── Placeholder tabs ───────────────────────────────────────────────────────────

function PlaceholderTab({ label, description }: { label: string; description: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[#E7DED1] bg-white py-14 text-center">
      <FlaskConical className="h-8 w-8 text-[#9CA3AF]" />
      <p className="text-sm font-medium text-[#374151]">{label}</p>
      <p className="max-w-sm text-xs text-[#9CA3AF]">{description}</p>
      <span className="rounded-full border border-[#E7DED1] bg-[#F1ECE3] px-3 py-1 text-[11px] font-medium text-[#B45309]">
        Coming soon
      </span>
    </div>
  );
}

function RunsTab({ dataset, workspaceId }: { dataset: BehavioralDataset; workspaceId: string }) {
  const router = useRouter();
  const { planTier } = useWorkspace();
  const [runs, setRuns] = useState<BehavioralEvaluationRunView[]>([]);
  const [arenaRuns, setArenaRuns] = useState<BehavioralEvaluationRunView[]>([]);
  const [rubrics, setRubrics] = useState<EvaluationRubric[]>([]);
  const [providers, setProviders] = useState<Array<{ providerType: string; defaultModel: string | null }>>([]);
  const [versions, setVersions] = useState<Array<{ id: string; versionTag: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [mode, setMode] = useState<"rubric_scoring" | "provider_arena">("rubric_scoring");

  const [rubricId, setRubricId] = useState("");
  const [promptVersionId, setPromptVersionId] = useState("");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [runName, setRunName] = useState("");
  const [arenaCandidates, setArenaCandidates] = useState<ProviderArenaCandidateInput[]>([
    { provider: "", model: "", label: "" },
  ]);

  const isAllowed = canUseBehavioralEvaluations(planTier);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [runsRes, arenaRes, rubricsRes, providersRes, versionsRes] = await Promise.all([
        fetch(`/api/evaluations/behavioral-runs?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" }),
        fetch(`/api/evaluations/provider-arena?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" }),
        fetch(`/api/evaluations/rubrics?datasetId=${encodeURIComponent(dataset.id)}&workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" }),
        fetch(`/api/evaluations/providers?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" }),
        fetch(`/api/prompts/${encodeURIComponent(dataset.promptId)}/versions`, { cache: "no-store" }),
      ]);
      const [runsJson, arenaJson, rubricsJson, providersJson, versionsJson] = await Promise.all([
        runsRes.json(),
        arenaRes.json(),
        rubricsRes.json(),
        providersRes.json(),
        versionsRes.json(),
      ]) as [
        BehavioralEvaluationRunView[] | { error?: string },
        BehavioralEvaluationRunView[] | { error?: string },
        EvaluationRubric[] | { error?: string },
        Array<{ providerType: string; defaultModel: string | null }> | { error?: string },
        Array<{ id?: string; promptVersionId?: string; versionTag?: string }> | { error?: string },
      ];
      if (!runsRes.ok) throw new Error((runsJson as { error?: string }).error ?? "Failed to load runs");
      if (!arenaRes.ok) throw new Error((arenaJson as { error?: string }).error ?? "Failed to load provider arena runs");
      if (!rubricsRes.ok) throw new Error((rubricsJson as { error?: string }).error ?? "Failed to load rubrics");
      if (!providersRes.ok) throw new Error((providersJson as { error?: string }).error ?? "Failed to load providers");
      if (!versionsRes.ok) throw new Error((versionsJson as { error?: string }).error ?? "Failed to load prompt versions");

      const runRows = (runsJson as BehavioralEvaluationRunView[]).filter((run) => run.datasetId === dataset.id);
      const arenaRows = (arenaJson as BehavioralEvaluationRunView[]).filter((run) => run.datasetId === dataset.id);
      setRuns(runRows);
      setArenaRuns(arenaRows);
      const rubricRows = rubricsJson as EvaluationRubric[];
      setRubrics(rubricRows);
      const providerRows = providersJson as Array<{ providerType: string; defaultModel: string | null }>;
      setProviders(providerRows);
      const normalizedVersions = ((versionsJson as Array<{ id?: string; promptVersionId?: string; versionTag?: string }>) ?? [])
        .map((entry) => ({
          id: String(entry.id ?? entry.promptVersionId ?? "").trim(),
          versionTag: String(entry.versionTag ?? "").trim(),
        }))
        .filter((entry) => entry.id.length > 0);
      setVersions(normalizedVersions);

      if (!rubricId && rubricRows[0]?.id) setRubricId(rubricRows[0].id);
      if (!promptVersionId && normalizedVersions[0]?.id) {
        setPromptVersionId(normalizedVersions[0].id);
      }
      if (!provider && providerRows[0]?.providerType) {
        setProvider(providerRows[0].providerType);
        setModel(providerRows[0].defaultModel ?? "");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load run setup");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, dataset.id, dataset.promptId, provider, promptVersionId, rubricId]);

  useEffect(() => { void load(); }, [load]);

  // Poll every 3 seconds while any run is queued or running; stop when all are terminal
  useEffect(() => {
    const activeStatuses = new Set(["queued", "running", "pending"]);
    const terminalStatuses = new Set(["completed", "failed", "cancelled", "timed_out"]);
    const hasActive = [...runs, ...arenaRuns].some((run) => activeStatuses.has(run.status));
    const allTerminal = [...runs, ...arenaRuns].every((run) => terminalStatuses.has(run.status));
    if (!hasActive || allTerminal) return;
    const timer = setInterval(() => { void load(); }, 3000);
    return () => clearInterval(timer);
  }, [runs, arenaRuns, load]);

  useEffect(() => {
    const selected = providers.find((item) => item.providerType === provider);
    if (selected?.defaultModel) setModel(selected.defaultModel);
  }, [provider, providers]);

  const handleStart = async () => {
    if (!rubricId || !promptVersionId) {
      setError("Rubric and prompt version are required");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      if (mode === "provider_arena") {
        const candidates = arenaCandidates
          .map((candidate) => ({
            provider: candidate.provider.trim(),
            model: candidate.model.trim(),
            label: candidate.label?.trim() || undefined,
            temperature: candidate.temperature ?? null,
            maxTokens: candidate.maxTokens ?? null,
            config: candidate.config ?? {},
          }))
          .filter((candidate) => candidate.provider && candidate.model);
        if (candidates.length < 2) {
          throw new Error("Provider Arena needs at least two provider candidates");
        }
        const arenaRes = await fetch(`/api/evaluations/provider-arena?workspaceId=${encodeURIComponent(workspaceId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            datasetId: dataset.id,
            rubricId,
            promptVersionId,
            candidates,
            runName: runName.trim() || undefined,
          }),
        });
        const arenaJson = await arenaRes.json() as BehavioralEvaluationRunView & { error?: string };
        if (!arenaRes.ok) throw new Error(arenaJson.error ?? "Failed to start Provider Arena run");
        setShowSetup(false);
        router.push((`/evaluations/runs/${arenaJson.id}`) as Route);
        return;
      }

      if (!provider) {
        throw new Error("Provider is required for rubric scoring mode");
      }
      const res = await fetch(`/api/evaluations/behavioral-runs?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetId: dataset.id,
          rubricId,
          promptVersionId,
          provider,
          model: model.trim() || undefined,
          runName: runName.trim() || undefined,
        }),
      });
      const json = await res.json() as BehavioralEvaluationRunView & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to start behavioral evaluation");
      setShowSetup(false);
      router.push((`/evaluations/runs/${json.id}`) as Route);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start run");
    } finally {
      setRunning(false);
    }
  };

  if (!isAllowed) {
    return (
      <Card className="border-[#E7DED1] bg-white">
        <CardHeader>
          <CardTitle className="text-[#111111]">Behavioral evaluations are available on Pro</CardTitle>
          <CardDescription className="text-[#6B7280]">Upgrade to run rubric scoring for non deterministic prompts</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href={"/settings/billing" as Route}>
            <Button className="bg-[#2563EB] text-white hover:bg-[#1D4ED8]">Upgrade to Pro</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" />Loading runs…</div>;
  }

  return (
    <div className="space-y-4">
      <Card className="border-[#E7DED1] bg-white">
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-[#111111]">Behavioral evaluation runs</CardTitle>
            <CardDescription className="text-[#6B7280]">Run this dataset against a single provider and score output with your rubric</CardDescription>
          </div>
          <Button className="gap-2 bg-[#2563EB] text-white hover:bg-[#1D4ED8]" onClick={() => setShowSetup((prev) => !prev)}>
            <FlaskConical className="h-4 w-4" />
            {showSetup ? "Close setup" : "Run evaluation"}
          </Button>
        </CardHeader>
        {showSetup && (
          <CardContent className="space-y-4 border-t border-[#EFE7DA] pt-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Evaluation mode</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMode("rubric_scoring")}
                    className={`rounded-xl border px-3 py-2 text-sm ${mode === "rubric_scoring" ? "border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]" : "border-[#D8CFC2] bg-white text-[#374151]"}`}
                  >
                    Single provider rubric scoring
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("provider_arena")}
                    className={`rounded-xl border px-3 py-2 text-sm ${mode === "provider_arena" ? "border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]" : "border-[#D8CFC2] bg-white text-[#374151]"}`}
                  >
                    Provider Arena
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Rubric</label>
                <select className="h-10 w-full rounded-xl border border-[#D8CFC2] bg-white px-3 text-sm text-[#111111]" value={rubricId} onChange={(e) => setRubricId(e.target.value)}>
                  <option value="">Select rubric</option>
                  {rubrics.map((rubric) => <option key={rubric.id} value={rubric.id}>{rubric.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Prompt version</label>
                <select className="h-10 w-full rounded-xl border border-[#D8CFC2] bg-white px-3 text-sm text-[#111111]" value={promptVersionId} onChange={(e) => setPromptVersionId(e.target.value)}>
                  <option value="">Select prompt version</option>
                  {versions.map((version) => <option key={version.id} value={version.id}>{version.versionTag}</option>)}
                </select>
              </div>
              {mode === "rubric_scoring" && (
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Provider</label>
                <select className="h-10 w-full rounded-xl border border-[#D8CFC2] bg-white px-3 text-sm text-[#111111]" value={provider} onChange={(e) => setProvider(e.target.value)}>
                  <option value="">Select provider</option>
                  {providers.map((item) => <option key={item.providerType} value={item.providerType}>{item.providerType}</option>)}
                </select>
              </div>
              )}
              {mode === "rubric_scoring" && (
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Model</label>
                <input className="h-10 w-full rounded-xl border border-[#D8CFC2] bg-white px-3 text-sm text-[#111111]" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Use provider default model" />
              </div>
              )}
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Run name</label>
                <input className="h-10 w-full rounded-xl border border-[#D8CFC2] bg-white px-3 text-sm text-[#111111]" value={runName} onChange={(e) => setRunName(e.target.value)} placeholder="Optional run name" />
              </div>
              {mode === "provider_arena" && (
                <div className="space-y-2 md:col-span-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Provider candidates</label>
                  {arenaCandidates.map((candidate, index) => (
                    <div key={`candidate-${index}`} className="grid gap-2 md:grid-cols-4">
                      <select
                        className="h-10 rounded-xl border border-[#D8CFC2] bg-white px-3 text-sm text-[#111111]"
                        value={candidate.provider}
                        onChange={(event) => setArenaCandidates((prev) => prev.map((entry, entryIndex) => entryIndex === index ? { ...entry, provider: event.target.value } : entry))}
                      >
                        <option value="">Provider</option>
                        {providers.map((item) => <option key={item.providerType} value={item.providerType}>{item.providerType}</option>)}
                      </select>
                      <input
                        className="h-10 rounded-xl border border-[#D8CFC2] bg-white px-3 text-sm text-[#111111]"
                        value={candidate.model}
                        placeholder="Model"
                        onChange={(event) => setArenaCandidates((prev) => prev.map((entry, entryIndex) => entryIndex === index ? { ...entry, model: event.target.value } : entry))}
                      />
                      <input
                        className="h-10 rounded-xl border border-[#D8CFC2] bg-white px-3 text-sm text-[#111111]"
                        value={candidate.label ?? ""}
                        placeholder="Label"
                        onChange={(event) => setArenaCandidates((prev) => prev.map((entry, entryIndex) => entryIndex === index ? { ...entry, label: event.target.value } : entry))}
                      />
                      <div className="flex gap-2">
                        <input
                          className="h-10 w-full rounded-xl border border-[#D8CFC2] bg-white px-3 text-sm text-[#111111]"
                          value={candidate.temperature ?? ""}
                          placeholder="Temp"
                          onChange={(event) => setArenaCandidates((prev) => prev.map((entry, entryIndex) => entryIndex === index ? { ...entry, temperature: event.target.value ? Number(event.target.value) : null } : entry))}
                        />
                        <button
                          type="button"
                          className="rounded-xl border border-[#D8CFC2] px-3 text-xs text-[#374151] hover:bg-[#F8F5EF]"
                          onClick={() => setArenaCandidates((prev) => prev.filter((_, entryIndex) => entryIndex !== index))}
                          disabled={arenaCandidates.length <= 1}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="rounded-xl border border-[#D8CFC2] px-3 py-2 text-xs text-[#374151] hover:bg-[#F8F5EF]"
                    onClick={() => setArenaCandidates((prev) => [...prev, { provider: "", model: "", label: "" }])}
                  >
                    Add provider
                  </button>
                </div>
              )}
            </div>
            <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-xs text-[#4B5563]">
              {mode === "provider_arena"
                ? "This Provider Arena run will execute every dataset item across each candidate and score outputs with the rubric"
                : "This run will evaluate each dataset item against the selected rubric"}
              <div className="mt-1 text-[#6B7280]">
                Items: <span className="font-medium text-[#111111]">{dataset.itemCount}</span> · Provider executions: <span className="font-medium text-[#111111]">{mode === "provider_arena" ? dataset.itemCount * arenaCandidates.filter((candidate) => candidate.provider && candidate.model).length : dataset.itemCount}</span> · Judge executions: <span className="font-medium text-[#111111]">{mode === "provider_arena" ? dataset.itemCount * arenaCandidates.filter((candidate) => candidate.provider && candidate.model).length : dataset.itemCount}</span>
              </div>
              {mode === "provider_arena" && (
                <div className="mt-1 text-[#B45309]">
                  Provider Arena consumes more evaluation capacity than single provider runs
                </div>
              )}
            </div>
            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
            {running ? (
              <div className="rounded-xl border border-[#BFDBFE]/60 bg-[#EFF6FF] px-4 py-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-[#2563EB]" />
                  <span className="text-sm font-semibold text-[#1D4ED8]">Starting evaluation…</span>
                </div>
                <div className="space-y-2 pl-6">
                  {([
                    "Preparing dataset items",
                    "Creating evaluation run",
                    "Queuing provider executions",
                    "Scoring outputs with rubric",
                    "Generating summary",
                  ] as const).map((step, i) => (
                    <div key={step} className="flex items-center gap-2 text-xs text-[#1D4ED8]">
                      {i === 0 ? (
                        <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                      ) : (
                        <div className="h-3 w-3 shrink-0 rounded-full border border-[#BFDBFE]" />
                      )}
                      {step}
                    </div>
                  ))}
                </div>
                <p className="pl-6 text-[11px] text-[#3B82F6]">
                  You will be redirected to the run detail page automatically.
                </p>
              </div>
            ) : (
              <div className="flex justify-end">
                <Button onClick={() => void handleStart()} className="gap-2 bg-[#2563EB] text-white hover:bg-[#1D4ED8]">
                  <FlaskConical className="h-4 w-4" />
                  Start run
                </Button>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <Card className="border-[#E7DED1] bg-white">
        <CardHeader>
          <CardTitle className="text-[#111111]">Recent runs</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-[#6B7280]">No runs yet for this dataset</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#EFE7DA] text-xs text-[#6B7280]">
                    <th className="py-2 text-left font-semibold">Started</th>
                    <th className="py-2 text-left font-semibold">Provider</th>
                    <th className="py-2 text-left font-semibold">Model</th>
                    <th className="py-2 text-left font-semibold">Status</th>
                    <th className="py-2 text-right font-semibold">Score</th>
                    <th className="py-2 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b border-[#F1ECE3] last:border-0">
                      <td className="py-2.5 text-[#374151]">{new Date(run.createdAt).toLocaleString()}</td>
                      <td className="py-2.5 text-[#374151]">{run.provider}</td>
                      <td className="py-2.5 text-[#374151]">{run.model}</td>
                      <td className="py-2.5">
                        {run.status === "running" || run.status === "queued" || run.status === "pending" ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EFF6FF] px-2 py-0.5 text-xs font-medium text-[#1D4ED8]">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {run.status === "queued" ? "Queued…" : run.status === "pending" ? "Pending…" : "Running…"}
                          </span>
                        ) : (
                          <Badge className={run.status === "completed" ? "bg-[#ECFDF5] text-[#065F46]" : run.status === "failed" || run.status === "timed_out" ? "bg-[#FEF2F2] text-[#991B1B]" : "bg-[#F3F4F6] text-[#374151]"}>
                            {run.status}
                          </Badge>
                        )}
                      </td>
                      <td className="py-2.5 text-right font-medium text-[#111111]">{run.aggregate.finalScore !== null ? `${Math.round(run.aggregate.finalScore)}%` : "—"}</td>
                      <td className="py-2.5 text-right">
                        <Link href={`/evaluations/runs/${run.id}` as Route} className="text-[#2563EB] hover:text-[#1D4ED8]">View report</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-[#E7DED1] bg-white">
        <CardHeader>
          <CardTitle className="text-[#111111]">Provider Arena runs</CardTitle>
        </CardHeader>
        <CardContent>
          {arenaRuns.length === 0 ? (
            <p className="text-sm text-[#6B7280]">No Provider Arena runs yet for this dataset</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#EFE7DA] text-xs text-[#6B7280]">
                    <th className="py-2 text-left font-semibold">Started</th>
                    <th className="py-2 text-left font-semibold">Candidates</th>
                    <th className="py-2 text-left font-semibold">Recommendation</th>
                    <th className="py-2 text-right font-semibold">Decision score</th>
                    <th className="py-2 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {arenaRuns.map((run) => (
                    <tr key={run.id} className="border-b border-[#F1ECE3] last:border-0">
                      <td className="py-2.5 text-[#374151]">{new Date(run.createdAt).toLocaleString()}</td>
                      <td className="py-2.5 text-[#374151]">{run.candidates?.length ?? 0}</td>
                      <td className="py-2.5">
                        <Badge className="bg-[#EFF6FF] text-[#1D4ED8]">{run.arenaReport?.rolloutRecommendation ?? "pending"}</Badge>
                      </td>
                      <td className="py-2.5 text-right font-medium text-[#111111]">{run.arenaReport?.decisionScore != null ? `${Math.round(run.arenaReport.decisionScore)}%` : "—"}</td>
                      <td className="py-2.5 text-right">
                        <Link href={`/evaluations/runs/${run.id}` as Route} className="text-[#2563EB] hover:text-[#1D4ED8]">View report</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function BehavioralDatasetDetailPage() {
  const params = useParams<{ id: string }>();
  const datasetId = params.id;
  const { activeWorkspaceId } = useWorkspace();

  const [dataset, setDataset] = useState<BehavioralDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("items");

  useEffect(() => {
    if (!activeWorkspaceId || !datasetId) return;
    setLoading(true);
    fetch(
      `/api/evaluations/behavioral/${encodeURIComponent(datasetId)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
      { cache: "no-store" },
    )
      .then((r) => r.json())
      .then((json: BehavioralDataset & { error?: string }) => {
        if (json.error) throw new Error(json.error);
        setDataset(json);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [activeWorkspaceId, datasetId]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-[#6B7280]">
        <Loader2 className="h-5 w-5 animate-spin" />Loading dataset…
      </div>
    );
  }

  if (error || !dataset) {
    return (
      <div className="min-h-screen bg-[#FBFAF7]">
        <AppHeader title="Dataset not found" subtitle="The requested dataset could not be found." />
        <div className="px-4 py-8 md:px-6">
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error ?? "Dataset not found"}
          </div>
          <Link href={"/evaluations/behavioral" as Route} className="mt-4 inline-flex items-center gap-1.5 text-sm text-[#2563EB]">
            <ChevronLeft className="h-4 w-4" />Back to datasets
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FBFAF7]">
      <AppHeader
        title={dataset.name}
        subtitle={`${PROMPT_TYPE_LABELS[dataset.promptType]} · ${dataset.itemCount} item${dataset.itemCount !== 1 ? "s" : ""}`}
      />

      <div className="px-4 py-6 md:px-6 xl:px-8">
        {/* Breadcrumb */}
        <Link
          href={"/evaluations/behavioral" as Route}
          className="mb-4 inline-flex items-center gap-1.5 text-xs text-[#6B7280] hover:text-[#2563EB] transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Behavioral datasets
        </Link>

        {/* Dataset meta */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <Badge className="bg-[#F1ECE3] text-[#374151] hover:bg-[#F1ECE3]">
            {PROMPT_TYPE_LABELS[dataset.promptType]}
          </Badge>
          {dataset.description && (
            <span className="text-sm text-[#6B7280]">{dataset.description}</span>
          )}
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-1 rounded-xl border border-[#E7DED1] bg-white p-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === id
                  ? "bg-[#2563EB] text-white shadow-sm"
                  : "text-[#6B7280] hover:bg-[#F1ECE3] hover:text-[#374151]"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "items" && activeWorkspaceId && (
          <ItemsTab datasetId={datasetId} workspaceId={activeWorkspaceId} />
        )}
        {activeTab === "rubric" && activeWorkspaceId && (
          <RubricBuilderTab dataset={dataset} workspaceId={activeWorkspaceId} />
        )}
        {activeTab === "scenarios" && (
          <PlaceholderTab
            label="Scenario groups"
            description="Organize items into named scenario groups — e.g. angry customer, missing order, policy edge case. Scenario-level scoring coming soon."
          />
        )}
        {activeTab === "runs" && activeWorkspaceId && (
          <RunsTab dataset={dataset} workspaceId={activeWorkspaceId} />
        )}
      </div>
    </div>
  );
}

// local alias for Sparkles — already in page-level imports but duplicated for DEFAULT_DIMENSIONS helper
function Sparkles({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    </svg>
  );
}
