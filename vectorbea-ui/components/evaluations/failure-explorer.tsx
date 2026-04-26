"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Lightbulb, XCircle, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FailureCluster, TraceSetEvaluationRunView } from "@/lib/api";

type Result = TraceSetEvaluationRunView["results"][number];

// ── Analysis ─────────────────────────────────────────────────────────────────

function analyzeFailures(results: Result[]): FailureCluster[] {
  if (results.length === 0) return [];

  // Index every result as failed/passing
  const byIdx = results.map((r, i) => ({ r, i }));
  const failed = byIdx.filter(
    ({ r }) =>
      r.label !== "pass" ||
      r.recommendation === "regression_detected" ||
      r.recommendation === "blocked",
  );

  if (failed.length === 0) return [];

  const clusters: FailureCluster[] = [];

  // ── Cluster 1: Provider / execution errors ──────────────────────────────────
  const execErrors = failed.filter(
    ({ r }) => r.status === "error" || !r.actualOutput?.trim(),
  );
  if (execErrors.length > 0) {
    const errorMessages = execErrors
      .map(({ r }) => r.error)
      .filter(Boolean)
      .slice(0, 2);
    clusters.push({
      id: "exec_error",
      name: "Provider execution failures",
      severity: "critical",
      count: execErrors.length,
      affectedIndices: execErrors.map(({ i }) => i),
      explanation:
        `${execErrors.length} item(s) received no output from the model.` +
        (errorMessages.length > 0 ? ` Error: "${errorMessages[0]}"` : ""),
      suggestedFix:
        "Check provider API key, model availability, and rate limits. Review the Execution tab in Evidence for the specific error.",
    });
  }

  const execErrorIndices = new Set(execErrors.map(({ i }) => i));

  // ── Cluster 2: Critical check failures ─────────────────────────────────────
  const critFailed = failed.filter(
    ({ r, i }) => !execErrorIndices.has(i) && (r.criticalFailures ?? 0) > 0,
  );
  if (critFailed.length > 0) {
    // Find the most common critical check that's failing
    const checkCounts: Record<string, number> = {};
    for (const { r } of critFailed) {
      for (const c of r.checks ?? []) {
        if (c.critical && c.status === "fail") {
          checkCounts[c.name] = (checkCounts[c.name] ?? 0) + 1;
        }
      }
    }
    const topCheck = Object.entries(checkCounts).sort((a, b) => b[1] - a[1])[0];
    const topName = topCheck ? topCheck[0].replaceAll("_", " ") : "unknown check";

    clusters.push({
      id: "critical_check",
      name: `Critical check failures — "${topName}"`,
      severity: "critical",
      count: critFailed.length,
      affectedIndices: critFailed.map(({ i }) => i),
      explanation:
        `${critFailed.length} item(s) failed a critical evaluation check. ` +
        (topCheck ? `Most common: "${topName}" (${topCheck[1]} cases).` : ""),
      suggestedFix:
        "Critical failures block promotion. Open Evidence → Scoring for each item to see the exact check that failed and why.",
    });
  }

  // ── Cluster 3: Output divergence from expected ──────────────────────────────
  const withExpected = failed.filter(
    ({ r, i }) =>
      !execErrorIndices.has(i) &&
      r.actualOutput?.trim() &&
      (r.expectedOutput?.trim() || r.referenceOutput?.trim()) &&
      (r.similarityScore ?? 1) < 0.55,
  );
  if (withExpected.length > 0) {
    const avgSim =
      withExpected.reduce((s, { r }) => s + (r.similarityScore ?? 0), 0) /
      withExpected.length;
    clusters.push({
      id: "low_similarity",
      name: "Output diverges from expected",
      severity: avgSim < 0.3 ? "critical" : "high",
      count: withExpected.length,
      affectedIndices: withExpected.map(({ i }) => i),
      explanation: `${withExpected.length} item(s) produced output that differs significantly from the expected/reference output (avg similarity ${Math.round(avgSim * 100)}%).`,
      suggestedFix:
        "Open Evidence → Output to compare side by side. Check if the candidate version weakened or removed a key instruction that constrains the format or content.",
    });
  }

  // ── Cluster 4: Safety violations ───────────────────────────────────────────
  const safetyFailed = failed.filter(
    ({ r, i }) =>
      !execErrorIndices.has(i) &&
      (r.checks ?? []).some(
        (c) => c.category === "safety" && c.status === "fail",
      ),
  );
  if (safetyFailed.length > 0) {
    clusters.push({
      id: "safety",
      name: "Safety check violations",
      severity: "critical",
      count: safetyFailed.length,
      affectedIndices: safetyFailed.map(({ i }) => i),
      explanation: `${safetyFailed.length} item(s) failed safety evaluation checks. These cases likely involve refusals, harmful content, or policy violations.`,
      suggestedFix:
        "Review the specific safety check failure in Evidence → Scoring. Update the prompt to include explicit safety constraints or refusal handling.",
    });
  }

  // ── Cluster 5: Regression — was passing, now failing ───────────────────────
  const regressions = failed.filter(
    ({ r, i }) =>
      !execErrorIndices.has(i) &&
      (r.recommendation === "regression_detected" || r.recommendation === "blocked"),
  );
  // Subtract items already captured in critFailed to avoid double-counting
  const critIndices = new Set(critFailed.map(({ i }) => i));
  const pureRegressions = regressions.filter(({ i }) => !critIndices.has(i));
  if (pureRegressions.length > 0) {
    clusters.push({
      id: "regression",
      name: "Regression detected",
      severity: "high",
      count: pureRegressions.length,
      affectedIndices: pureRegressions.map(({ i }) => i),
      explanation: `${pureRegressions.length} item(s) are marked as regressions. The candidate version performs worse than the baseline on these inputs.`,
      suggestedFix:
        "Compare the candidate template diff against these specific inputs. Look for removed constraints, changed tone, or narrowed instruction scope.",
    });
  }

  // ── Cluster 6: Score near threshold (warnings) ─────────────────────────────
  const nearThreshold = byIdx.filter(
    ({ r, i }) =>
      !execErrorIndices.has(i) &&
      r.score != null &&
      r.score >= 0.45 &&
      r.score < 0.70 &&
      r.label !== "pass",
  );
  if (nearThreshold.length >= 2) {
    clusters.push({
      id: "near_threshold",
      name: "Borderline scores — near pass/fail boundary",
      severity: "medium",
      count: nearThreshold.length,
      affectedIndices: nearThreshold.map(({ i }) => i),
      explanation: `${nearThreshold.length} item(s) scored between 45–70% — below the pass threshold but not catastrophic. Small prompt tweaks could recover them.`,
      suggestedFix:
        "These cases are closest to passing. Review the specific expected vs actual output in Evidence and identify the narrowest improvement needed.",
    });
  }

  // Sort: critical first, then high, medium
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2 };
  return clusters.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
}

// ── Category scoring breakdown ────────────────────────────────────────────────

export function CategoryBreakdown({ results }: { results: Result[] }) {
  const categories = useMemo(() => {
    const map: Record<string, { total: number; passed: number; weight: number }> = {};
    for (const r of results) {
      for (const c of r.checks ?? []) {
        const cat = c.category ?? "other";
        if (!map[cat]) map[cat] = { total: 0, passed: 0, weight: 0 };
        map[cat].total += 1;
        map[cat].weight += c.weight ?? 1;
        if (c.status === "pass") map[cat].passed += 1;
      }
    }
    return Object.entries(map)
      .map(([name, v]) => ({ name, ...v, rate: v.total > 0 ? v.passed / v.total : null }))
      .sort((a, b) => (a.rate ?? 1) - (b.rate ?? 1)); // worst first
  }, [results]);

  if (categories.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Category breakdown
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((cat) => {
          const pct = cat.rate != null ? Math.round(cat.rate * 100) : null;
          const color =
            pct == null ? "text-muted-foreground" : pct >= 78 ? "text-emerald-400" : pct >= 50 ? "text-amber-400" : "text-red-400";
          const barColor =
            pct == null ? "bg-muted/40" : pct >= 78 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500";
          return (
            <div key={cat.name} className="rounded-lg border border-border bg-card px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="capitalize font-medium">{cat.name.replaceAll("_", " ")}</span>
                <span className={`tabular-nums font-bold ${color}`}>
                  {pct != null ? `${pct}%` : "—"}
                </span>
              </div>
              <div className="h-1 w-full rounded-full bg-muted/40 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                  style={{ width: `${pct ?? 0}%` }}
                />
              </div>
              <div className="text-[10px] text-muted-foreground tabular-nums">
                {cat.passed}/{cat.total} checks
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Failure Explorer card ─────────────────────────────────────────────────────

interface FailureExplorerProps {
  results: TraceSetEvaluationRunView["results"];
  onSelectItem?: (idx: number) => void;
}

export function FailureExplorer({ results, onSelectItem }: FailureExplorerProps) {
  const clusters = useMemo(() => analyzeFailures(results), [results]);
  const [expanded, setExpanded] = useState<string | null>(clusters[0]?.id ?? null);

  if (clusters.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-5 text-sm text-emerald-400">
          <Zap className="h-4 w-4 shrink-0" />
          No failure patterns detected — all items passed evaluation.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          Failure Explorer
          <Badge variant="destructive" className="ml-1 text-[10px] normal-case tracking-normal">
            {clusters.length} pattern{clusters.length !== 1 ? "s" : ""}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {clusters.map((cluster) => {
          const isOpen = expanded === cluster.id;
          const severityColor =
            cluster.severity === "critical"
              ? "border-red-500/30 bg-red-500/5"
              : cluster.severity === "high"
              ? "border-amber-500/30 bg-amber-500/5"
              : "border-border/60 bg-muted/5";
          const badgeVariant =
            cluster.severity === "critical"
              ? "destructive"
              : cluster.severity === "high"
              ? "warning"
              : "secondary";

          return (
            <div
              key={cluster.id}
              className={`rounded-xl border overflow-hidden transition-colors ${severityColor}`}
            >
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : cluster.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Badge variant={badgeVariant} className="shrink-0 text-[10px] capitalize">
                    {cluster.severity}
                  </Badge>
                  <span className="text-sm font-medium truncate">{cluster.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {cluster.count} case{cluster.count !== 1 ? "s" : ""}
                  </span>
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-inherit px-4 py-3 space-y-3">
                  <p className="text-sm text-foreground/80">{cluster.explanation}</p>

                  <div className="flex items-start gap-2 rounded-lg border border-blue-500/25 bg-blue-500/8 px-3 py-2">
                    <Lightbulb className="h-3.5 w-3.5 mt-0.5 shrink-0 text-blue-400" />
                    <p className="text-xs text-blue-200">{cluster.suggestedFix}</p>
                  </div>

                  {cluster.affectedIndices.length > 0 && onSelectItem && (
                    <div className="space-y-1">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                        Affected items
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {cluster.affectedIndices.slice(0, 12).map((idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => onSelectItem(idx)}
                            className="rounded-md border border-border px-2 py-0.5 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                          >
                            #{idx + 1}
                          </button>
                        ))}
                        {cluster.affectedIndices.length > 12 && (
                          <span className="text-[10px] text-muted-foreground self-center">
                            +{cluster.affectedIndices.length - 12} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <p className="text-[10px] text-muted-foreground pt-1">
          Patterns are derived automatically from evaluation check results. Click an item number to open its evidence.
        </p>
      </CardContent>
    </Card>
  );
}
