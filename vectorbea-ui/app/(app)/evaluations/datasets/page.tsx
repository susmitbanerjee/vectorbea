"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  CheckSquare,
  ChevronDown,
  Database,
  FileJson,
  FilePlus2,
  Loader2,
  PenLine,
  PlusCircle,
  Search,
  Square,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuPanel,
  DropdownMenuPanelRadioItem,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  EvaluationDataset,
  EvaluationDatasetItem,
  EvaluationDatasetType,
  GoldenTrace,
  PromptListItem,
  TraceSummaryView,
} from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

const DATASET_TYPE_LABELS: Record<EvaluationDatasetType, string> = {
  manual: "Manual",
  imported: "Imported",
  runtime: "Runtime traces",
  golden: "Golden traces",
  mixed: "Mixed",
};

type CreationMode = "manual" | "import" | "traces" | "golden";

// ── CSV/JSON parser (client-side) ─────────────────────────────────────────────

function parseCSV(text: string): Array<Record<string, string>> {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    return row;
  });
}

function parseJSONFile(text: string): Array<Record<string, string>> {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed as Array<Record<string, string>>;
    return [];
  } catch {
    return [];
  }
}

// ── Manual item row editor ────────────────────────────────────────────────────

type ManualRow = { id: string; input: string; expectedOutput: string; notes: string };

function emptyRow(): ManualRow {
  return { id: crypto.randomUUID(), input: "", expectedOutput: "", notes: "" };
}

export default function EvaluationDatasetsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [datasets, setDatasets] = useState<EvaluationDataset[]>([]);
  const [prompts, setPrompts] = useState<PromptListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create panel state
  const [showCreate, setShowCreate] = useState(false);
  const [createMode, setCreateMode] = useState<CreationMode>("manual");
  const [datasetName, setDatasetName] = useState("");
  const [datasetDesc, setDatasetDesc] = useState("");
  const [datasetPromptId, setDatasetPromptId] = useState("");
  const [datasetType, setDatasetType] = useState<EvaluationDatasetType>("manual");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Manual rows
  const [manualRows, setManualRows] = useState<ManualRow[]>([emptyRow()]);

  // Import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importRows, setImportRows] = useState<Array<Record<string, string>>>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importFileName, setImportFileName] = useState("");

  // Trace picker
  const [allTraces, setAllTraces] = useState<TraceSummaryView[]>([]);
  const [traceSearch, setTraceSearch] = useState("");
  const [selectedTraceIds, setSelectedTraceIds] = useState<string[]>([]);
  const [loadingTraces, setLoadingTraces] = useState(false);

  // Golden picker
  const [goldenTraces, setGoldenTraces] = useState<GoldenTrace[]>([]);
  const [selectedGoldenIds, setSelectedGoldenIds] = useState<string[]>([]);
  const [loadingGolden, setLoadingGolden] = useState(false);

  // ── Load datasets ───────────────────────────────────────────────────────────

  const loadDatasets = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const [dsRes, promptsRes] = await Promise.all([
        fetch(`/api/evaluations/datasets?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
        fetch(`/api/prompts?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
      ]);
      const [dsJson, promptsJson] = await Promise.all([dsRes.json(), promptsRes.json()]);
      if (!dsRes.ok) throw new Error(dsJson.error ?? "Failed to load datasets");
      setDatasets(dsJson as EvaluationDataset[]);
      if (promptsRes.ok) setPrompts(promptsJson as PromptListItem[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load datasets");
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => { void loadDatasets(); }, [loadDatasets]);

  // ── Load traces / golden when mode switches ────────────────────────────────

  useEffect(() => {
    if (!activeWorkspaceId || !showCreate) return;
    if (createMode === "traces" && allTraces.length === 0) {
      setLoadingTraces(true);
      fetch(`/api/traces?workspaceId=${encodeURIComponent(activeWorkspaceId)}&pageSize=200`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setAllTraces((d.items ?? []) as TraceSummaryView[]))
        .catch(() => { /* silent */ })
        .finally(() => setLoadingTraces(false));
    }
    if (createMode === "golden" && goldenTraces.length === 0) {
      setLoadingGolden(true);
      fetch(`/api/evaluations/golden-traces?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => Array.isArray(d) && setGoldenTraces(d as GoldenTrace[]))
        .catch(() => { /* silent */ })
        .finally(() => setLoadingGolden(false));
    }
  }, [activeWorkspaceId, createMode, showCreate, allTraces.length, goldenTraces.length]);

  // ── File import ─────────────────────────────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const isJson = file.name.endsWith(".json");
      const rows = isJson ? parseJSONFile(text) : parseCSV(text);
      const warnings: string[] = [];
      const valid = rows.filter((r, i) => {
        if (!r.input?.trim()) { warnings.push(`Row ${i + 2}: skipped (empty input)`); return false; }
        return true;
      });
      setImportRows(valid);
      setImportWarnings(warnings);
    };
    reader.readAsText(file);
  };

  // ── Reset form ─────────────────────────────────────────────────────────────

  const resetForm = () => {
    setDatasetName("");
    setDatasetDesc("");
    setDatasetPromptId("");
    setDatasetType("manual");
    setCreateMode("manual");
    setManualRows([emptyRow()]);
    setImportRows([]);
    setImportWarnings([]);
    setImportFileName("");
    setSelectedTraceIds([]);
    setSelectedGoldenIds([]);
    setCreateError(null);
  };

  const cancelCreate = () => { setShowCreate(false); resetForm(); };

  // ── Create dataset ─────────────────────────────────────────────────────────

  const createDataset = async () => {
    if (!activeWorkspaceId || creating) return;
    if (!datasetPromptId.trim()) { setCreateError("Please select a prompt to scope this dataset to."); return; }
    if (!datasetName.trim()) { setCreateError("Dataset name is required."); return; }

    // Validate mode-specific requirements
    if (createMode === "manual") {
      const validRows = manualRows.filter((r) => r.input.trim());
      if (validRows.length === 0) { setCreateError("Add at least one test case with a non-empty input."); return; }
    } else if (createMode === "import") {
      if (importRows.length === 0) { setCreateError("No valid rows to import. Upload a CSV or JSON file."); return; }
    } else if (createMode === "traces") {
      if (selectedTraceIds.length === 0) { setCreateError("Select at least one trace."); return; }
    } else if (createMode === "golden") {
      if (selectedGoldenIds.length === 0) { setCreateError("Select at least one golden trace."); return; }
    }

    setCreating(true);
    setCreateError(null);

    try {
      // 1. Create the dataset record
      const resolvedType: EvaluationDatasetType =
        createMode === "traces" ? "runtime"
        : createMode === "golden" ? "golden"
        : createMode === "import" ? "imported"
        : "manual";

      const dsRes = await fetch(
        `/api/evaluations/datasets?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: datasetName.trim(),
            description: datasetDesc.trim() || null,
            datasetType: resolvedType,
            promptId: datasetPromptId.trim() || null,
            promptName: datasetPromptId.trim()
              ? (prompts.find((p) => p.id === datasetPromptId)?.name ?? null)
              : null,
          }),
        },
      );
      const dsJson = await dsRes.json();
      if (!dsRes.ok) throw new Error(dsJson.error ?? "Failed to create dataset");
      const newDataset = dsJson as EvaluationDataset;

      // 2. Add items
      let items: Array<{
        sourceType: string;
        input: string;
        expectedOutput?: string | null;
        notes?: string | null;
        traceId?: string | null;
        isGolden?: boolean;
      }> = [];

      if (createMode === "manual") {
        items = manualRows
          .filter((r) => r.input.trim())
          .map((r) => ({
            sourceType: "manual",
            input: r.input.trim(),
            expectedOutput: r.expectedOutput.trim() || null,
            notes: r.notes.trim() || null,
          }));
      } else if (createMode === "import") {
        items = importRows.map((r) => ({
          sourceType: "imported",
          input: r.input,
          expectedOutput: r.expected_output || null,
          notes: r.notes || null,
        }));
      } else if (createMode === "traces") {
        items = selectedTraceIds.map((tid) => ({
          sourceType: "runtime_trace",
          input: "",
          traceId: tid,
        }));
      } else if (createMode === "golden") {
        items = selectedGoldenIds.map((tid) => ({
          sourceType: "golden_trace",
          input: "",
          traceId: tid,
          isGolden: true,
        }));
      }

      if (items.length > 0) {
        const itemsRes = await fetch(
          `/api/evaluations/datasets/${encodeURIComponent(newDataset.id)}/items?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items }),
          },
        );
        const itemsJson = await itemsRes.json();
        if (!itemsRes.ok) throw new Error(itemsJson.error ?? "Failed to add items");
      }

      setDatasets((prev) => [{ ...newDataset, itemCount: items.length }, ...prev]);
      setShowCreate(false);
      resetForm();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create dataset");
    } finally {
      setCreating(false);
    }
  };

  // ── Delete dataset ─────────────────────────────────────────────────────────

  const deleteDataset = async (id: string) => {
    if (!activeWorkspaceId) return;
    try {
      const res = await fetch(
        `/api/evaluations/datasets/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
        { method: "DELETE" },
      );
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(j.error ?? "Failed to delete");
      }
      setDatasets((prev) => prev.filter((d) => d.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete dataset");
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen">
      <AppHeader
        title="Deterministic Test Sets"
        subtitle="Create and manage test cases for evidence checks — manual cases, imports, runtime traces, or golden traces."
      />

      <div className="space-y-4 px-4 py-6 md:px-6 xl:px-8">
        {error && (
          <Card className="border-red-500/30 bg-red-500/10">
            <CardContent className="p-4 text-sm text-red-100">{error}</CardContent>
          </Card>
        )}

        {/* ── First-time CTA ── */}
        {!loading && datasets.length === 0 && !showCreate && (
          <Card className="border-dashed border-border bg-muted/20">
            <CardContent className="flex flex-col items-center gap-4 px-6 py-10 text-center">
              <Database className="h-10 w-10 text-muted-foreground" />
              <div>
                <p className="text-lg font-semibold">No evaluation datasets yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create a dataset to evaluate your prompt without needing production traffic.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => { setCreateMode("manual"); setShowCreate(true); }} className="gap-2">
                  <FilePlus2 className="h-4 w-4" />Add test cases manually
                </Button>
                <Button variant="outline" onClick={() => { setCreateMode("import"); setShowCreate(true); }} className="gap-2">
                  <Upload className="h-4 w-4" />Upload CSV / JSON
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Toolbar ── */}
        {(datasets.length > 0 || showCreate) && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {datasets.length} dataset{datasets.length !== 1 ? "s" : ""}
            </p>
            <Button size="sm" onClick={() => setShowCreate((v) => !v)} className="gap-2">
              <PlusCircle className="h-4 w-4" />
              {showCreate ? "Cancel" : "New dataset"}
            </Button>
          </div>
        )}

        {/* ── Create panel ── */}
        {showCreate && (
          <Card>
            <CardHeader>
              <CardTitle>Create evaluation dataset</CardTitle>
              <CardDescription>Choose how to populate this dataset.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {createError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                  {createError}
                </div>
              )}

              {/* Prompt (required for scoping) */}
              <div className="space-y-1">
                <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Prompt <span className="text-amber-400">*</span>
                </label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-10 w-full items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent/40"
                    >
                      <span className="truncate text-left">
                        {datasetPromptId
                          ? (prompts.find((p) => p.id === datasetPromptId)?.name ?? datasetPromptId)
                          : <span className="text-muted-foreground">Select the prompt this dataset belongs to</span>}
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
                    <DropdownMenuRadioGroup value={datasetPromptId} onValueChange={setDatasetPromptId}>
                      {prompts.map((p) => (
                        <DropdownMenuPanelRadioItem key={p.id} value={p.id}>{p.name}</DropdownMenuPanelRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuPanel>
                </DropdownMenu>
                <p className="text-[11px] text-muted-foreground">
                  Datasets are scoped to a single prompt. The evaluation page will only show datasets matching the selected prompt.
                </p>
              </div>

              {/* Name + description */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Name *</label>
                  <input
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    value={datasetName}
                    onChange={(e) => setDatasetName(e.target.value)}
                    placeholder="e.g. Support agent smoke tests"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Description</label>
                  <input
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    value={datasetDesc}
                    onChange={(e) => setDatasetDesc(e.target.value)}
                    placeholder="Optional"
                  />
                </div>
              </div>

              {/* Mode tabs */}
              <div className="space-y-1">
                <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Data source</label>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { mode: "manual",  Icon: PenLine,  label: "Manual"         },
                      { mode: "import",  Icon: Upload,   label: "Import file"    },
                      { mode: "traces",  Icon: Activity, label: "Runtime traces" },
                      { mode: "golden",  Icon: Star,     label: "Golden traces"  },
                    ] as { mode: CreationMode; Icon: React.ElementType; label: string }[]
                  ).map(({ mode, Icon, label }) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setCreateMode(mode)}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${createMode === mode ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/40"}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Manual mode ── */}
              {createMode === "manual" && (
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    Test cases ({manualRows.filter((r) => r.input.trim()).length} valid)
                  </label>
                  <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                    {manualRows.map((row, i) => (
                      <div key={row.id} className="rounded-lg border border-border bg-muted/10 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground">Case {i + 1}</span>
                          {manualRows.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setManualRows((rows) => rows.filter((r) => r.id !== row.id))}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Input *</label>
                          <textarea
                            rows={2}
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none"
                            placeholder="The user message or prompt input…"
                            value={row.input}
                            onChange={(e) => setManualRows((rows) => rows.map((r) => r.id === row.id ? { ...r, input: e.target.value } : r))}
                          />
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Expected output (optional)</label>
                            <textarea
                              rows={2}
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none"
                              placeholder="What the ideal response looks like…"
                              value={row.expectedOutput}
                              onChange={(e) => setManualRows((rows) => rows.map((r) => r.id === row.id ? { ...r, expectedOutput: e.target.value } : r))}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Notes (optional)</label>
                            <textarea
                              rows={2}
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none"
                              placeholder="Why this case matters…"
                              value={row.notes}
                              onChange={(e) => setManualRows((rows) => rows.map((r) => r.id === row.id ? { ...r, notes: e.target.value } : r))}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setManualRows((rows) => [...rows, emptyRow()])}
                    className="gap-2"
                  >
                    <PlusCircle className="h-3.5 w-3.5" />Add another case
                  </Button>
                </div>
              )}

              {/* ── Import mode ── */}
              {createMode === "import" && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-dashed border-border bg-muted/10 p-4 text-center">
                    <p className="text-sm font-medium mb-1">Upload CSV or JSON</p>
                    <p className="text-xs text-muted-foreground mb-3">
                      Required column: <code className="rounded bg-muted px-1">input</code>.
                      Optional: <code className="rounded bg-muted px-1">expected_output</code>, <code className="rounded bg-muted px-1">notes</code>.
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.json"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      className="gap-2"
                    >
                      <Upload className="h-4 w-4" />
                      {importFileName || "Choose file"}
                    </Button>
                  </div>
                  {importWarnings.length > 0 && (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 space-y-0.5">
                      {importWarnings.slice(0, 5).map((w, i) => <div key={i}>{w}</div>)}
                      {importWarnings.length > 5 && <div>…{importWarnings.length - 5} more warnings</div>}
                    </div>
                  )}
                  {importRows.length > 0 && (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                      {importRows.length} row{importRows.length !== 1 ? "s" : ""} ready to import
                    </div>
                  )}
                  {importRows.length > 0 && (
                    <div className="max-h-[200px] overflow-y-auto space-y-1">
                      {importRows.slice(0, 8).map((row, i) => (
                        <div key={i} className="rounded-lg border border-border bg-muted/10 px-3 py-2 text-xs">
                          <span className="text-muted-foreground">#{i + 1}</span>
                          <span className="ml-2 truncate">{row.input}</span>
                          {row.expected_output && (
                            <span className="ml-2 text-muted-foreground">→ {row.expected_output.slice(0, 40)}{row.expected_output.length > 40 ? "…" : ""}</span>
                          )}
                        </div>
                      ))}
                      {importRows.length > 8 && (
                        <p className="text-xs text-muted-foreground pl-1">…{importRows.length - 8} more rows</p>
                      )}
                    </div>
                  )}
                  <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    💡 Synthetic test generation coming soon — describe your prompt and we&apos;ll suggest test cases.
                  </div>
                </div>
              )}

              {/* ── Runtime traces mode ── */}
              {createMode === "traces" && (
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    Select traces ({selectedTraceIds.length} selected)
                  </label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-3 text-sm"
                      placeholder="Filter by prompt or trace ID…"
                      value={traceSearch}
                      onChange={(e) => setTraceSearch(e.target.value)}
                    />
                  </div>
                  {loadingTraces ? (
                    <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />Loading traces…
                    </div>
                  ) : (
                    <div className="max-h-[300px] overflow-y-auto space-y-1 rounded-lg border border-border/50 p-2">
                      {allTraces
                        .filter((t) => {
                          const q = traceSearch.trim().toLowerCase();
                          return !q || t.promptName?.toLowerCase().includes(q) || t.id?.toLowerCase().includes(q);
                        })
                        .slice(0, 100)
                        .map((t) => {
                          const sel = selectedTraceIds.includes(t.id);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition ${sel ? "border-primary bg-primary/5" : "border-border hover:bg-accent/20"}`}
                              onClick={() => setSelectedTraceIds((ids) => sel ? ids.filter((i) => i !== t.id) : [...ids, t.id])}
                            >
                              {sel
                                ? <CheckSquare className="h-3.5 w-3.5 shrink-0 text-primary" />
                                : <Square className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-medium">{t.promptName}@{t.promptVersion}</div>
                                <div className="font-mono text-muted-foreground">{t.id}</div>
                              </div>
                              <Badge variant={t.status === "success" ? "success" : t.status === "error" ? "destructive" : "secondary"} className="shrink-0 text-[9px]">
                                {t.status}
                              </Badge>
                            </button>
                          );
                        })}
                      {allTraces.length === 0 && (
                        <p className="py-4 text-center text-sm text-muted-foreground">No runtime traces found.</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Golden traces mode ── */}
              {createMode === "golden" && (
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    Select golden traces ({selectedGoldenIds.length} selected)
                  </label>
                  {loadingGolden ? (
                    <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />Loading golden traces…
                    </div>
                  ) : (
                    <div className="max-h-[280px] overflow-y-auto space-y-1 rounded-lg border border-border/50 p-2">
                      {goldenTraces.map((gt) => {
                        const sel = selectedGoldenIds.includes(gt.traceId);
                        return (
                          <button
                            key={gt.id}
                            type="button"
                            className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition ${sel ? "border-primary bg-primary/5" : "border-border hover:bg-accent/20"}`}
                            onClick={() => setSelectedGoldenIds((ids) => sel ? ids.filter((i) => i !== gt.traceId) : [...ids, gt.traceId])}
                          >
                            {sel
                              ? <CheckSquare className="h-3.5 w-3.5 shrink-0 text-primary" />
                              : <Square className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                            <Star className="h-3 w-3 shrink-0 text-yellow-500" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{gt.promptName ?? gt.traceId}</div>
                              <div className="font-mono text-muted-foreground">{gt.traceId.slice(0, 20)}…</div>
                            </div>
                            {gt.label && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px]">{gt.label}</span>}
                          </button>
                        );
                      })}
                      {goldenTraces.length === 0 && (
                        <div className="py-4 text-center text-sm text-muted-foreground">
                          No golden traces yet.{" "}
                          <Link href={`/evaluations/golden?org=${encodeURIComponent(activeWorkspaceId ?? "")}`} className="text-primary hover:underline">
                            Mark some →
                          </Link>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                <Button onClick={createDataset} disabled={creating} className="gap-2">
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                  Create dataset
                </Button>
                <Button type="button" variant="ghost" onClick={cancelCreate}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Datasets list ── */}
        <div className="space-y-2">
          {loading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />Loading datasets…
            </div>
          ) : datasets.length === 0 && showCreate ? null : datasets.length === 0 ? null : (
            datasets.map((dataset) => (
              <Card key={dataset.id}>
                <CardContent className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{dataset.name}</span>
                      <Badge variant="secondary" className="text-xs">
                        {DATASET_TYPE_LABELS[dataset.datasetType] ?? dataset.datasetType}
                      </Badge>
                      {dataset.origin === "baseline" && (
                        <Badge variant="outline" className="text-[10px]">legacy</Badge>
                      )}
                      {dataset.promptId ? (
                        <Badge variant="outline" className="text-[10px] border-primary/40 text-primary/80">
                          {prompts.find((p) => p.id === dataset.promptId)?.name ?? dataset.promptName ?? "scoped"}
                        </Badge>
                      ) : dataset.promptName ? (
                        <Badge variant="outline" className="text-[10px]">{dataset.promptName}</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground/60">unscoped</Badge>
                      )}
                    </div>
                    {dataset.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{dataset.description}</p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {dataset.itemCount} item{dataset.itemCount !== 1 ? "s" : ""} · {new Date(dataset.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void deleteDataset(dataset.id)}
                    className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                    title="Delete dataset"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
