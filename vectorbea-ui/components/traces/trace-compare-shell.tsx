"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  GitCompareArrows,
  Loader2,
  PlayCircle,
  ShieldAlert,
  Sparkles,
  Timer,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TraceCompareResponse, TraceDetailView, TraceEvaluationCheckView } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";

type Props = {
  leftTraceId: string;
  rightTraceId: string;
};

function formatDuration(ms: number) {
  if (!Number.isFinite(ms)) return "-";
  if (Math.abs(ms) < 1) return "<1ms";
  if (Math.abs(ms) < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatDelta(ms: number) {
  const sign = ms > 0 ? "+" : "";
  return `${sign}${formatDuration(ms)}`;
}

function formatCost(cost: number | null | undefined) {
  if (typeof cost !== "number" || !Number.isFinite(cost)) return "Unavailable";
  return `$${cost.toFixed(4)}`;
}

function formatScore(score: number | null | undefined) {
  if (typeof score !== "number" || !Number.isFinite(score)) return "Not run";
  return `${Math.round(score * 100)}%`;
}

function formatTraceId(id: string) {
  return id.length > 18 ? `${id.slice(0, 12)}...${id.slice(-6)}` : id;
}

function labelTone(label: string) {
  if (label === "better" || label === "pass") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700";
  if (label === "worse" || label === "fail") return "border-red-500/30 bg-red-500/10 text-red-700";
  return "border-border bg-card text-foreground";
}

function TraceIdentity({ label, trace }: { label: string; trace: TraceDetailView }) {
  return (
    <Card className="rounded-2xl border-border bg-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm text-foreground">{label}</CardTitle>
          <Badge className={cn("border", labelTone(trace.status))}>{trace.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="font-mono text-xs text-primary">{trace.id}</div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="border-border text-foreground">
            {trace.promptName}@{trace.promptVersion}
          </Badge>
          <Badge variant="outline" className="border-border text-foreground">
            {trace.executorType}
          </Badge>
          <Badge variant="outline" className="border-border text-foreground">
            {trace.executorObservability} observability
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground">{new Date(trace.startedAt).toLocaleString()}</div>
      </CardContent>
    </Card>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "neutral" | "good" | "warn";
}) {
  return (
    <Card
      className={cn(
        "rounded-2xl border bg-card",
        tone === "good"
          ? "border-emerald-500/30"
          : tone === "warn"
            ? "border-amber-500/30"
            : "border-border",
      )}
    >
      <CardContent className="space-y-2 p-4">
        <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold text-foreground">{value}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

function SideBySide({
  title,
  left,
  right,
  mono = false,
}: {
  title: string;
  left: string;
  right: string;
  mono?: boolean;
}) {
  return (
    <Card className="rounded-2xl border-border bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 lg:grid-cols-2">
        <pre className={cn("min-h-40 whitespace-pre-wrap rounded-xl border border-border bg-muted/40 p-4 text-sm text-foreground", mono && "font-mono text-xs")}>
          {left || "No data captured"}
        </pre>
        <pre className={cn("min-h-40 whitespace-pre-wrap rounded-xl border border-border bg-muted/40 p-4 text-sm text-foreground", mono && "font-mono text-xs")}>
          {right || "No data captured"}
        </pre>
      </CardContent>
    </Card>
  );
}

function EvaluationCheck({ check }: { check: TraceEvaluationCheckView }) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-foreground">{check.name}</div>
        <Badge className={cn("border", labelTone(check.label))}>{check.label}</Badge>
      </div>
      <div className="mt-2 text-sm text-muted-foreground">{check.reason}</div>
      <div className="mt-2 font-mono text-xs text-muted-foreground">score {formatScore(check.score)}</div>
    </div>
  );
}

export function TraceCompareShell({ leftTraceId, rightTraceId }: Props) {
  const { activeWorkspaceId } = useWorkspace();
  const [comparison, setComparison] = useState<TraceCompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadComparison() {
      if (!activeWorkspaceId || !leftTraceId || !rightTraceId) return;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          workspaceId: activeWorkspaceId,
          left: leftTraceId,
          right: rightTraceId,
        });
        const response = await fetch(`/api/traces/compare?${params.toString()}`, { cache: "no-store" });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({ error: "Failed to load comparison" }))) as { error?: string };
          throw new Error(body.error || `Failed to load comparison (${response.status})`);
        }
        const payload = (await response.json()) as TraceCompareResponse;
        if (!cancelled) setComparison(payload);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load comparison");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadComparison();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, leftTraceId, rightTraceId]);

  const runEvaluation = async () => {
    if (!activeWorkspaceId || !comparison || evaluating) return;
    setEvaluating(true);
    setError(null);
    try {
      const params = new URLSearchParams({ workspaceId: activeWorkspaceId });
      const response = await fetch(`/api/traces/compare/evaluate?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leftTraceId: comparison.left.id,
          rightTraceId: comparison.right.id,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({ error: "Failed to run evaluation" }))) as { error?: string };
        throw new Error(body.error || `Failed to run evaluation (${response.status})`);
      }
      setComparison((await response.json()) as TraceCompareResponse);
    } catch (evalError) {
      setError(evalError instanceof Error ? evalError.message : "Failed to run evaluation");
    } finally {
      setEvaluating(false);
    }
  };

  const totalLeftTokens = comparison ? comparison.left.tokensIn + comparison.left.tokensOut : 0;
  const totalRightTokens = comparison ? comparison.right.tokensIn + comparison.right.tokensOut : 0;

  const outputTone = comparison?.summary.outputChanged ? "warn" : "good";
  const latencyTone = comparison && comparison.summary.latencyDeltaMs <= 0 ? "good" : "warn";
  const evalTone = comparison?.summary.evaluation?.label === "better" || comparison?.summary.evaluation?.label === "pass" ? "good" : "neutral";

  const timingRows = useMemo(() => {
    if (!comparison) return [];

    type TimingRow = {
      name: string;
      type: TraceDetailView["spans"][number]["type"];
      service: string;
      left: number | null;
      right: number | null;
      delta: number | null;
    };
    const spanKey = (span: TraceDetailView["spans"][number]) =>
      `${span.type}:${span.service}:${span.name}`.toLowerCase();
    const looseSpanKey = (span: TraceDetailView["spans"][number]) =>
      `${span.type}:${span.service}`.toLowerCase();
    const leftByExact = new Map(comparison.left.spans.map((span) => [spanKey(span), span]));
    const leftByLoose = new Map(comparison.left.spans.map((span) => [looseSpanKey(span), span]));
    const seenLeft = new Set<string>();
    const rows: TimingRow[] = comparison.right.spans.map((rightSpan) => {
      const exactKey = spanKey(rightSpan);
      const leftSpan = leftByExact.get(exactKey) ?? leftByLoose.get(looseSpanKey(rightSpan));
      if (leftSpan) seenLeft.add(spanKey(leftSpan));
      return {
        name: rightSpan.name,
        type: rightSpan.type,
        service: rightSpan.service,
        left: leftSpan?.durationMs ?? null,
        right: rightSpan.durationMs,
        delta: leftSpan ? rightSpan.durationMs - leftSpan.durationMs : null,
      };
    });

    for (const leftSpan of comparison.left.spans) {
      if (seenLeft.has(spanKey(leftSpan))) continue;
      rows.push({
        name: leftSpan.name,
        type: leftSpan.type,
        service: leftSpan.service,
        left: leftSpan.durationMs,
        right: null,
        delta: null,
      });
    }

    return rows
      .sort((a, b) => {
        const leftA = a.left ?? Number.MAX_SAFE_INTEGER;
        const leftB = b.left ?? Number.MAX_SAFE_INTEGER;
        return leftA - leftB;
      })
      .slice(0, 16);
  }, [comparison]);

  if (!activeWorkspaceId) {
    return (
      <div className="min-h-screen page-surface text-foreground">
        <AppHeader title="Compare traces" subtitle="Select a workspace to compare executions." />
      </div>
    );
  }

  return (
    <div className="min-h-screen page-surface text-foreground">
      <AppHeader
        title="Compare traces"
        subtitle="Debug prompt, executor, output, and replay differences from audit-log traces."
        actions={
          <div className="flex flex-wrap gap-2">
            {comparison ? (
              <>
                <Link
                  className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground transition hover:bg-muted/70"
                  href={`/traces/${encodeURIComponent(comparison.left.id)}?org=${encodeURIComponent(activeWorkspaceId)}`}
                >
                  Source trace
                </Link>
                <Link
                  className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground transition hover:bg-muted/70"
                  href={`/traces/${encodeURIComponent(comparison.right.id)}?org=${encodeURIComponent(activeWorkspaceId)}`}
                >
                  Replay trace
                </Link>
              </>
            ) : null}
            <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={runEvaluation} disabled={!comparison || evaluating}>
              {evaluating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
              Run evaluation
            </Button>
          </div>
        }
      />

      <div className="space-y-4 px-4 py-6 md:px-6 xl:px-8">
        {error ? (
          <Card className="rounded-2xl border-red-500/30 bg-red-500/10">
            <CardContent className="p-4 text-sm text-red-700">{error}</CardContent>
          </Card>
        ) : null}

        {loading ? (
          <Card className="rounded-2xl border-border bg-card">
            <CardContent className="flex items-center gap-3 p-6 text-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading trace comparison...
            </CardContent>
          </Card>
        ) : null}

        {!loading && !comparison ? (
          <Card className="rounded-2xl border-border bg-card">
            <CardContent className="p-6 text-sm text-muted-foreground">
              Provide both source and replay trace ids to compare executions.
            </CardContent>
          </Card>
        ) : null}

        {comparison ? (
          <>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
              <TraceIdentity label="Source execution" trace={comparison.left} />
              <div className="hidden items-center justify-center xl:flex">
                <div className="rounded-full border border-border bg-card p-3">
                  <GitCompareArrows className="h-5 w-5 text-primary" />
                </div>
              </div>
              <TraceIdentity label="Replay execution" trace={comparison.right} />
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <SummaryCard
                label="Output"
                value={comparison.summary.outputChanged ? "Changed" : "Same"}
                hint={comparison.summary.outputChanged ? "Replay produced a materially different response" : "Final outputs match after normalization"}
                tone={outputTone}
              />
              <SummaryCard
                label="Latency delta"
                value={formatDelta(comparison.summary.latencyDeltaMs)}
                hint={comparison.summary.latencyDeltaMs <= 0 ? "Replay is faster or equal" : "Replay is slower than source"}
                tone={latencyTone}
              />
              <SummaryCard
                label="Token delta"
                value={comparison.summary.tokenDelta === null ? "Unavailable" : `${comparison.summary.tokenDelta > 0 ? "+" : ""}${comparison.summary.tokenDelta}`}
                hint={comparison.summary.tokenDelta === null ? "Partial gateway observability" : `${totalLeftTokens} -> ${totalRightTokens} tokens`}
              />
              <SummaryCard
                label="Executor"
                value={comparison.summary.executorChanged ? "Changed" : "Same"}
                hint={`${comparison.left.executorType} -> ${comparison.right.executorType}`}
              />
              <SummaryCard
                label="Evaluation"
                value={formatScore(comparison.summary.evaluation?.score)}
                hint={comparison.summary.evaluation?.label ?? "Run evaluation to score replay"}
                tone={evalTone}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <Tabs defaultValue="summary" className="space-y-4">
                <TabsList className="border border-border bg-card">
                  <TabsTrigger value="summary">Summary</TabsTrigger>
                  <TabsTrigger value="prompt">Prompt</TabsTrigger>
                  <TabsTrigger value="input">Input</TabsTrigger>
                  <TabsTrigger value="output">Output</TabsTrigger>
                  <TabsTrigger value="timing">Timing</TabsTrigger>
                  <TabsTrigger value="evaluation">Evaluation</TabsTrigger>
                </TabsList>

                <TabsContent value="summary" className="space-y-3">
                  <Card className="rounded-2xl border-border bg-card">
                    <CardContent className="space-y-2 p-4">
                      {comparison.callouts.map((callout) => (
                        <div key={callout} className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 p-3 text-sm text-foreground">
                          <Sparkles className="mt-0.5 h-4 w-4 text-primary" />
                          <span>{callout}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                  <Card className="rounded-2xl border-border bg-card">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-foreground">Field diffs</CardTitle>
                    </CardHeader>
                    <CardContent className="divide-y divide-border">
                      {comparison.fields.map((field) => (
                        <div key={field.key} className="grid gap-2 py-3 text-sm md:grid-cols-[180px_1fr_1fr_100px]">
                          <div className="text-muted-foreground">{field.label}</div>
                          <div className="font-mono text-foreground">{String(field.left ?? "Unavailable")}</div>
                          <div className="font-mono text-foreground">{String(field.right ?? "Unavailable")}</div>
                          <Badge className={cn("w-fit border", field.changed ? "border-amber-500/30 bg-amber-500/10 text-amber-700" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700")}>
                            {field.changed ? "changed" : "same"}
                          </Badge>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="prompt" className="space-y-3">
                  <SideBySide title="Rendered prompt" left={comparison.left.prompt.renderedPrompt} right={comparison.right.prompt.renderedPrompt} mono />
                  <SideBySide title="Prompt variables" left={JSON.stringify(comparison.left.prompt.variables, null, 2)} right={JSON.stringify(comparison.right.prompt.variables, null, 2)} mono />
                </TabsContent>

                <TabsContent value="input" className="space-y-3">
                  <SideBySide title="User input" left={comparison.left.inputs.userInput} right={comparison.right.inputs.userInput} />
                  <SideBySide title="Runtime input metadata" left={JSON.stringify(comparison.left.inputs, null, 2)} right={JSON.stringify(comparison.right.inputs, null, 2)} mono />
                </TabsContent>

                <TabsContent value="output" className="space-y-3">
                  <SideBySide title="Final delivered output" left={comparison.left.outputs.finalDelivered} right={comparison.right.outputs.finalDelivered} />
                  <SideBySide title="Raw output" left={comparison.left.outputs.rawPrimary} right={comparison.right.outputs.rawPrimary} mono />
                </TabsContent>

                <TabsContent value="timing" className="space-y-3">
                  <Card className="rounded-2xl border-border bg-card">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-foreground">Span timing deltas</CardTitle>
                    </CardHeader>
                    <CardContent className="divide-y divide-border">
                      {timingRows.length ? timingRows.map((row) => (
                        <div key={`${row.type}:${row.service}:${row.name}`} className="grid gap-2 py-3 text-sm md:grid-cols-[1fr_120px_120px_120px]">
                          <div>
                            <div className="text-foreground">{row.name}</div>
                            <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{row.type} / {row.service}</div>
                          </div>
                          <div className="font-mono text-muted-foreground">{row.left === null ? "-" : formatDuration(row.left)}</div>
                          <div className="font-mono text-muted-foreground">{row.right === null ? "-" : formatDuration(row.right)}</div>
                          <div className={cn("font-mono", row.delta !== null && row.delta <= 0 ? "text-emerald-300" : "text-amber-300")}>
                            {row.delta === null ? (row.right === null ? "removed" : "new") : formatDelta(row.delta)}
                          </div>
                        </div>
                      )) : (
                        <div className="py-8 text-sm text-muted-foreground">No comparable spans captured.</div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="evaluation" className="space-y-3">
                  {comparison.summary.evaluation ? (
                    <div className="grid gap-3">
                      {comparison.summary.evaluation.checks.map((check) => (
                        <EvaluationCheck key={check.name} check={check} />
                      ))}
                    </div>
                  ) : (
                    <Card className="rounded-2xl border-border bg-card">
                      <CardContent className="p-6 text-sm text-muted-foreground">
                        No evaluation has been persisted for this replay yet. Run evaluation to attach a rule-based replay score.
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>
              </Tabs>

              <div className="space-y-3 xl:sticky xl:top-4 xl:h-fit">
                <Card className="rounded-2xl border-border bg-card">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm text-foreground">
                      <ShieldAlert className="h-4 w-4 text-primary" />
                      Observability note
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-muted-foreground">
                    <p>
                      Enterprise gateway traces compare using whatever the customer gateway returns. Missing tokens,
                      cost, or model fields are treated as unavailable, not zero.
                    </p>
                    {comparison.right.executorType !== "enterprise_gateway" ? (
                      <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2 text-amber-700">
                        Direct-provider replay is simulated in this repository and may use captured output instead of a live downstream call.
                      </p>
                    ) : null}
                    <div className="rounded-xl border border-border bg-muted/40 p-3">
                      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Replay lineage</div>
                      <div className="mt-1 font-mono text-xs text-primary">
                        {comparison.summary.replayLineage ? formatTraceId(comparison.summary.replayLineage) : "No lineage tag"}
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="rounded-2xl border-border bg-card">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm text-foreground">
                      <BarChart3 className="h-4 w-4 text-primary" />
                      Evaluation summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Score</span>
                      <span className="font-mono text-foreground">{formatScore(comparison.summary.evaluation?.score)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Label</span>
                      <Badge className={cn("border", labelTone(comparison.summary.evaluation?.label ?? "unknown"))}>
                        {comparison.summary.evaluation?.label ?? "not run"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Compared against</span>
                      <span className="font-mono text-xs text-foreground">
                        {comparison.summary.evaluation?.comparedAgainstTraceId
                          ? formatTraceId(comparison.summary.evaluation.comparedAgainstTraceId)
                          : "-"}
                      </span>
                    </div>
                  </CardContent>
                </Card>
                <Card className="rounded-2xl border-border bg-card">
                  <CardContent className="grid gap-2 p-4 text-sm">
                    <div className="flex items-center gap-2 text-foreground">
                      <Timer className="h-4 w-4 text-primary" />
                      {formatDuration(comparison.left.durationMs)} <ArrowRight className="h-3.5 w-3.5" /> {formatDuration(comparison.right.durationMs)}
                    </div>
                    <div className="flex items-center gap-2 text-foreground">
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                      {formatCost(comparison.left.totalCostUsd)} <ArrowRight className="h-3.5 w-3.5" /> {formatCost(comparison.right.totalCostUsd)}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}



