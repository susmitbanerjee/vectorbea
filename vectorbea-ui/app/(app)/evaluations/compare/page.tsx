"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, Loader2, TrendingDown, TrendingUp, XCircle } from "lucide-react";
import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TraceSetEvaluationRunView } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

// ── helpers ───────────────────────────────────────────────────────────────────

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

type RunSummary = {
  id: string;
  label: string;
  run: TraceSetEvaluationRunView;
};

// ── Comparison metric row ─────────────────────────────────────────────────────

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
  const deltaColor = improved ? "text-emerald-400" : regressed ? "text-red-400" : "text-muted-foreground";

  return (
    <tr className="border-b border-border/40 last:border-0">
      <td className="py-2.5 pl-4 pr-2 text-xs text-muted-foreground w-40">{label}</td>
      <td className="py-2.5 px-2 text-sm font-medium tabular-nums text-center">{left}</td>
      <td className="py-2.5 px-2 text-sm font-medium tabular-nums text-center">{right}</td>
      <td className={`py-2.5 pl-2 pr-4 text-xs tabular-nums text-right ${deltaColor}`}>
        {DeltaIcon && <DeltaIcon className="inline h-3 w-3 mr-0.5" />}
        {deltaVal != null ? fmtDelta(deltaVal, unit, unit === "%") : "—"}
      </td>
    </tr>
  );
}

// ── Recommendation engine ─────────────────────────────────────────────────────

function buildRecommendation(left: RunSummary, right: RunSummary): {
  winner: "left" | "right" | "tie" | "inconclusive";
  summary: string;
  reasons: string[];
} {
  const la = left.run.aggregate;
  const ra = right.run.aggregate;

  // Incompatible: different prompts/datasets
  const samePrompt = left.run.promptName === right.run.promptName;
  const sameDataset = left.run.datasetName === right.run.datasetName || (!left.run.datasetName && !right.run.datasetName);

  if (!samePrompt) {
    return { winner: "inconclusive", summary: "Cannot recommend — runs are for different prompts.", reasons: ["Different prompt"] };
  }

  const reasons: string[] = [];
  let leftScore = 0;
  let rightScore = 0;

  // Score
  if (la.score != null && ra.score != null) {
    const diff = la.score - ra.score;
    if (Math.abs(diff) > 0.02) {
      if (diff > 0) { leftScore += 3; reasons.push(`${left.label} scored higher (${fmtPct(la.score)} vs ${fmtPct(ra.score)})`); }
      else { rightScore += 3; reasons.push(`${right.label} scored higher (${fmtPct(ra.score)} vs ${fmtPct(la.score)})`); }
    }
  }

  // Critical failures
  if (la.criticalFailures === 0 && ra.criticalFailures > 0) { leftScore += 2; reasons.push(`${left.label} had no critical failures`); }
  if (ra.criticalFailures === 0 && la.criticalFailures > 0) { rightScore += 2; reasons.push(`${right.label} had no critical failures`); }

  // Pass rate
  const lPass = la.total > 0 ? la.succeeded / la.total : null;
  const rPass = ra.total > 0 ? ra.succeeded / ra.total : null;
  if (lPass != null && rPass != null && Math.abs(lPass - rPass) > 0.05) {
    if (lPass > rPass) { leftScore += 2; reasons.push(`${left.label} had higher pass rate`); }
    else { rightScore += 2; reasons.push(`${right.label} had higher pass rate`); }
  }

  // Latency (lower is better)
  if (la.averageLatencyDeltaMs != null && ra.averageLatencyDeltaMs != null) {
    if (la.averageLatencyDeltaMs < ra.averageLatencyDeltaMs - 100) { leftScore += 1; reasons.push(`${left.label} had lower latency`); }
    else if (ra.averageLatencyDeltaMs < la.averageLatencyDeltaMs - 100) { rightScore += 1; reasons.push(`${right.label} had lower latency`); }
  }

  if (!sameDataset) reasons.push("⚠ Different datasets — comparison confidence is lower");

  if (leftScore === rightScore) return { winner: "tie", summary: "Both runs are comparable — no clear winner.", reasons };
  const winner = leftScore > rightScore ? "left" : "right";
  const winnerLabel = winner === "left" ? left.label : right.label;
  return {
    winner,
    summary: `Recommend ${winnerLabel} for rollout.`,
    reasons,
  };
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ComparePage() {
  const { activeWorkspaceId } = useWorkspace();
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const [left, setLeft] = useState<TraceSetEvaluationRunView | null>(null);
  const [right, setRight] = useState<TraceSetEvaluationRunView | null>(null);
  const [loadingLeft, setLoadingLeft] = useState(false);
  const [loadingRight, setLoadingRight] = useState(false);
  const [errorLeft, setErrorLeft] = useState<string | null>(null);
  const [errorRight, setErrorRight] = useState<string | null>(null);

  // Parse ?left=...&right=... from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const l = params.get("left");
    const r = params.get("right");
    if (l) setLeftId(l);
    if (r) setRightId(r);
  }, []);

  const loadRun = async (id: string, side: "left" | "right") => {
    if (!activeWorkspaceId || !id.trim()) return;
    const setLoading = side === "left" ? setLoadingLeft : setLoadingRight;
    const setError = side === "left" ? setErrorLeft : setErrorRight;
    const setRun = side === "left" ? setLeft : setRight;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/evaluations/trace-sets/${encodeURIComponent(id.trim())}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load run");
      setRun(json as TraceSetEvaluationRunView);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load run");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (leftId) void loadRun(leftId, "left"); }, [leftId, activeWorkspaceId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (rightId) void loadRun(rightId, "right"); }, [rightId, activeWorkspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = left && right;
  const rec = ready
    ? buildRecommendation(
        { id: leftId, label: left.candidateVersionTag ?? "Run A", run: left },
        { id: rightId, label: right.candidateVersionTag ?? "Run B", run: right },
      )
    : null;

  const la = left?.aggregate;
  const ra = right?.aggregate;

  return (
    <div className="min-h-screen">
      <AppHeader
        title="Evaluation comparison"
        subtitle="Compare two evaluation runs side-by-side to inform rollout decisions."
      />

      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        <Link
          href={`/evaluations?org=${encodeURIComponent(activeWorkspaceId ?? "")}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to evaluations
        </Link>

        {/* Run ID inputs */}
        <div className="grid gap-4 sm:grid-cols-2">
          {(["left", "right"] as const).map((side) => {
            const id = side === "left" ? leftId : rightId;
            const setId = side === "left" ? setLeftId : setRightId;
            const run = side === "left" ? left : right;
            const loading = side === "left" ? loadingLeft : loadingRight;
            const err = side === "left" ? errorLeft : errorRight;
            return (
              <Card key={side}>
                <CardContent className="p-4 space-y-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {side === "left" ? "Run A" : "Run B"}
                  </div>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-mono"
                      placeholder="Evaluation run ID…"
                      value={id}
                      onChange={(e) => setId(e.target.value)}
                      onBlur={() => void loadRun(id, side)}
                    />
                    {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground self-center" />}
                  </div>
                  {err && <p className="text-xs text-red-400">{err}</p>}
                  {run && (
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <p><span className="font-medium text-foreground">{run.promptName}</span> @ {run.candidateVersionTag}</p>
                      {run.datasetName && <p>Dataset: {run.datasetName}</p>}
                      <p>{run.results[0]?.provider ?? "—"} / {run.results[0]?.model ?? "—"}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Recommendation */}
        {rec && ready && (
          <Card className={
            rec.winner === "left" || rec.winner === "right"
              ? "border-emerald-500/30 bg-emerald-500/5"
              : rec.winner === "tie"
              ? "border-border"
              : "border-amber-500/30 bg-amber-500/5"
          }>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                {rec.winner !== "inconclusive"
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  : <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                }
                <span className="text-sm font-semibold">{rec.summary}</span>
              </div>
              <ul className="ml-6 space-y-0.5 text-xs text-muted-foreground">
                {rec.reasons.map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <ChevronRight className="h-3 w-3 mt-0.5 shrink-0" />
                    {r}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Metrics comparison table */}
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
                      <th className="py-2.5 pl-4 pr-2 text-left text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground w-40">Metric</th>
                      <th className="py-2.5 px-2 text-center text-xs font-semibold text-muted-foreground">
                        {left.candidateVersionTag ?? "Run A"}
                        <div className="text-[10px] font-normal text-muted-foreground/60 truncate max-w-[120px]">
                          {left.results[0]?.provider ?? "—"}
                        </div>
                      </th>
                      <th className="py-2.5 px-2 text-center text-xs font-semibold text-muted-foreground">
                        {right.candidateVersionTag ?? "Run B"}
                        <div className="text-[10px] font-normal text-muted-foreground/60 truncate max-w-[120px]">
                          {right.results[0]?.provider ?? "—"}
                        </div>
                      </th>
                      <th className="py-2.5 pl-2 pr-4 text-right text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Delta (A→B)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <MetricRow
                      label="Avg score"
                      left={fmtPct(la.score)}
                      right={fmtPct(ra.score)}
                      deltaVal={delta(ra.score, la.score)}
                      higherIsBetter
                      unit="%"
                    />
                    <MetricRow
                      label="Pass rate"
                      left={la.total > 0 ? `${Math.round((la.succeeded / la.total) * 100)}%` : "—"}
                      right={ra.total > 0 ? `${Math.round((ra.succeeded / ra.total) * 100)}%` : "—"}
                      deltaVal={la.total > 0 && ra.total > 0 ? (ra.succeeded / ra.total) - (la.succeeded / la.total) : null}
                      higherIsBetter
                      unit="%"
                    />
                    <MetricRow
                      label="Confidence"
                      left={fmtPct(la.confidence)}
                      right={fmtPct(ra.confidence)}
                      deltaVal={delta(ra.confidence, la.confidence)}
                      higherIsBetter
                      unit="%"
                    />
                    <MetricRow
                      label="Critical failures"
                      left={String(la.criticalFailures)}
                      right={String(ra.criticalFailures)}
                      deltaVal={ra.criticalFailures - la.criticalFailures}
                      higherIsBetter={false}
                    />
                    <MetricRow
                      label="Failed items"
                      left={String(la.failed)}
                      right={String(ra.failed)}
                      deltaVal={ra.failed - la.failed}
                      higherIsBetter={false}
                    />
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

              {/* Recommendations */}
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {([left, right] as const).map((run, i) => {
                  const agg = run.aggregate;
                  const rm = agg.recommendation;
                  const variant = rm === "ready_for_rollout" ? "success" : rm === "blocked" || rm === "regression_detected" ? "destructive" : "warning";
                  return (
                    <div key={i} className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2">
                      <span className="text-xs text-muted-foreground">{i === 0 ? left.candidateVersionTag : right.candidateVersionTag}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant={variant} className="text-[10px] capitalize">{rm?.replaceAll("_", " ") ?? "—"}</Badge>
                        <Link
                          href={`/evaluations/${encodeURIComponent(i === 0 ? leftId : rightId)}?org=${encodeURIComponent(activeWorkspaceId ?? "")}`}
                          className="text-[10px] text-primary hover:underline"
                        >
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

        {/* Per-item comparison */}
        {ready && left.results.length > 0 && right.results.length > 0 && (
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
                      <th className="py-2.5 px-2 text-right font-semibold text-muted-foreground">{left.candidateVersionTag ?? "A"} score</th>
                      <th className="py-2.5 px-2 text-right font-semibold text-muted-foreground">{right.candidateVersionTag ?? "B"} score</th>
                      <th className="py-2.5 pl-2 pr-4 text-right font-semibold text-muted-foreground">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {left.results.slice(0, 50).map((lr, i) => {
                      const rr = right.results[i];
                      const d = rr && lr.score != null && rr.score != null ? rr.score - lr.score : null;
                      const dColor = d == null ? "" : d > 0.02 ? "text-emerald-400" : d < -0.02 ? "text-red-400" : "text-muted-foreground";
                      return (
                        <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-muted/10">
                          <td className="py-2 pl-4 pr-2 text-muted-foreground">{i + 1}</td>
                          <td className="py-2 px-2 max-w-[200px] truncate text-foreground/70">
                            {lr.inputText?.slice(0, 60) ?? lr.sourceTraceId?.slice(0, 16) ?? "—"}
                          </td>
                          <td className="py-2 px-2 text-right tabular-nums font-medium">
                            {lr.score != null ? `${Math.round(lr.score * 100)}%` : "—"}
                            {lr.label !== "pass" && <XCircle className="inline h-3 w-3 ml-1 text-red-400" />}
                          </td>
                          <td className="py-2 px-2 text-right tabular-nums font-medium">
                            {rr?.score != null ? `${Math.round(rr.score * 100)}%` : "—"}
                            {rr && rr.label !== "pass" && <XCircle className="inline h-3 w-3 ml-1 text-red-400" />}
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
              {left.results.length > 50 && (
                <p className="mt-2 text-[10px] text-muted-foreground text-center">Showing first 50 items.</p>
              )}
            </CardContent>
          </Card>
        )}

        {!ready && !loadingLeft && !loadingRight && (
          <p className="text-center text-sm text-muted-foreground py-8">
            Enter two evaluation run IDs above to start comparing.
          </p>
        )}
      </div>
    </div>
  );
}
