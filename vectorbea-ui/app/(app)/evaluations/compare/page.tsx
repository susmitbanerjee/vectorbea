"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { EvaluationLabLoader } from "@/components/evaluations/evaluation-lab-loader";
import { ProviderIcon } from "@/components/ui/provider-icon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuPanel,
  DropdownMenuPanelRadioItem,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BehavioralEvaluationRunView, TraceSetEvaluationRunView } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

function pct(v: number | null | undefined) {
  return v == null ? null : Math.round(v * 100);
}
function fmtPct(v: number | null | undefined) {
  const p = pct(v);
  return p == null ? "—" : `${p}%`;
}
function delta(a: number | null | undefined, b: number | null | undefined) {
  if (a == null || b == null) return null;
  return a - b;
}
function fmtDelta(d: number | null, unit = "", asPct = false) {
  if (d == null) return "—";
  const abs = Math.abs(asPct ? Math.round(d * 100) : Math.round(d));
  const sign = d > 0 ? "+" : d < 0 ? "−" : "";
  return `${sign}${abs}${unit}`;
}

type ComparableRun = TraceSetEvaluationRunView | BehavioralEvaluationRunView;

type RunSummary = {
  id: string;
  label: string;
  run: ComparableRun;
};

type RunSource = "trace_set" | "behavioral";

function getRunPromptName(run: ComparableRun): string {
  return (run.promptName ?? "Unknown prompt").trim() || "Unknown prompt";
}

function getRunVersionTag(run: ComparableRun): string {
  if ("candidateVersionTag" in run) return run.candidateVersionTag ?? "Unknown version";
  return run.promptVersionTag ?? "Unknown version";
}

function getRunCreatedAt(run: ComparableRun): string {
  return run.createdAt;
}

function getRunAggregate(run: ComparableRun) {
  if ("candidatePromptVersionId" in run) {
    const aggregate = run.aggregate;
    return {
      total: aggregate.total,
      succeeded: aggregate.succeeded,
      failed: aggregate.failed,
      score: aggregate.score,
      confidence: aggregate.confidence,
      criticalFailures: aggregate.criticalFailures,
      averageLatencyDeltaMs: aggregate.averageLatencyDeltaMs,
      recommendation: aggregate.recommendation,
    };
  }
  const aggregate = run.aggregate;
  return {
    total: aggregate.total,
    succeeded: aggregate.passCount,
    failed: aggregate.failCount + aggregate.failed,
    score: aggregate.finalScore,
    confidence: aggregate.averageConfidence,
    criticalFailures: aggregate.hardFailureCount,
    averageLatencyDeltaMs: null as number | null,
    recommendation: aggregate.passed ? "ready_for_rollout" : "needs_review",
  };
}

function getRunProvider(run: ComparableRun): string | null {
  if ("candidatePromptVersionId" in run) return run.results[0]?.provider ?? null;
  return run.provider ?? null;
}

function getRunModel(run: ComparableRun): string | null {
  if ("candidatePromptVersionId" in run) return run.results[0]?.model ?? null;
  return run.model ?? null;
}

function getRunRecommendation(run: ComparableRun): string {
  if ("candidatePromptVersionId" in run) return run.aggregate.recommendation;
  return run.aggregate.passed ? "ready_for_rollout" : "needs_review";
}

function getRunItemRows(run: ComparableRun): Array<{ input: string; score: number | null; pass: boolean | null }> {
  if ("candidatePromptVersionId" in run) {
    return run.results.map((r) => ({
      input: r.inputText?.slice(0, 70) ?? r.sourceTraceId?.slice(0, 18) ?? "—",
      score: r.score,
      pass: r.label === "pass",
    }));
  }
  return run.results.map((r) => ({
    input: r.input?.slice(0, 70) ?? r.datasetItemId?.slice(0, 18) ?? "—",
    score: r.judge?.overallScore ?? null,
    pass: r.judge?.pass ?? null,
  }));
}

function MetricRow({
  label,
  left,
  right,
  deltaVal,
  higherIsBetter = true,
  unit = "",
}: {
  label: string;
  left: string;
  right: string;
  deltaVal: number | null;
  higherIsBetter?: boolean;
  unit?: string;
}) {
  const improved = deltaVal != null && (higherIsBetter ? deltaVal > 0 : deltaVal < 0);
  const regressed = deltaVal != null && (higherIsBetter ? deltaVal < 0 : deltaVal > 0);
  const DeltaIcon = improved ? TrendingUp : regressed ? TrendingDown : null;
  const deltaColor = improved ? "text-emerald-700" : regressed ? "text-red-700" : "text-muted-foreground";

  return (
    <tr className="border-b border-border/40 last:border-0">
      <td className="w-40 py-2.5 pl-4 pr-2 text-xs text-muted-foreground">{label}</td>
      <td className="py-2.5 px-2 text-sm font-medium tabular-nums text-center">{left}</td>
      <td className="py-2.5 px-2 text-sm font-medium tabular-nums text-center">{right}</td>
      <td className={`py-2.5 pl-2 pr-4 text-xs tabular-nums text-right ${deltaColor}`}>
        {DeltaIcon && <DeltaIcon className="inline h-3 w-3 mr-0.5" />}
        {deltaVal != null ? fmtDelta(deltaVal, unit, unit === "%") : "—"}
      </td>
    </tr>
  );
}

function buildRecommendation(left: RunSummary, right: RunSummary): {
  winner: "left" | "right" | "tie" | "inconclusive";
  summary: string;
  reasons: string[];
} {
  const la = getRunAggregate(left.run);
  const ra = getRunAggregate(right.run);

  if (getRunPromptName(left.run) !== getRunPromptName(right.run)) {
    return {
      winner: "inconclusive",
      summary: "Cannot recommend because selected runs belong to different prompts",
      reasons: ["Pick two runs from the same prompt"],
    };
  }

  const leftDataset = left.run.datasetName ?? null;
  const rightDataset = right.run.datasetName ?? null;
  const sameDataset = leftDataset === rightDataset || (!leftDataset && !rightDataset);

  const reasons: string[] = [];
  let leftScore = 0;
  let rightScore = 0;

  if (la.score != null && ra.score != null) {
    const diff = la.score - ra.score;
    if (Math.abs(diff) > 0.02) {
      if (diff > 0) {
        leftScore += 3;
        reasons.push(`${left.label} scored higher (${fmtPct(la.score)} vs ${fmtPct(ra.score)})`);
      } else {
        rightScore += 3;
        reasons.push(`${right.label} scored higher (${fmtPct(ra.score)} vs ${fmtPct(la.score)})`);
      }
    }
  }

  if (la.criticalFailures === 0 && ra.criticalFailures > 0) {
    leftScore += 2;
    reasons.push(`${left.label} had no critical failures`);
  }
  if (ra.criticalFailures === 0 && la.criticalFailures > 0) {
    rightScore += 2;
    reasons.push(`${right.label} had no critical failures`);
  }

  const lPass = la.total > 0 ? la.succeeded / la.total : null;
  const rPass = ra.total > 0 ? ra.succeeded / ra.total : null;
  if (lPass != null && rPass != null && Math.abs(lPass - rPass) > 0.05) {
    if (lPass > rPass) {
      leftScore += 2;
      reasons.push(`${left.label} had higher pass rate`);
    } else {
      rightScore += 2;
      reasons.push(`${right.label} had higher pass rate`);
    }
  }

  if (la.averageLatencyDeltaMs != null && ra.averageLatencyDeltaMs != null) {
    if (la.averageLatencyDeltaMs < ra.averageLatencyDeltaMs - 100) {
      leftScore += 1;
      reasons.push(`${left.label} had lower latency`);
    } else if (ra.averageLatencyDeltaMs < la.averageLatencyDeltaMs - 100) {
      rightScore += 1;
      reasons.push(`${right.label} had lower latency`);
    }
  }

  if (!sameDataset) {
    reasons.push("Different datasets were used, so confidence is lower");
  }

  if (leftScore === rightScore) {
    return { winner: "tie", summary: "Both runs are comparable with no clear winner", reasons };
  }
  const winner = leftScore > rightScore ? "left" : "right";
  const winnerLabel = winner === "left" ? left.label : right.label;
  return { winner, summary: `Recommend ${winnerLabel} for rollout`, reasons };
}

export default function ComparePage() {
  const { activeWorkspaceId } = useWorkspace();

  const [runs, setRuns] = useState<ComparableRun[]>([]);
  const [runSourceById, setRunSourceById] = useState<Record<string, RunSource>>({});
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);

  const [selectedPrompt, setSelectedPrompt] = useState("");
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");

  const [left, setLeft] = useState<ComparableRun | null>(null);
  const [right, setRight] = useState<ComparableRun | null>(null);
  const [loadingLeft, setLoadingLeft] = useState(false);
  const [loadingRight, setLoadingRight] = useState(false);
  const [errorLeft, setErrorLeft] = useState<string | null>(null);
  const [errorRight, setErrorRight] = useState<string | null>(null);

  const promptOptions = useMemo(() => {
    const unique = new Map<string, string>();
    for (const run of runs) {
      const promptLabel = getRunPromptName(run);
      const key = promptLabel.toLowerCase();
      if (!unique.has(key)) unique.set(key, promptLabel);
    }
    return Array.from(unique.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [runs]);

  const promptScopedRuns = useMemo(() => {
    if (!selectedPrompt) return [];
    return runs
      .filter((run) => (getRunPromptName(run).toLowerCase() || "unknown prompt") === selectedPrompt)
      .sort((a, b) => new Date(getRunCreatedAt(b)).getTime() - new Date(getRunCreatedAt(a)).getTime());
  }, [runs, selectedPrompt]);

  const leftRunOptions = promptScopedRuns;
  const rightRunOptions = promptScopedRuns.filter((run) => run.id !== leftId);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const leftFromUrl = params.get("left");
    const rightFromUrl = params.get("right");
    if (leftFromUrl) setLeftId(leftFromUrl);
    if (rightFromUrl) setRightId(rightFromUrl);
  }, []);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    let cancelled = false;
    setRunsLoading(true);
    setRunsError(null);
    Promise.all([
      fetch(`/api/evaluations/trace-sets?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
      fetch(`/api/evaluations/behavioral-runs?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
    ])
      .then(async ([traceRes, behavioralRes]) => {
        const traceJson = await traceRes.json().catch(() => []);
        const behavioralJson = await behavioralRes.json().catch(() => []);
        if (!traceRes.ok) throw new Error(traceJson?.error ?? "Failed to load trace-set runs");
        if (!behavioralRes.ok) throw new Error(behavioralJson?.error ?? "Failed to load behavioral runs");
        const traceItems = Array.isArray(traceJson) ? (traceJson as TraceSetEvaluationRunView[]) : [];
        const behavioralItems = Array.isArray(behavioralJson) ? (behavioralJson as BehavioralEvaluationRunView[]) : [];
        const sourceMap: Record<string, RunSource> = {};
        for (const run of traceItems) sourceMap[run.id] = "trace_set";
        for (const run of behavioralItems) sourceMap[run.id] = "behavioral";
        const items: ComparableRun[] = [...traceItems, ...behavioralItems];
        items.sort((a, b) => new Date(getRunCreatedAt(b)).getTime() - new Date(getRunCreatedAt(a)).getTime());
        return { items, sourceMap };
      })
      .then(({ items, sourceMap }) => {
        if (cancelled) return;
        setRuns(items);
        setRunSourceById(sourceMap);

        const idsFromUrl = new Set([leftId, rightId].filter(Boolean));
        const matched = items.filter((run) => idsFromUrl.has(run.id));
        const promptFromUrl = matched[0] ? getRunPromptName(matched[0]).toLowerCase() : "";
        if (promptFromUrl) {
          setSelectedPrompt(promptFromUrl);
          return;
        }
        if (items.length > 0) {
          setSelectedPrompt(getRunPromptName(items[0]).toLowerCase() || "unknown prompt");
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setRunsError(error instanceof Error ? error.message : "Failed to load evaluation runs");
      })
      .finally(() => {
        if (!cancelled) setRunsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, leftId, rightId]);

  const loadRun = async (id: string, side: "left" | "right") => {
    if (!activeWorkspaceId || !id.trim()) return;
    const setLoading = side === "left" ? setLoadingLeft : setLoadingRight;
    const setError = side === "left" ? setErrorLeft : setErrorRight;
    const setRun = side === "left" ? setLeft : setRight;
    setLoading(true);
    setError(null);
    try {
      const source = runSourceById[id];
      const endpoint =
        source === "behavioral"
          ? `/api/evaluations/behavioral-runs/${encodeURIComponent(id.trim())}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`
          : `/api/evaluations/trace-sets/${encodeURIComponent(id.trim())}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`;
      const res = await fetch(
        endpoint,
        { cache: "no-store" },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load run");
      setRun(json as ComparableRun);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load run");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (leftId) void loadRun(leftId, "left");
    else setLeft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftId, activeWorkspaceId, runSourceById]);

  useEffect(() => {
    if (rightId) void loadRun(rightId, "right");
    else setRight(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightId, activeWorkspaceId, runSourceById]);

  useEffect(() => {
    if (!selectedPrompt) return;
    const promptKeyFor = (run?: ComparableRun) =>
      (run ? getRunPromptName(run).toLowerCase() : "unknown prompt");
    const leftRun = runs.find((run) => run.id === leftId);
    const rightRun = runs.find((run) => run.id === rightId);

    if (leftRun && promptKeyFor(leftRun) !== selectedPrompt) {
      setLeftId("");
      setLeft(null);
      setErrorLeft(null);
    }
    if (rightRun && promptKeyFor(rightRun) !== selectedPrompt) {
      setRightId("");
      setRight(null);
      setErrorRight(null);
    }
  }, [selectedPrompt, runs, leftId, rightId]);

  const ready = left && right;
  const rec = ready
      ? buildRecommendation(
        { id: leftId, label: getRunVersionTag(left), run: left },
        { id: rightId, label: getRunVersionTag(right), run: right },
      )
    : null;

  const la = left ? getRunAggregate(left) : null;
  const ra = right ? getRunAggregate(right) : null;

  return (
    <div className="min-h-screen">
      <AppHeader
        title="Evaluation comparison"
        subtitle="Compare evaluation runs for one prompt and make safer rollout decisions"
      />

      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        <Link
          href={`/evaluations?org=${encodeURIComponent(activeWorkspaceId ?? "")}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to evaluations
        </Link>

        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Prompt</p>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-[#D8CFC2] bg-card px-3 text-sm text-foreground disabled:opacity-60"
                      disabled={runsLoading || promptOptions.length === 0}
                    >
                      <span className="truncate text-left">
                        {promptOptions.find((opt) => opt.value === selectedPrompt)?.label ?? "Select prompt"}
                      </span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
                    <DropdownMenuRadioGroup
                      value={selectedPrompt}
                      onValueChange={(value) => {
                        setSelectedPrompt(value);
                        setLeftId("");
                        setRightId("");
                      }}
                    >
                      {promptOptions.map((option) => (
                        <DropdownMenuPanelRadioItem key={option.value} value={option.value}>
                          {option.label}
                        </DropdownMenuPanelRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuPanel>
                </DropdownMenu>
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Run A</p>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-[#D8CFC2] bg-card px-3 text-sm text-foreground disabled:opacity-60"
                      disabled={!selectedPrompt || leftRunOptions.length === 0}
                    >
                      <span className="truncate text-left">
                        {leftRunOptions.find((run) => run.id === leftId) ? getRunVersionTag(leftRunOptions.find((run) => run.id === leftId) as ComparableRun) : "Select first run"}
                      </span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
                    <DropdownMenuRadioGroup
                      value={leftId}
                      onValueChange={(value) => {
                        setLeftId(value);
                        if (value === rightId) setRightId("");
                      }}
                    >
                      {leftRunOptions.map((run) => (
                        <DropdownMenuPanelRadioItem key={run.id} value={run.id}>
                          {getRunVersionTag(run)} · {new Date(getRunCreatedAt(run)).toLocaleDateString()}
                        </DropdownMenuPanelRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuPanel>
                </DropdownMenu>
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Run B</p>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-[#D8CFC2] bg-card px-3 text-sm text-foreground disabled:opacity-60"
                      disabled={!selectedPrompt || rightRunOptions.length === 0}
                    >
                      <span className="truncate text-left">
                        {rightRunOptions.find((run) => run.id === rightId) ? getRunVersionTag(rightRunOptions.find((run) => run.id === rightId) as ComparableRun) : "Select second run"}
                      </span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
                    <DropdownMenuRadioGroup value={rightId} onValueChange={setRightId}>
                      {rightRunOptions.map((run) => (
                        <DropdownMenuPanelRadioItem key={run.id} value={run.id}>
                          {getRunVersionTag(run)} · {new Date(getRunCreatedAt(run)).toLocaleDateString()}
                        </DropdownMenuPanelRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuPanel>
                </DropdownMenu>
              </div>
            </div>

            {runsError && <p className="text-xs text-red-600">{runsError}</p>}
            <p className="text-xs text-muted-foreground">
              Runs can be compared only within the same prompt to avoid misleading results
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              {([
                { side: "left", run: left, loading: loadingLeft, error: errorLeft },
                { side: "right", run: right, loading: loadingRight, error: errorRight },
              ] as const).map(({ side, run, loading, error }) => (
                <div key={side} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {side === "left" ? "Run A summary" : "Run B summary"}
                  </div>
                  {loading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading run
                    </div>
                  ) : error ? (
                    <p className="text-xs text-red-600">{error}</p>
                  ) : run ? (
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p>
                        <span className="font-medium text-foreground">{getRunPromptName(run)}</span> @ {getRunVersionTag(run)}
                      </p>
                      {run.datasetName && <p>Dataset: {run.datasetName}</p>}
                      {getRunProvider(run) && (
                        <p className="flex items-center gap-1.5">
                          <ProviderIcon providerType={getRunProvider(run) as string} className="h-3.5 w-3.5 shrink-0" />
                          {getRunProvider(run)} / {getRunModel(run) ?? "—"}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Select a run</p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {rec && ready && (
          <Card
            className={
              rec.winner === "left" || rec.winner === "right"
                ? "border-emerald-500/30 bg-emerald-500/5"
                : rec.winner === "tie"
                  ? "border-border"
                  : "border-amber-500/30 bg-amber-500/5"
            }
          >
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                {rec.winner !== "inconclusive" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
                )}
                <span className="text-sm font-semibold">{rec.summary}</span>
              </div>
              <ul className="ml-6 space-y-0.5 text-xs text-muted-foreground">
                {rec.reasons.map((reason, index) => (
                  <li key={index} className="flex items-start gap-1.5">
                    <ChevronRight className="h-3 w-3 mt-0.5 shrink-0" />
                    {reason}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {ready && la && ra && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Metrics comparison
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="w-40 py-2.5 pl-4 pr-2 text-left text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Metric</th>
                      <th className="py-2.5 px-2 text-center text-xs font-semibold text-muted-foreground">
                        {getRunVersionTag(left)}
                        {getRunProvider(left) && (
                          <div className="flex items-center justify-center gap-1 text-[10px] font-normal text-muted-foreground/70 truncate max-w-[140px] mt-0.5">
                            <ProviderIcon providerType={getRunProvider(left) as string} className="h-3 w-3 shrink-0" />
                            {getRunProvider(left)}
                          </div>
                        )}
                      </th>
                      <th className="py-2.5 px-2 text-center text-xs font-semibold text-muted-foreground">
                        {getRunVersionTag(right)}
                        {getRunProvider(right) && (
                          <div className="flex items-center justify-center gap-1 text-[10px] font-normal text-muted-foreground/70 truncate max-w-[140px] mt-0.5">
                            <ProviderIcon providerType={getRunProvider(right) as string} className="h-3 w-3 shrink-0" />
                            {getRunProvider(right)}
                          </div>
                        )}
                      </th>
                      <th className="py-2.5 pl-2 pr-4 text-right text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Delta (A to B)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <MetricRow label="Avg score" left={fmtPct(la.score)} right={fmtPct(ra.score)} deltaVal={delta(ra.score, la.score)} higherIsBetter unit="%" />
                    <MetricRow
                      label="Pass rate"
                      left={la.total > 0 ? `${Math.round((la.succeeded / la.total) * 100)}%` : "—"}
                      right={ra.total > 0 ? `${Math.round((ra.succeeded / ra.total) * 100)}%` : "—"}
                      deltaVal={la.total > 0 && ra.total > 0 ? (ra.succeeded / ra.total) - (la.succeeded / la.total) : null}
                      higherIsBetter
                      unit="%"
                    />
                    <MetricRow label="Confidence" left={fmtPct(la.confidence)} right={fmtPct(ra.confidence)} deltaVal={delta(ra.confidence, la.confidence)} higherIsBetter unit="%" />
                    <MetricRow label="Critical failures" left={String(la.criticalFailures)} right={String(ra.criticalFailures)} deltaVal={ra.criticalFailures - la.criticalFailures} higherIsBetter={false} />
                    <MetricRow label="Failed items" left={String(la.failed)} right={String(ra.failed)} deltaVal={ra.failed - la.failed} higherIsBetter={false} />
                    {(la.averageLatencyDeltaMs != null || ra.averageLatencyDeltaMs != null) && (
                      <MetricRow
                        label="Latency delta"
                        left={la.averageLatencyDeltaMs != null ? `${Math.round(la.averageLatencyDeltaMs)}ms` : "—"}
                        right={ra.averageLatencyDeltaMs != null ? `${Math.round(ra.averageLatencyDeltaMs)}ms` : "—"}
                        deltaVal={delta(ra.averageLatencyDeltaMs, la.averageLatencyDeltaMs)}
                        higherIsBetter={false}
                        unit="ms"
                      />
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {[left, right].map((run, index) => {
                  const recommendation = getRunRecommendation(run);
                  const variant =
                    recommendation === "ready_for_rollout"
                      ? "success"
                      : recommendation === "blocked" || recommendation === "regression_detected"
                        ? "destructive"
                        : "warning";
                  const runId = index === 0 ? leftId : rightId;
                  return (
                    <div key={runId} className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2">
                      <span className="text-xs text-muted-foreground">{getRunVersionTag(run)}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant={variant} className="text-[10px] capitalize">
                          {recommendation?.replaceAll("_", " ") ?? "—"}
                        </Badge>
                        <Link href={`/evaluations/${encodeURIComponent(runId)}?org=${encodeURIComponent(activeWorkspaceId ?? "")}`} className="text-[10px] text-primary hover:underline">
                          Open →
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {ready && getRunItemRows(left).length > 0 && getRunItemRows(right).length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Per-item comparison
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="py-2.5 pl-4 pr-2 text-left font-semibold text-muted-foreground">#</th>
                      <th className="py-2.5 px-2 text-left font-semibold text-muted-foreground">Input</th>
                      <th className="py-2.5 px-2 text-right font-semibold text-muted-foreground">{getRunVersionTag(left)} score</th>
                      <th className="py-2.5 px-2 text-right font-semibold text-muted-foreground">{getRunVersionTag(right)} score</th>
                      <th className="py-2.5 pl-2 pr-4 text-right font-semibold text-muted-foreground">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getRunItemRows(left).slice(0, 50).map((lr, i) => {
                      const rr = getRunItemRows(right)[i];
                      const d = rr && lr.score != null && rr.score != null ? rr.score - lr.score : null;
                      const dColor = d == null ? "" : d > 0.02 ? "text-emerald-700" : d < -0.02 ? "text-red-700" : "text-muted-foreground";
                      return (
                        <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-muted/10">
                          <td className="py-2 pl-4 pr-2 text-muted-foreground">{i + 1}</td>
                          <td className="py-2 px-2 max-w-[220px] truncate text-foreground/80">
                            {lr.input}
                          </td>
                          <td className="py-2 px-2 text-right tabular-nums font-medium">
                            {lr.score != null ? `${Math.round(lr.score * 100)}%` : "—"}
                            {lr.pass === false && <XCircle className="inline h-3 w-3 ml-1 text-red-700" />}
                          </td>
                          <td className="py-2 px-2 text-right tabular-nums font-medium">
                            {rr?.score != null ? `${Math.round(rr.score * 100)}%` : "—"}
                            {rr && rr.pass === false && <XCircle className="inline h-3 w-3 ml-1 text-red-700" />}
                          </td>
                          <td className={`py-2 pl-2 pr-4 text-right tabular-nums font-medium ${dColor}`}>
                            {d != null ? `${d > 0 ? "+" : ""}${Math.round(d * 100)}%` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {getRunItemRows(left).length > 50 && (
                <p className="mt-2 text-[10px] text-muted-foreground text-center">Showing first 50 items.</p>
              )}
            </CardContent>
          </Card>
        )}

        {(runsLoading || loadingLeft || loadingRight) && (
          <EvaluationLabLoader phase={1} message="Loading evaluation runs for comparison" />
        )}

        {!ready && !runsLoading && !loadingLeft && !loadingRight && (
          <p className="text-center text-sm text-muted-foreground py-8">
            Select a prompt and two runs to start comparing
          </p>
        )}
      </div>
    </div>
  );
}
