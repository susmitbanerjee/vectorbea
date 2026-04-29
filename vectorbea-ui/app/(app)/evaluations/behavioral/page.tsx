"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  ChevronDown,
  FlaskConical,
  Loader2,
  Lock,
  PlusCircle,
  Sparkles,
  Trash2,
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
  BehavioralPromptType,
  PromptListItem,
} from "@/lib/api";
import { canUseBehavioralEvaluations } from "@/lib/behavioral-gate";
import { useWorkspace } from "@/lib/workspace-context";

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

const PROMPT_TYPE_OPTIONS: BehavioralPromptType[] = [
  "customer_support",
  "rag_answer",
  "summarization",
  "classification",
  "extraction",
  "agent_workflow",
  "general",
];

// ── Locked state ───────────────────────────────────────────────────────────────

function LockedState() {
  return (
    <div className="flex flex-col items-center gap-6 rounded-2xl border border-[#E7DED1] bg-white px-8 py-14 text-center shadow-sm">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#FBF8F1]">
        <Lock className="h-6 w-6 text-[#B45309]" />
      </div>
      <div className="max-w-md">
        <p className="text-[17px] font-semibold text-[#111111]">Behavioral Evaluations require Pro</p>
        <p className="mt-2 text-sm leading-relaxed text-[#6B7280]">
          Behavioral Evaluations let you score prompts with rubrics instead of reference answers —
          ideal for customer support, RAG, summaries, and any output that does not have a single
          correct answer. Available on Pro and Enterprise plans.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href={"/pricing" as Route}>
          <Button className="gap-2 bg-[#2563EB] text-white hover:bg-[#1D4ED8]">
            <Sparkles className="h-4 w-4" />
            Upgrade to Pro
          </Button>
        </Link>
        <Link href={"/book-demo" as Route}>
          <Button variant="outline" className="gap-2 border-[#E7DED1]">
            Talk to sales
          </Button>
        </Link>
      </div>
      <div className="mt-2 grid w-full max-w-lg grid-cols-2 gap-3 text-left text-xs text-[#6B7280]">
        {[
          "Rubric-based scoring",
          "No reference outputs needed",
          "Must do / must not do rules",
          "Hard fail conditions",
          "Dimension weights",
          "LLM-as-judge integration",
        ].map((f) => (
          <div key={f} className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-[#2563EB]" />
            {f}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Dataset card ───────────────────────────────────────────────────────────────

function DatasetCard({
  dataset,
  prompts,
  onDelete,
}: {
  dataset: BehavioralDataset;
  prompts: PromptListItem[];
  onDelete: (id: string) => void;
}) {
  const promptName = prompts.find((p) => p.id === dataset.promptId)?.name ?? dataset.promptName ?? "—";

  return (
    <Card className="border-[#E7DED1] bg-white transition-shadow hover:shadow-md">
      <CardContent className="flex items-start gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/evaluations/behavioral/${dataset.id}` as Route}
              className="font-semibold text-[#111111] hover:text-[#2563EB] transition-colors"
            >
              {dataset.name}
            </Link>
            <Badge
              variant="secondary"
              className="bg-[#F1ECE3] text-[#6B7280] text-[10px] font-medium"
            >
              {PROMPT_TYPE_LABELS[dataset.promptType]}
            </Badge>
          </div>
          {dataset.description && (
            <p className="mt-1 text-sm text-[#6B7280]">{dataset.description}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#6B7280]">
            <span>
              <span className="font-medium text-[#374151]">{dataset.itemCount}</span> item{dataset.itemCount !== 1 ? "s" : ""}
            </span>
            <span>
              Prompt:{" "}
              <span className="font-medium text-[#374151]">{promptName}</span>
            </span>
            <span>Updated {new Date(dataset.updatedAt).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link href={`/evaluations/behavioral/${dataset.id}` as Route}>
            <Button variant="outline" size="sm" className="border-[#E7DED1] text-xs">
              Open
            </Button>
          </Link>
          <button
            type="button"
            onClick={() => onDelete(dataset.id)}
            className="rounded p-1.5 text-[#9CA3AF] transition-colors hover:bg-red-50 hover:text-red-600"
            title="Delete dataset"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function BehavioralDatasetsPage() {
  const { activeWorkspaceId, planTier } = useWorkspace();
  const hasAccess = canUseBehavioralEvaluations(planTier);

  const [datasets, setDatasets] = useState<BehavioralDataset[]>([]);
  const [prompts, setPrompts] = useState<PromptListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [promptId, setPromptId] = useState("");
  const [promptType, setPromptType] = useState<BehavioralPromptType>("general");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!activeWorkspaceId || !hasAccess) return;
    setLoading(true);
    setError(null);
    try {
      const [dsRes, promptsRes] = await Promise.all([
        fetch(`/api/evaluations/behavioral?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
        fetch(`/api/prompts?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
      ]);
      const [dsJson, promptsJson] = await Promise.all([dsRes.json(), promptsRes.json()]);
      if (!dsRes.ok) throw new Error((dsJson as { error?: string }).error ?? "Failed to load datasets");
      setDatasets(dsJson as BehavioralDataset[]);
      if (promptsRes.ok) setPrompts(promptsJson as PromptListItem[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load datasets");
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, hasAccess]);

  useEffect(() => { void load(); }, [load]);

  // ── Create ──────────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!activeWorkspaceId || creating) return;
    if (!name.trim()) { setCreateError("Name is required"); return; }
    if (!promptId) { setCreateError("Select a prompt"); return; }

    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(
        `/api/evaluations/behavioral?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), description: description.trim() || null, promptId, promptType }),
        },
      );
      const json = await res.json() as BehavioralDataset & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to create");
      setDatasets((prev) => [json, ...prev]);
      setShowCreate(false);
      setName(""); setDescription(""); setPromptId(""); setPromptType("general");
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create dataset");
    } finally {
      setCreating(false);
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────────

  const handleDelete = async (id: string) => {
    if (!activeWorkspaceId) return;
    try {
      await fetch(
        `/api/evaluations/behavioral/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
        { method: "DELETE" },
      );
      setDatasets((prev) => prev.filter((d) => d.id !== id));
    } catch {
      /* silent */
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#FBFAF7]">
      <AppHeader
        title="Behavioral Datasets"
        subtitle="Evaluate prompts using rubrics, not reference answers — for customer support, RAG, summaries, and more."
      />

      <div className="space-y-4 px-4 py-6 md:px-6 xl:px-8">
        {/* ── Plan gate ── */}
        {!hasAccess && <LockedState />}

        {hasAccess && (
          <>
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* ── Toolbar ── */}
            <div className="flex items-center justify-between">
              <p className="text-sm text-[#6B7280]">
                {loading ? "Loading…" : `${datasets.length} dataset${datasets.length !== 1 ? "s" : ""}`}
              </p>
              <Button
                size="sm"
                onClick={() => setShowCreate((v) => !v)}
                className="gap-2 bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
              >
                {showCreate ? <X className="h-4 w-4" /> : <PlusCircle className="h-4 w-4" />}
                {showCreate ? "Cancel" : "New dataset"}
              </Button>
            </div>

            {/* ── Create panel ── */}
            {showCreate && (
              <Card className="border-[#E7DED1] bg-white">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Create behavioral dataset</CardTitle>
                  <CardDescription>
                    Link to a prompt and choose the type of output it produces.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {createError && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                      {createError}
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    {/* Name */}
                    <div className="space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                        Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111] placeholder:text-[#9CA3AF] focus:border-[#2563EB] focus:outline-none"
                        placeholder="e.g. Support agent edge cases"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                    {/* Description */}
                    <div className="space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                        Description
                      </label>
                      <input
                        className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111] placeholder:text-[#9CA3AF] focus:border-[#2563EB] focus:outline-none"
                        placeholder="Optional"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    {/* Prompt */}
                    <div className="space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                        Prompt <span className="text-red-500">*</span>
                      </label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 text-sm text-[#111111]"
                          >
                            <span className="truncate text-left">
                              {promptId
                                ? (prompts.find((p) => p.id === promptId)?.name ?? promptId)
                                : <span className="text-[#9CA3AF]">Select a prompt</span>}
                            </span>
                            <ChevronDown className="h-4 w-4 shrink-0 text-[#9CA3AF]" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
                          <DropdownMenuRadioGroup value={promptId} onValueChange={setPromptId}>
                            {prompts.map((p) => (
                              <DropdownMenuPanelRadioItem key={p.id} value={p.id}>
                                {p.name}
                              </DropdownMenuPanelRadioItem>
                            ))}
                            {prompts.length === 0 && (
                              <div className="px-3 py-2 text-xs text-[#9CA3AF]">No prompts found</div>
                            )}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuPanel>
                      </DropdownMenu>
                    </div>

                    {/* Prompt type */}
                    <div className="space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                        Prompt type
                      </label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 text-sm text-[#111111]"
                          >
                            <span>{PROMPT_TYPE_LABELS[promptType]}</span>
                            <ChevronDown className="h-4 w-4 shrink-0 text-[#9CA3AF]" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
                          <DropdownMenuRadioGroup
                            value={promptType}
                            onValueChange={(v) => setPromptType(v as BehavioralPromptType)}
                          >
                            {PROMPT_TYPE_OPTIONS.map((t) => (
                              <DropdownMenuPanelRadioItem key={t} value={t}>
                                {PROMPT_TYPE_LABELS[t]}
                              </DropdownMenuPanelRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuPanel>
                      </DropdownMenu>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      onClick={handleCreate}
                      disabled={creating}
                      className="gap-2 bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
                    >
                      {creating
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <FlaskConical className="h-4 w-4" />}
                      Create dataset
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => { setShowCreate(false); setCreateError(null); }}
                    >
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── Empty state ── */}
            {!loading && datasets.length === 0 && !showCreate && (
              <Card className="border-dashed border-[#E7DED1] bg-white">
                <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
                  <BookOpen className="h-10 w-10 text-[#9CA3AF]" />
                  <div>
                    <p className="text-[16px] font-semibold text-[#111111]">
                      No behavioral datasets yet
                    </p>
                    <p className="mt-1 text-sm text-[#6B7280]">
                      Create a dataset to start building rubrics for your prompts.
                    </p>
                  </div>
                  <Button
                    onClick={() => setShowCreate(true)}
                    className="gap-2 bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
                  >
                    <PlusCircle className="h-4 w-4" />
                    Create your first dataset
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* ── Dataset list ── */}
            {loading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-[#6B7280]">
                <Loader2 className="h-4 w-4 animate-spin" />Loading datasets…
              </div>
            ) : (
              <div className="space-y-3">
                {datasets.map((ds) => (
                  <DatasetCard
                    key={ds.id}
                    dataset={ds}
                    prompts={prompts}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
