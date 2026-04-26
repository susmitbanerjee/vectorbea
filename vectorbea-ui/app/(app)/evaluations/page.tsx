"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, Database, Loader2, PlayCircle, Search, X } from "lucide-react";

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
import type { EvaluationDataset, GoldenTrace, PromptDetail, PromptListItem, TraceSetEvaluationRunView, TraceSummaryView } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

const PAGE_SIZE = 20;

export default function EvaluationsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [runs, setRuns] = useState<TraceSetEvaluationRunView[]>([]);
  const [traces, setTraces] = useState<TraceSummaryView[]>([]);
  const [prompts, setPrompts] = useState<PromptListItem[]>([]);
  const [versions, setVersions] = useState<PromptDetail[]>([]);
  const [datasets, setDatasets] = useState<EvaluationDataset[]>([]);
  const [goldenTraces, setGoldenTraces] = useState<GoldenTrace[]>([]);

  // Create-run form state
  const [traceSource, setTraceSource] = useState<"manual" | "dataset" | "golden">("manual");
  const [selectedGoldenIds, setSelectedGoldenIds] = useState<string[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [selectedPromptId, setSelectedPromptId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [selectedTraceIds, setSelectedTraceIds] = useState<string[]>([]);
  const [traceSearch, setTraceSearch] = useState("");
  const [tracePage, setTracePage] = useState(0);

  // Evaluation runs list state
  const [statusFilter, setStatusFilter] = useState<"all" | "needs_review" | "approved" | "rejected" | "blocked" | "running" | "failed">("all");
  const [promptFilter, setPromptFilter] = useState("");
  const [candidateFilter, setCandidateFilter] = useState("");
  const [runsPage, setRunsPage] = useState(0);

  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!activeWorkspaceId) return;
      setLoading(true);
      setError(null);
      try {
        const [runsRes, tracesRes, promptsRes, datasetsRes, goldenRes] = await Promise.all([
          fetch(`/api/evaluations/trace-sets?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
          fetch(`/api/traces?workspaceId=${encodeURIComponent(activeWorkspaceId)}&pageSize=200`, { cache: "no-store" }),
          fetch(`/api/prompts?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
          fetch(`/api/evaluations/datasets?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
          fetch(`/api/evaluations/golden-traces?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
        ]);
        const [runsJson, tracesJson, promptsJson, datasetsJson, goldenJson] = await Promise.all([
          runsRes.json(), tracesRes.json(), promptsRes.json(), datasetsRes.json(), goldenRes.json(),
        ]);
        if (!runsRes.ok) throw new Error(runsJson.error || "Failed to load evaluations");
        if (!tracesRes.ok) throw new Error(tracesJson.error || "Failed to load traces");
        if (!promptsRes.ok) throw new Error(promptsJson.error || "Failed to load prompts");
        if (!cancelled) {
          setRuns(runsJson as TraceSetEvaluationRunView[]);
          setTraces((tracesJson.items ?? []) as TraceSummaryView[]);
          setPrompts(promptsJson as PromptListItem[]);
          setDatasets(Array.isArray(datasetsJson) ? datasetsJson as EvaluationDataset[] : []);
          setGoldenTraces(Array.isArray(goldenJson) ? goldenJson as GoldenTrace[] : (goldenJson?.items ?? []));
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load evaluations");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [activeWorkspaceId]);

  useEffect(() => {
    let cancelled = false;
    async function loadVersions() {
      if (!selectedPromptId) { setVersions([]); setSelectedVersionId(""); return; }
      const response = await fetch(`/api/prompts/${encodeURIComponent(selectedPromptId)}/versions`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) { if (!cancelled) setError(payload.error || "Failed to load prompt versions"); return; }
      if (!cancelled) {
        setVersions(payload as PromptDetail[]);
        setSelectedVersionId((payload[0] as PromptDetail | undefined)?.promptVersionId ?? "");
      }
    }
    void loadVersions();
    return () => { cancelled = true; };
  }, [selectedPromptId]);

  // Sync selectedTraceIds for golden/manual modes; dataset mode uses datasetId directly
  useEffect(() => {
    if (traceSource === "golden") {
      setSelectedTraceIds(selectedGoldenIds);
    } else if (traceSource === "manual") {
      setSelectedTraceIds([]);
    }
    // dataset mode: no trace IDs needed — datasetId is sent directly to the API
  }, [traceSource, selectedGoldenIds]);

  const selectedVersion = useMemo(
    () => versions.find(v => v.promptVersionId === selectedVersionId) ?? null,
    [selectedVersionId, versions],
  );

  // When the prompt changes, reset the dataset selection if the current dataset is scoped to a different prompt
  useEffect(() => {
    if (!selectedDatasetId || !selectedPromptId) return;
    const ds = datasets.find(d => d.id === selectedDatasetId);
    if (ds?.promptId && ds.promptId !== selectedPromptId) {
      setSelectedDatasetId("");
    }
  }, [selectedPromptId, datasets]); // eslint-disable-line react-hooks/exhaustive-deps

  // Datasets filtered to those compatible with the selected prompt
  // A dataset with no promptId (legacy/unscoped) is shown for any prompt
  const compatibleDatasets = useMemo(() => {
    if (!selectedPromptId) return datasets;
    return datasets.filter(d => !d.promptId || d.promptId === selectedPromptId);
  }, [datasets, selectedPromptId]);

  // Filtered + paginated traces for the manual selection panel
  const filteredTraces = useMemo(() => {
    const q = traceSearch.trim().toLowerCase();
    if (!q) return traces;
    return traces.filter(t =>
      t.promptName?.toLowerCase().includes(q) ||
      t.id?.toLowerCase().includes(q) ||
      t.promptVersion?.toLowerCase().includes(q)
    );
  }, [traces, traceSearch]);

  const tracePageCount = Math.ceil(filteredTraces.length / PAGE_SIZE);
  const visibleTraces = filteredTraces.slice(tracePage * PAGE_SIZE, (tracePage + 1) * PAGE_SIZE);

  // Filtered + paginated evaluation runs
  const filteredRuns = useMemo(() => {
    return runs.filter(run => {
      if (statusFilter === "needs_review") {
        if (!(run.review.status === "pending_review" || run.review.status === "in_review" || run.review.status === "needs_changes" || run.aggregate.recommendation === "needs_review")) return false;
      } else if (statusFilter === "approved") {
        if (!(run.review.status === "approved" || run.status === "approved")) return false;
      } else if (statusFilter === "rejected") {
        if (run.review.status !== "rejected") return false;
      } else if (statusFilter === "blocked") {
        if (!(run.aggregate.recommendation === "blocked" || run.aggregate.recommendation === "regression_detected")) return false;
      } else if (statusFilter === "running") {
        if (!(run.status === "running" || run.status === "queued")) return false;
      } else if (statusFilter === "failed") {
        if (!(run.status === "failed" || run.aggregate.failed > 0)) return false;
      }
      if (promptFilter && !run.promptName?.toLowerCase().includes(promptFilter.toLowerCase())) return false;
      if (candidateFilter && !run.candidateVersionTag?.toLowerCase().includes(candidateFilter.toLowerCase())) return false;
      return true;
    });
  }, [runs, statusFilter, promptFilter, candidateFilter]);

  const runsPageCount = Math.ceil(filteredRuns.length / PAGE_SIZE);
  const visibleRuns = filteredRuns.slice(runsPage * PAGE_SIZE, (runsPage + 1) * PAGE_SIZE);

  const toggleTrace = (traceId: string) => {
    setSelectedTraceIds(current =>
      current.includes(traceId) ? current.filter(id => id !== traceId) : [...current, traceId],
    );
  };

  const canCreateRun = !!selectedVersionId && (
    traceSource === "dataset" ? !!selectedDatasetId : selectedTraceIds.length > 0
  );

  const createRun = async () => {
    if (!activeWorkspaceId || !canCreateRun || creating) return;
    setCreating(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { candidatePromptVersionId: selectedVersionId };
      if (traceSource === "dataset") {
        body.datasetId = selectedDatasetId;
      } else {
        body.sourceTraceIds = selectedTraceIds;
      }
      const response = await fetch(`/api/evaluations/trace-sets?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to create evaluation run");
      window.location.href = `/evaluations/${payload.id}?org=${encodeURIComponent(activeWorkspaceId)}`;
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create evaluation run");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen">
      <AppHeader
        title="Evaluations"
        subtitle="Evaluate prompt versions against datasets or runtime traces, score results, and route through human review before rollout decisions."
      />

      <div className="space-y-4 px-4 py-6 md:px-6 xl:px-8">
        {error ? (
          <Card className="border-red-500/30 bg-red-500/10">
            <CardContent className="p-4 text-sm text-red-100">{error}</CardContent>
          </Card>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
          {/* ── Create run form ── */}
          <Card>
            <CardHeader>
              <CardTitle>Create evaluation run</CardTitle>
              <CardDescription>Choose a candidate prompt version and a trace source or evaluation dataset.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Prompt */}
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Prompt</div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-10 w-full items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="truncate text-left">
                        {selectedPromptId
                          ? (prompts.find(p => p.id === selectedPromptId)?.name ?? selectedPromptId)
                          : <span className="text-muted-foreground">Select prompt</span>}
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
                    <DropdownMenuRadioGroup value={selectedPromptId} onValueChange={setSelectedPromptId}>
                      {prompts.map(p => (
                        <DropdownMenuPanelRadioItem key={p.id} value={p.id}>{p.name}</DropdownMenuPanelRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuPanel>
                </DropdownMenu>
              </div>

              {/* Candidate version */}
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Candidate version</div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-10 w-full items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="truncate text-left">
                        {selectedVersionId
                          ? (() => { const v = versions.find(v => v.promptVersionId === selectedVersionId); return v ? `${v.versionTag} ${v.isPublished ? "(published)" : "(candidate)"}` : selectedVersionId; })()
                          : <span className="text-muted-foreground">Select version</span>}
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
                    <DropdownMenuRadioGroup value={selectedVersionId} onValueChange={setSelectedVersionId}>
                      {versions.map(v => (
                        <DropdownMenuPanelRadioItem key={v.promptVersionId} value={v.promptVersionId}>
                          {v.versionTag} {v.isPublished ? "(published)" : "(candidate)"}
                        </DropdownMenuPanelRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuPanel>
                </DropdownMenu>
                {selectedVersion ? (
                  <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                    Candidate: <span className="font-medium text-foreground">{selectedVersion.name}@{selectedVersion.versionTag}</span>
                  </div>
                ) : null}
              </div>

              {/* Trace source toggle */}
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Trace source</div>
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setTraceSource("manual")}
                    className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition ${traceSource === "manual" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/40"}`}
                  >
                    Manual selection
                  </button>
                  <button
                    type="button"
                    onClick={() => setTraceSource("dataset")}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${traceSource === "dataset" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/40"}`}
                  >
                    <Database className="h-3.5 w-3.5" />
                    Evaluation dataset
                  </button>
                  <button
                    type="button"
                    onClick={() => setTraceSource("golden")}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${traceSource === "golden" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/40"}`}
                  >
                    Golden traces
                  </button>
                </div>
              </div>

              {/* Golden trace selector */}
              {traceSource === "golden" && (
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Select golden traces</div>
                  {goldenTraces.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No golden traces yet.</p>
                  ) : (
                    <div className="max-h-[280px] overflow-y-auto space-y-1 rounded-lg border border-border/50 p-2">
                      {goldenTraces.map(gt => (
                        <button
                          key={gt.id}
                          type="button"
                          className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition ${selectedGoldenIds.includes(gt.traceId) ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-accent/20"}`}
                          onClick={() => setSelectedGoldenIds(ids => ids.includes(gt.traceId) ? ids.filter(id => id !== gt.traceId) : [...ids, gt.traceId])}
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium">{gt.promptName ?? gt.traceId}</div>
                            <div className="mt-0.5 font-mono text-muted-foreground">{gt.traceId.slice(0, 20)}…</div>
                          </div>
                          {gt.label && <span className="ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] bg-muted">{gt.label}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedGoldenIds.length > 0 && (
                    <p className="text-xs text-muted-foreground">{selectedGoldenIds.length} golden trace{selectedGoldenIds.length !== 1 ? "s" : ""} selected</p>
                  )}
                </div>
              )}

              {/* Dataset selector */}
              {traceSource === "dataset" && (
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Select dataset</div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex h-10 w-full items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className="truncate text-left">
                          {selectedDatasetId
                            ? (() => { const ds = datasets.find(d => d.id === selectedDatasetId); return ds ? `${ds.name} (${ds.itemCount} items)` : selectedDatasetId; })()
                            : <span className="text-muted-foreground">Choose a dataset</span>}
                        </span>
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
                      <DropdownMenuRadioGroup value={selectedDatasetId} onValueChange={setSelectedDatasetId}>
                        {compatibleDatasets.length === 0 ? (
                          <div className="px-3 py-2 text-xs text-muted-foreground">
                            {selectedPromptId ? "No datasets scoped to this prompt." : "No datasets yet."}
                          </div>
                        ) : compatibleDatasets.map(ds => (
                          <DropdownMenuPanelRadioItem key={ds.id} value={ds.id}>
                            <span className="flex w-full items-center justify-between gap-2">
                              <span className="truncate">{ds.name}</span>
                              <span className="shrink-0 text-muted-foreground text-[10px] tabular-nums">
                                {ds.itemCount} items · {ds.origin === "baseline" ? "legacy" : ds.datasetType}
                              </span>
                            </span>
                          </DropdownMenuPanelRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuPanel>
                  </DropdownMenu>
                  {selectedDatasetId && (() => {
                    const ds = datasets.find(d => d.id === selectedDatasetId);
                    if (!ds) return null;
                    return (
                      <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground flex items-center justify-between">
                        <span>{ds.itemCount} items · <span className="capitalize">{ds.origin === "baseline" ? "legacy baseline" : ds.datasetType}</span></span>
                        {ds.origin === "baseline" && <Badge variant="secondary" className="text-[10px]">legacy</Badge>}
                      </div>
                    );
                  })()}
                  {datasets.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No datasets yet.{" "}
                      <Link href={`/evaluations/datasets?org=${encodeURIComponent(activeWorkspaceId ?? "")}`} className="text-primary hover:underline">
                        Create one →
                      </Link>
                    </p>
                  ) : compatibleDatasets.length === 0 && selectedPromptId ? (
                    <p className="text-xs text-amber-400">
                      No datasets are scoped to this prompt.{" "}
                      <Link href={`/evaluations/datasets?org=${encodeURIComponent(activeWorkspaceId ?? "")}`} className="underline">
                        Create a dataset for this prompt →
                      </Link>
                    </p>
                  ) : null}
                </div>
              )}

              {/* Selected count */}
              {traceSource !== "dataset" && (
                <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                  {selectedTraceIds.length} trace{selectedTraceIds.length === 1 ? "" : "s"} selected
                  {selectedTraceIds.length > 0 && traceSource === "manual" && (
                    <button type="button" onClick={() => setSelectedTraceIds([])} className="ml-2 text-xs text-muted-foreground hover:text-foreground">
                      Clear
                    </button>
                  )}
                </div>
              )}

              {/* Validation summary */}
              <div className="space-y-1 rounded-lg border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
                <div className={selectedVersionId ? "text-emerald-500" : ""}>
                  {selectedVersionId ? "✓" : "○"} Candidate version: {selectedVersionId ? (selectedVersion?.versionTag ?? selectedVersionId) : "not selected"}
                </div>
                {traceSource === "dataset" ? (
                  <div className={selectedDatasetId ? "text-emerald-500" : ""}>
                    {selectedDatasetId ? "✓" : "○"} Dataset: {selectedDatasetId ? (datasets.find(d => d.id === selectedDatasetId)?.name ?? selectedDatasetId) : "not selected"}
                  </div>
                ) : (
                  <div className={selectedTraceIds.length > 0 ? "text-emerald-500" : ""}>
                    {selectedTraceIds.length > 0 ? "✓" : "○"} Traces: {selectedTraceIds.length} selected
                  </div>
                )}
              </div>

              <Button
                className="w-full gap-2"
                onClick={createRun}
                disabled={!canCreateRun || creating}
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                {traceSource === "dataset" ? "Run dataset evaluation" : "Run trace-set evaluation"}
              </Button>
            </CardContent>
          </Card>

          {/* ── Runtime trace selector (manual mode only) ── */}
          <Card>
            <CardHeader>
              <CardTitle>Trace source</CardTitle>
              <CardDescription>
                {traceSource === "dataset"
                  ? "Dataset selected above — items will be replayed or executed fresh."
                  : "Select runtime traces to include in the evaluation run."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {traceSource === "dataset" ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  Using evaluation dataset — items are pre-selected above.
                  {selectedDatasetId && (() => {
                    const ds = datasets.find(d => d.id === selectedDatasetId);
                    if (!ds) return null;
                    return <div className="mt-2 font-medium text-foreground">{ds.name} · {ds.itemCount} items</div>;
                  })()}
                </div>
              ) : loading ? (
                <div className="p-6 text-sm text-muted-foreground">Loading runtime traces…</div>
              ) : traces.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">No runtime traces found yet.</div>
              ) : (
                <>
                  {/* Search */}
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-8 text-sm"
                      placeholder="Filter by prompt or trace ID…"
                      value={traceSearch}
                      onChange={e => { setTraceSearch(e.target.value); setTracePage(0); }}
                    />
                    {traceSearch && (
                      <button type="button" onClick={() => { setTraceSearch(""); setTracePage(0); }} className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Trace list — fixed height */}
                  <div className="max-h-[420px] overflow-y-auto space-y-1.5 rounded-lg border border-border/50 p-2">
                    {visibleTraces.length === 0 ? (
                      <div className="p-4 text-sm text-muted-foreground">No traces match that filter.</div>
                    ) : visibleTraces.map(trace => (
                      <button
                        key={trace.id}
                        type="button"
                        className={`flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left transition ${selectedTraceIds.includes(trace.id) ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-accent/20"}`}
                        onClick={() => toggleTrace(trace.id)}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{trace.promptName}@{trace.promptVersion}</div>
                          <div className="mt-0.5 font-mono text-xs text-muted-foreground">{trace.id}</div>
                        </div>
                        <div className="shrink-0 text-right text-xs text-muted-foreground">
                          <div>{trace.durationMs}ms</div>
                          <div>{trace.executorType}</div>
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Pagination */}
                  {tracePageCount > 1 && (
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{filteredTraces.length} traces {traceSearch ? "(filtered)" : ""}</span>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setTracePage(p => Math.max(0, p - 1))}
                          disabled={tracePage === 0}
                          className="rounded-md border border-border px-2 py-1 disabled:opacity-40 hover:bg-muted/40"
                        >
                          ←
                        </button>
                        <span className="px-2 py-1">{tracePage + 1} / {tracePageCount}</span>
                        <button
                          type="button"
                          onClick={() => setTracePage(p => Math.min(tracePageCount - 1, p + 1))}
                          disabled={tracePage >= tracePageCount - 1}
                          className="rounded-md border border-border px-2 py-1 disabled:opacity-40 hover:bg-muted/40"
                        >
                          →
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Evaluation runs list ── */}
        <Card>
          <CardHeader>
            <CardTitle>Evaluation runs</CardTitle>
            <CardDescription>Evaluation runs with scoring, review state, and rollout recommendation.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex flex-wrap gap-2 pb-2">
              <input
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                placeholder="Filter by prompt…"
                value={promptFilter}
                onChange={e => { setPromptFilter(e.target.value); setRunsPage(0); }}
              />
              <input
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                placeholder="Filter by version…"
                value={candidateFilter}
                onChange={e => { setCandidateFilter(e.target.value); setRunsPage(0); }}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-9 min-w-[140px] items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent/40"
                  >
                    <span className="truncate">
                      {{ all: "All", needs_review: "Needs Review", approved: "Approved", rejected: "Rejected", blocked: "Blocked", running: "Running", failed: "Failed" }[statusFilter]}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuPanel>
                  <DropdownMenuRadioGroup value={statusFilter} onValueChange={(v) => { setStatusFilter(v as typeof statusFilter); setRunsPage(0); }}>
                    <DropdownMenuPanelRadioItem value="all">All</DropdownMenuPanelRadioItem>
                    <DropdownMenuPanelRadioItem value="needs_review">Needs Review</DropdownMenuPanelRadioItem>
                    <DropdownMenuPanelRadioItem value="approved">Approved</DropdownMenuPanelRadioItem>
                    <DropdownMenuPanelRadioItem value="rejected">Rejected</DropdownMenuPanelRadioItem>
                    <DropdownMenuPanelRadioItem value="blocked">Blocked</DropdownMenuPanelRadioItem>
                    <DropdownMenuPanelRadioItem value="running">Running</DropdownMenuPanelRadioItem>
                    <DropdownMenuPanelRadioItem value="failed">Failed</DropdownMenuPanelRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuPanel>
              </DropdownMenu>
            </div>

            {/* Fixed-height scrollable runs list */}
            <div className="max-h-[520px] overflow-y-auto space-y-1.5 vb-scrollbar">
              {filteredRuns.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
                  No evaluation runs match the current filters.
                </div>
              ) : (
                visibleRuns.map(run => (
                  <Link
                    key={run.id}
                    href={`/evaluations/${encodeURIComponent(run.id)}?org=${encodeURIComponent(activeWorkspaceId ?? "")}`}
                    className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 transition hover:bg-accent/20"
                  >
                    <div>
                      <div className="font-medium">{run.promptName}@{run.candidateVersionTag}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {run.datasetName
                          ? <><Database className="inline h-3 w-3 mr-0.5" />{run.datasetName} · </>
                          : `${run.sourceTraceIds.length} traces · `}
                        {run.aggregate.recommendation.replaceAll("_", " ")}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={run.aggregate.recommendation === "ready_for_rollout" ? "success" : run.aggregate.recommendation === "regression_detected" || run.aggregate.recommendation === "blocked" ? "destructive" : "warning"}>
                        {run.aggregate.recommendation.replaceAll("_", " ")}
                      </Badge>
                      <Badge variant={run.review.status === "approved" ? "success" : run.review.status === "rejected" ? "destructive" : "secondary"}>
                        {run.review.status.replaceAll("_", " ")}
                      </Badge>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </Link>
                ))
              )}
            </div>

            {/* Runs pagination */}
            {runsPageCount > 1 && (
              <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
                <span>{filteredRuns.length} runs</span>
                <div className="flex gap-1">
                  <button type="button" onClick={() => setRunsPage(p => Math.max(0, p - 1))} disabled={runsPage === 0} className="rounded-md border border-border px-2 py-1 disabled:opacity-40 hover:bg-muted/40">←</button>
                  <span className="px-2 py-1">{runsPage + 1} / {runsPageCount}</span>
                  <button type="button" onClick={() => setRunsPage(p => Math.min(runsPageCount - 1, p + 1))} disabled={runsPage >= runsPageCount - 1} className="rounded-md border border-border px-2 py-1 disabled:opacity-40 hover:bg-muted/40">→</button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
