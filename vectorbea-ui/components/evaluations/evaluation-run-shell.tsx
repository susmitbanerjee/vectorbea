"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";

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
                  <Metric label="Score" value={run.aggregate.score === null ? "Not scored" : `${Math.round(run.aggregate.score * 100)}%`} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Decision</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Badge variant={run.aggregate.recommendation === "ready_for_rollout" ? "success" : run.aggregate.recommendation === "regression_detected" ? "destructive" : "warning"}>
                    {run.aggregate.recommendation.replaceAll("_", " ")}
                  </Badge>
                  <Button className="w-full gap-2" onClick={approveRun} disabled={approving || run.status === "approved"}>
                    {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {run.status === "approved" ? "Candidate version approved" : "Approve version for rollout"}
                  </Button>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Per-trace results</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {run.results.map((result) => (
                  <div key={`${result.sourceTraceId}-${result.replayTraceId ?? "missing"}`} className="grid gap-3 rounded-lg border border-border bg-card px-4 py-3 md:grid-cols-[1.2fr_1.2fr_120px_120px_160px]">
                    <div>
                      <div className="text-xs text-muted-foreground">Source</div>
                      <Link href={`/traces/${encodeURIComponent(result.sourceTraceId)}?org=${encodeURIComponent(activeWorkspaceId ?? "")}`} className="font-mono text-xs text-primary hover:underline">
                        {result.sourceTraceId}
                      </Link>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Replay</div>
                      {result.replayTraceId ? (
                        <Link href={`/traces/compare?left=${encodeURIComponent(result.sourceTraceId)}&right=${encodeURIComponent(result.replayTraceId)}&org=${encodeURIComponent(activeWorkspaceId ?? "")}`} className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline">
                          {result.replayTraceId}
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">No replay trace</span>
                      )}
                    </div>
                    <Metric label="Status" value={result.status} />
                    <Metric label="Score" value={result.score === null ? "Unavailable" : `${Math.round(result.score * 100)}%`} />
                    <div>
                      <div className="text-xs text-muted-foreground">Delta</div>
                      <div className="text-sm">{result.latencyDeltaMs === null ? "Unavailable" : `${Math.round(result.latencyDeltaMs)}ms`}</div>
                    </div>
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-3">
      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
