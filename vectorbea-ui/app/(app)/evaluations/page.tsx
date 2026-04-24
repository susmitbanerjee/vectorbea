"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, PlayCircle } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PromptDetail, PromptListItem, TraceSetEvaluationRunView, TraceSummaryView } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

export default function EvaluationsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [runs, setRuns] = useState<TraceSetEvaluationRunView[]>([]);
  const [traces, setTraces] = useState<TraceSummaryView[]>([]);
  const [prompts, setPrompts] = useState<PromptListItem[]>([]);
  const [versions, setVersions] = useState<PromptDetail[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [selectedTraceIds, setSelectedTraceIds] = useState<string[]>([]);
  const [reviewFilter, setReviewFilter] = useState<"all" | "pending_review" | "in_review" | "approved" | "rejected" | "needs_changes">("all");
  const [recommendationFilter, setRecommendationFilter] = useState<"all" | "ready_for_rollout" | "ready_with_caution" | "needs_review" | "regression_detected" | "blocked" | "inconclusive">("all");
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
        const [runsRes, tracesRes, promptsRes] = await Promise.all([
          fetch(`/api/evaluations/trace-sets?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
          fetch(`/api/traces?workspaceId=${encodeURIComponent(activeWorkspaceId)}&pageSize=100`, { cache: "no-store" }),
          fetch(`/api/prompts?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
        ]);
        const [runsJson, tracesJson, promptsJson] = await Promise.all([runsRes.json(), tracesRes.json(), promptsRes.json()]);
        if (!runsRes.ok) throw new Error(runsJson.error || "Failed to load evaluations");
        if (!tracesRes.ok) throw new Error(tracesJson.error || "Failed to load traces");
        if (!promptsRes.ok) throw new Error(promptsJson.error || "Failed to load prompts");
        if (!cancelled) {
          setRuns(runsJson as TraceSetEvaluationRunView[]);
          setTraces((tracesJson.items ?? []) as TraceSummaryView[]);
          setPrompts(promptsJson as PromptListItem[]);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load evaluation workspace");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId]);

  useEffect(() => {
    let cancelled = false;
    async function loadVersions() {
      if (!selectedPromptId) {
        setVersions([]);
        setSelectedVersionId("");
        return;
      }
      const response = await fetch(`/api/prompts/${encodeURIComponent(selectedPromptId)}/versions`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        if (!cancelled) setError(payload.error || "Failed to load prompt versions");
        return;
      }
      if (!cancelled) {
        setVersions(payload as PromptDetail[]);
        setSelectedVersionId((payload[0] as PromptDetail | undefined)?.promptVersionId ?? "");
      }
    }
    void loadVersions();
    return () => {
      cancelled = true;
    };
  }, [selectedPromptId]);

  const selectedVersion = useMemo(
    () => versions.find((version) => version.promptVersionId === selectedVersionId) ?? null,
    [selectedVersionId, versions],
  );

  const filteredRuns = useMemo(() => {
    return runs.filter((run) => {
      if (reviewFilter !== "all" && run.review.status !== reviewFilter) return false;
      if (recommendationFilter !== "all" && run.aggregate.recommendation !== recommendationFilter) return false;
      return true;
    });
  }, [runs, reviewFilter, recommendationFilter]);

  const createRun = async () => {
    if (!activeWorkspaceId || !selectedVersionId || selectedTraceIds.length === 0 || creating) return;
    setCreating(true);
    setError(null);
    try {
      const response = await fetch(`/api/evaluations/trace-sets?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceTraceIds: selectedTraceIds,
          candidatePromptVersionId: selectedVersionId,
        }),
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

  const toggleTrace = (traceId: string) => {
    setSelectedTraceIds((current) =>
      current.includes(traceId) ? current.filter((id) => id !== traceId) : [...current, traceId],
    );
  };

  return (
    <div className="min-h-screen">
      <AppHeader
        title="Evaluations"
        subtitle="Replay runtime traces against a candidate prompt version, score the results, and route through human review before rollout decisions."
      />

      <div className="space-y-4 px-4 py-6 md:px-6 xl:px-8">
        {error ? (
          <Card className="border-red-500/30 bg-red-500/10">
            <CardContent className="p-4 text-sm text-red-100">{error}</CardContent>
          </Card>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Create trace-set evaluation</CardTitle>
              <CardDescription>Choose a candidate prompt version and replay a production-like runtime trace set through the active executor path.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Prompt</div>
                <select className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={selectedPromptId} onChange={(event) => setSelectedPromptId(event.target.value)}>
                  <option value="">Select prompt</option>
                  {prompts.map((prompt) => (
                    <option key={prompt.id} value={prompt.id}>{prompt.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Candidate version</div>
                <select className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={selectedVersionId} onChange={(event) => setSelectedVersionId(event.target.value)}>
                  <option value="">Select version</option>
                  {versions.map((version) => (
                    <option key={version.promptVersionId} value={version.promptVersionId}>
                      {version.versionTag} {version.isPublished ? "(published)" : "(candidate)"}
                    </option>
                  ))}
                </select>
                {selectedVersion ? (
                  <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                    Candidate: <span className="font-medium text-foreground">{selectedVersion.name}@{selectedVersion.versionTag}</span>
                  </div>
                ) : null}
              </div>
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Selected runtime traces</div>
                <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                  {selectedTraceIds.length} trace{selectedTraceIds.length === 1 ? "" : "s"} selected
                </div>
              </div>
              <Button className="w-full gap-2" onClick={createRun} disabled={!selectedVersionId || selectedTraceIds.length === 0 || creating}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                Run trace-set evaluation
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Runtime trace set</CardTitle>
              <CardDescription>Only runtime executions appear here. Generic audits and promotion events are excluded.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {loading ? (
                <div className="p-6 text-sm text-muted-foreground">Loading runtime traces...</div>
              ) : traces.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">No runtime traces found yet.</div>
              ) : (
                traces.slice(0, 30).map((trace) => (
                  <button
                    key={trace.id}
                    type="button"
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left transition ${selectedTraceIds.includes(trace.id) ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-accent/20"}`}
                    onClick={() => toggleTrace(trace.id)}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{trace.promptName}@{trace.promptVersion}</div>
                      <div className="mt-1 font-mono text-xs text-muted-foreground">{trace.id}</div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <div>{trace.durationMs}ms</div>
                      <div>{trace.executorType}</div>
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Evaluation runs</CardTitle>
            <CardDescription>Trace-set evaluations with scoring, review state, and rollout recommendation.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid gap-2 pb-2 md:grid-cols-2">
              <select className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value as typeof reviewFilter)}>
                <option value="all">All review states</option>
                <option value="pending_review">Pending review</option>
                <option value="in_review">In review</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="needs_changes">Needs changes</option>
              </select>
              <select className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={recommendationFilter} onChange={(event) => setRecommendationFilter(event.target.value as typeof recommendationFilter)}>
                <option value="all">All recommendations</option>
                <option value="ready_for_rollout">Ready for rollout</option>
                <option value="ready_with_caution">Ready with caution</option>
                <option value="needs_review">Needs review</option>
                <option value="regression_detected">Regression detected</option>
                <option value="blocked">Blocked</option>
                <option value="inconclusive">Inconclusive</option>
              </select>
            </div>
            {filteredRuns.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
                No evaluation runs match the current filters.
              </div>
            ) : (
              filteredRuns.map((run) => (
                <Link key={run.id} href={`/evaluations/${encodeURIComponent(run.id)}?org=${encodeURIComponent(activeWorkspaceId ?? "")}`} className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 transition hover:bg-accent/20">
                  <div>
                    <div className="font-medium">{run.promptName}@{run.candidateVersionTag}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {run.sourceTraceIds.length} traces replayed · recommendation {run.aggregate.recommendation.replaceAll("_", " ")}
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
