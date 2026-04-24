"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Loader2, ShieldCheck, ShieldAlert, MessageSquareWarning } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TraceSetEvaluationRunView } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

export function EvaluationRunShell({ runId }: { runId: string }) {
  const { activeWorkspaceId } = useWorkspace();
  const [run, setRun] = useState<TraceSetEvaluationRunView | null>(null);
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadRun() {
      if (!activeWorkspaceId || !runId) return;
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/evaluations/trace-sets/${encodeURIComponent(runId)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Failed to load evaluation run");
        if (!cancelled) setRun(payload as TraceSetEvaluationRunView);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load evaluation run");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadRun();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, runId]);

  const approveRun = async () => {
    if (!activeWorkspaceId || !run || approving) return;
    setApproving(true);
    setError(null);
    try {
      const response = await fetch(`/api/evaluations/trace-sets/${encodeURIComponent(run.id)}/approve?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to approve candidate version");
      setRun(payload as TraceSetEvaluationRunView);
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : "Failed to approve candidate version");
    } finally {
      setApproving(false);
    }
  };

  const submitReview = async (
    status: TraceSetEvaluationRunView["review"]["status"],
    decision: TraceSetEvaluationRunView["review"]["decision"],
  ) => {
    if (!activeWorkspaceId || !run || reviewing) return;
    setReviewing(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/evaluations/trace-sets/${encodeURIComponent(run.id)}/review?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, decision, note: reviewNote }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to update review state");
      setRun(payload as TraceSetEvaluationRunView);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Failed to update review state");
    } finally {
      setReviewing(false);
    }
  };

  return (
    <div className="min-h-screen">
      <AppHeader title="Evaluation run" subtitle={runId ? `Evaluations / ${runId}` : "Evaluations"} />
      <div className="space-y-4 px-4 py-6 md:px-6 xl:px-8">
        {error ? (
          <Card className="border-red-500/30 bg-red-500/10">
            <CardContent className="p-4 text-sm text-red-100">{error}</CardContent>
          </Card>
        ) : null}

        {loading || !run ? (
          <Card>
            <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading evaluation run...
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <Card>
                <CardHeader>
                  <CardTitle>{run.promptName}@{run.candidateVersionTag}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3">
                  <Metric label="Source traces" value={String(run.aggregate.total)} />
                  <Metric label="Succeeded" value={String(run.aggregate.succeeded)} />
                  <Metric label="Recommendation" value={run.aggregate.recommendation.replaceAll("_", " ")} />
                  <Metric label="Avg latency delta" value={run.aggregate.averageLatencyDeltaMs === null ? "Unavailable" : `${Math.round(run.aggregate.averageLatencyDeltaMs)}ms`} />
                  <Metric label="Avg token delta" value={run.aggregate.averageTokenDelta === null ? "Unavailable" : `${Math.round(run.aggregate.averageTokenDelta)}`} />
                  <Metric label="Score" value={run.aggregate.score === null ? "Not scored" : `${Math.round(run.aggregate.score * 100)}%`} weightNote />
                  <Metric label="Confidence" value={run.aggregate.confidence === null ? "Unavailable" : `${Math.round(run.aggregate.confidence * 100)}%`} />
                  <Metric label="Critical failures" value={String(run.aggregate.criticalFailures)} />
                  <Metric label="Observability" value={run.aggregate.observabilityLevel} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Review & decision</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Badge variant={run.aggregate.recommendation === "ready_for_rollout" ? "success" : run.aggregate.recommendation === "regression_detected" ? "destructive" : "warning"}>
                    {run.aggregate.recommendation.replaceAll("_", " ")}
                  </Badge>
                  <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    Review status: <span className="font-medium text-foreground">{run.review.status.replaceAll("_", " ")}</span>
                  </div>
                  <textarea
                    className="min-h-20 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    placeholder="Reviewer rationale"
                    value={reviewNote}
                    onChange={(event) => setReviewNote(event.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" className="gap-2" onClick={() => submitReview("in_review", "start_review")} disabled={reviewing}>
                      {reviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                      In review
                    </Button>
                    <Button variant="outline" className="gap-2" onClick={() => submitReview("needs_changes", "request_changes")} disabled={reviewing}>
                      {reviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareWarning className="h-4 w-4" />}
                      Needs changes
                    </Button>
                    <Button variant="outline" className="gap-2" onClick={() => submitReview("rejected", "reject")} disabled={reviewing}>
                      {reviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
                      Reject
                    </Button>
                    <Button variant="outline" className="gap-2" onClick={() => submitReview("approved", "approve")} disabled={reviewing}>
                      {reviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Approve review
                    </Button>
                  </div>
                  <Button className="w-full gap-2" onClick={approveRun} disabled={approving || run.status === "approved" || !run.promotion.allowed}>
                    {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {run.status === "approved" ? "Candidate version promoted" : "Promote version to rollout"}
                  </Button>
                  {!run.promotion.allowed ? (
                    <div className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                      {run.promotion.reasons.map((reason, index) => (
                        <div key={`${reason}-${index}`}>{reason}</div>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>

            {run.aggregate.reasons.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Recommendation rationale</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  {run.aggregate.reasons.map((reason, index) => (
                    <div key={`${reason}-${index}`} className="rounded-lg border border-border bg-card px-3 py-2">
                      {reason}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>Per-trace results</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {run && (
                  <p className="text-xs text-muted-foreground">
                    Reviewer identity is the authenticated user ID. No expanded reviewer profile is stored.
                  </p>
                )}
                {run.results.map((result) => (
                  <div key={`${result.sourceTraceId}-${result.replayTraceId ?? "missing"}`} className="space-y-2 rounded-lg border border-border bg-card px-4 py-3">
                    <div className="grid gap-3 md:grid-cols-[1.2fr_1.2fr_120px_120px_160px_140px]">
                    <div>
                      <div className="text-xs text-muted-foreground">Source</div>
                      <Link href={`/traces/${encodeURIComponent(result.sourceTraceId)}?org=${encodeURIComponent(activeWorkspaceId ?? "")}`} className="font-mono text-xs text-primary hover:underline">
                        {result.sourceTraceId}
                      </Link>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Replay</div>
                      {result.replayTraceId ? (
                        <div className="space-y-1">
                          <Link href={`/traces/compare?left=${encodeURIComponent(result.sourceTraceId)}&right=${encodeURIComponent(result.replayTraceId)}&org=${encodeURIComponent(activeWorkspaceId ?? "")}`} className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline">
                            {result.replayTraceId}
                            <ArrowRight className="h-3 w-3" />
                          </Link>
                          <div className="text-[10px] text-muted-foreground">
                            {result.replayMode === "simulated"
                              ? "Simulated replay (direct-provider limitation)"
                              : result.replayMode === "live"
                                ? "Live replay (enterprise gateway)"
                                : "Replay mode unavailable"}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">No replay trace</span>
                      )}
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Status</div>
                      <div className="mt-1 text-sm font-medium">
                        {result.status}
                        {result.observabilityNote && (
                          <span className="text-[10px] text-muted-foreground"> {result.observabilityNote}</span>
                        )}
                      </div>
                    </div>
                    <Metric label="Score" value={result.score === null ? "Unavailable" : `${Math.round(result.score * 100)}%`} />
                    <div>
                      <div className="text-xs text-muted-foreground">Delta</div>
                      <div className="text-sm">{result.latencyDeltaMs === null ? "Unavailable" : `${Math.round(result.latencyDeltaMs)}ms`}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Confidence</div>
                      <div className="text-sm">{result.confidence === null || result.confidence === undefined ? "Unavailable" : `${Math.round(result.confidence * 100)}%`}</div>
                    </div>
                    </div>
                    {result.checks && result.checks.length > 0 ? (
                      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {result.checks.slice(0, 6).map((check, index) => (
                          <div key={`${check.name}-${index}`} className="rounded-md border border-border/70 bg-muted/30 px-2 py-2 text-xs">
                            <div className="font-medium">{check.name.replaceAll("_", " ")}</div>
                            <div className="text-muted-foreground">{check.reason || "No reason attached"}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, weightNote }: { label: string; value: string; weightNote?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-3">
      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">
        {value}
        {weightNote && (
          <span className="ml-1 text-[10px] text-muted-foreground" title="Scoring weights are code-configured in trace-compare.ts and are not editable via the UI.">
            (weights: system config)
          </span>
        )}
      </div>
    </div>
  );
}
