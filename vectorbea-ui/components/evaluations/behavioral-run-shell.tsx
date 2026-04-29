"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";
import type { Route } from "next";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BehavioralEvaluationRunView } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

function scoreTone(score: number | null) {
  if (score === null) return "text-[#6B7280]";
  if (score >= 80) return "text-[#065F46]";
  if (score >= 60) return "text-[#B45309]";
  return "text-[#991B1B]";
}

export function BehavioralRunShell({ runId }: { runId: string }) {
  const { activeWorkspaceId } = useWorkspace();
  const [run, setRun] = useState<BehavioralEvaluationRunView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/evaluations/behavioral-runs/${encodeURIComponent(runId)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
      cache: "no-store",
    })
      .then((response) => response.json())
      .then((json: BehavioralEvaluationRunView & { error?: string }) => {
        if (json.error) throw new Error(json.error);
        setRun(json);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [activeWorkspaceId, runId]);

  const selected = useMemo(() => {
    if (!run || selectedIndex === null) return null;
    return run.results[selectedIndex] ?? null;
  }, [run, selectedIndex]);

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" />Loading run report…</div>;
  }

  if (error || !run) {
    return (
      <div className="min-h-screen bg-[#FBFAF7]">
        <AppHeader title="Evaluation run not found" subtitle="The requested run is unavailable" />
        <div className="px-4 py-8 md:px-6">
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error ?? "Run not found"}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FBFAF7]">
      <AppHeader
        title={run.runType === "provider_arena" ? "Provider Arena Report" : "Behavioral Evaluation Report"}
        subtitle={`${run.promptName ?? "Prompt"} · ${run.promptVersionTag ?? "version"} · ${run.provider}/${run.model}`}
      />
      <div className="px-4 py-6 md:px-6 xl:px-8 space-y-5">
        <Link href={`/evaluations/behavioral/${run.datasetId}` as Route} className="inline-flex items-center gap-1.5 text-xs text-[#6B7280] hover:text-[#2563EB]">
          <ChevronLeft className="h-3.5 w-3.5" />
          Back to behavioral dataset
        </Link>

        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="pb-3">
            <CardTitle className="text-[#111111]">Executive summary</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
              <p className="text-[11px] uppercase tracking-wider text-[#6B7280]">Final score</p>
              <p className={`mt-1 text-2xl font-semibold ${scoreTone(run.aggregate.finalScore)}`}>
                {run.aggregate.finalScore !== null ? `${Math.round(run.aggregate.finalScore)}%` : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
              <p className="text-[11px] uppercase tracking-wider text-[#6B7280]">Pass rate</p>
              <p className="mt-1 text-2xl font-semibold text-[#111111]">
                {run.aggregate.total > 0 ? `${Math.round((run.aggregate.passCount / run.aggregate.total) * 100)}%` : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
              <p className="text-[11px] uppercase tracking-wider text-[#6B7280]">Failed cases</p>
              <p className="mt-1 text-2xl font-semibold text-[#991B1B]">{run.aggregate.failCount}</p>
            </div>
            <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
              <p className="text-[11px] uppercase tracking-wider text-[#6B7280]">Needs review</p>
              <p className="mt-1 text-2xl font-semibold text-[#B45309]">{run.aggregate.needsReviewCount}</p>
            </div>
            <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
              <p className="text-[11px] uppercase tracking-wider text-[#6B7280]">Avg confidence</p>
              <p className="mt-1 text-2xl font-semibold text-[#111111]">
                {run.aggregate.averageConfidence !== null ? `${Math.round(run.aggregate.averageConfidence * 100)}%` : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
              <p className="text-[11px] uppercase tracking-wider text-[#6B7280]">Hard failures</p>
              <p className="mt-1 text-2xl font-semibold text-[#991B1B]">{run.aggregate.hardFailureCount}</p>
            </div>
          </CardContent>
        </Card>

        {run.runType === "provider_arena" && (
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-[#111111]">Case level comparison</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from(new Set(run.results.map((result) => result.datasetItemId))).slice(0, 20).map((datasetItemId) => {
                const grouped = run.results.filter((result) => result.datasetItemId === datasetItemId);
                const baselineInput = grouped[0]?.input ?? "";
                return (
                  <div key={datasetItemId} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1">Input</p>
                    <p className="text-sm text-[#111111] whitespace-pre-wrap">{baselineInput}</p>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {grouped.map((result) => (
                        <div key={result.evaluationExecutionId} className="rounded-lg border border-[#E7DED1] bg-white p-2.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-[#374151]">{result.provider}/{result.model}</span>
                            <span className={scoreTone(result.judge?.overallScore ?? null)}>
                              {result.judge?.overallScore != null ? `${Math.round(result.judge.overallScore)}%` : "—"}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-[#374151] line-clamp-4 whitespace-pre-wrap">{result.output ?? "No output"}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {run.runType === "provider_arena" && run.arenaReport && (
          <>
            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-[#111111]">Recommendation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-4 py-3">
                  <p className="text-sm text-[#374151]">{run.arenaReport.summary ?? "No recommendation summary available"}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <Badge className="bg-[#EFF6FF] text-[#1D4ED8]">{run.arenaReport.rolloutRecommendation}</Badge>
                    <Badge className="bg-[#ECFDF5] text-[#065F46]">Decision {run.arenaReport.decisionScore != null ? `${Math.round(run.arenaReport.decisionScore)}%` : "—"}</Badge>
                    <Badge className="bg-[#FEF2F2] text-[#991B1B]">Risk {run.arenaReport.riskScore != null ? `${Math.round(run.arenaReport.riskScore)}%` : "—"}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-[#111111]">Provider leaderboard</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#EFE7DA] text-xs text-[#6B7280]">
                        <th className="py-2 text-left font-semibold">Rank</th>
                        <th className="py-2 text-left font-semibold">Provider</th>
                        <th className="py-2 text-right font-semibold">Decision score</th>
                        <th className="py-2 text-right font-semibold">Average score</th>
                        <th className="py-2 text-right font-semibold">Win rate</th>
                        <th className="py-2 text-right font-semibold">Pass rate</th>
                        <th className="py-2 text-right font-semibold">Hard fails</th>
                        <th className="py-2 text-right font-semibold">P95 latency</th>
                        <th className="py-2 text-right font-semibold">Estimated cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(run.arenaReport.providerRankings ?? []).map((row) => {
                        const item = row as Record<string, unknown>;
                        return (
                          <tr key={String(item.provider_candidate_id)} className="border-b border-[#F1ECE3] last:border-0">
                            <td className="py-2.5 text-[#111111] font-medium">{String(item.rank ?? "-")}</td>
                            <td className="py-2.5 text-[#374151]">{String(item.provider ?? "")} / {String(item.model ?? "")}</td>
                            <td className="py-2.5 text-right font-medium text-[#111111]">{item.decision_score != null ? `${Math.round(Number(item.decision_score))}%` : "—"}</td>
                            <td className="py-2.5 text-right text-[#374151]">{item.average_score != null ? `${Math.round(Number(item.average_score))}%` : "—"}</td>
                            <td className="py-2.5 text-right text-[#374151]">{item.pairwise_win_rate != null ? `${Math.round(Number(item.pairwise_win_rate))}%` : "—"}</td>
                            <td className="py-2.5 text-right text-[#374151]">{item.pass_rate != null ? `${Math.round(Number(item.pass_rate))}%` : "—"}</td>
                            <td className="py-2.5 text-right text-[#991B1B]">{item.hard_failure_rate != null ? `${Math.round(Number(item.hard_failure_rate))}%` : "—"}</td>
                            <td className="py-2.5 text-right text-[#374151]">{item.p95_latency_ms != null ? `${Math.round(Number(item.p95_latency_ms))}ms` : "—"}</td>
                            <td className="py-2.5 text-right text-[#374151]">{item.estimated_cost_total != null ? Number(item.estimated_cost_total).toFixed(4) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {run.pairwise && (
              <Card className="border-[#E7DED1] bg-white">
                <CardHeader className="pb-2">
                  <CardTitle className="text-[#111111]">Pairwise matrix</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2 text-xs text-[#374151]">
                    <Badge className="bg-[#EEF2FF] text-[#1E3A8A]">Total {run.pairwise.total}</Badge>
                    <Badge className="bg-[#ECFDF5] text-[#065F46]">A wins {run.pairwise.byResult.a_wins}</Badge>
                    <Badge className="bg-[#ECFDF5] text-[#065F46]">B wins {run.pairwise.byResult.b_wins}</Badge>
                    <Badge className="bg-[#FFFBEB] text-[#B45309]">Needs review {run.pairwise.byResult.needs_review}</Badge>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#EFE7DA] text-xs text-[#6B7280]">
                          <th className="py-2 text-left font-semibold">Row candidate</th>
                          <th className="py-2 text-left font-semibold">Col candidate</th>
                          <th className="py-2 text-right font-semibold">Win rate</th>
                          <th className="py-2 text-right font-semibold">Samples</th>
                        </tr>
                      </thead>
                      <tbody>
                        {run.pairwise.matrix.filter((cell) => cell.rowCandidateId !== cell.colCandidateId).map((cell) => (
                          <tr key={`${cell.rowCandidateId}:${cell.colCandidateId}`} className="border-b border-[#F1ECE3] last:border-0">
                            <td className="py-2.5 text-[#374151]">{run.candidates?.find((candidate) => candidate.id === cell.rowCandidateId)?.label ?? cell.rowCandidateId.slice(0, 8)}</td>
                            <td className="py-2.5 text-[#374151]">{run.candidates?.find((candidate) => candidate.id === cell.colCandidateId)?.label ?? cell.colCandidateId.slice(0, 8)}</td>
                            <td className="py-2.5 text-right text-[#111111]">{cell.winRate != null ? `${Math.round(cell.winRate * 100)}%` : "—"}</td>
                            <td className="py-2.5 text-right text-[#6B7280]">{cell.sampleSize}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {run.reviewQueue && (
              <Card className="border-[#E7DED1] bg-white">
                <CardHeader className="pb-2">
                  <CardTitle className="text-[#111111]">Human review queue</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge className="bg-[#EEF2FF] text-[#1E3A8A]">Open {run.reviewQueue.open}</Badge>
                  <Badge className="bg-[#FFFBEB] text-[#B45309]">In review {run.reviewQueue.inReview}</Badge>
                  <Badge className="bg-[#FEF2F2] text-[#991B1B]">Critical open {run.reviewQueue.criticalOpen}</Badge>
                  <Link href="/evaluations/review" className="ml-auto text-[#2563EB] hover:text-[#1D4ED8]">Open queue</Link>
                </CardContent>
              </Card>
            )}
          </>
        )}

        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-[#111111]">Dimension score averages</CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(run.aggregate.dimensionAverages).length === 0 ? (
              <p className="text-sm text-[#6B7280]">No dimension scores available</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#EFE7DA] text-xs text-[#6B7280]">
                      <th className="py-2 text-left font-semibold">Dimension</th>
                      <th className="py-2 text-right font-semibold">Average score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(run.aggregate.dimensionAverages).map(([name, value]) => (
                      <tr key={name} className="border-b border-[#F1ECE3] last:border-0">
                        <td className="py-2.5 text-[#374151]">{name}</td>
                        <td className={`py-2.5 text-right font-medium ${scoreTone(value)}`}>{Math.round(value)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-[#111111]">Case results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#EFE7DA] text-xs text-[#6B7280]">
                    <th className="py-2 text-left font-semibold">Input</th>
                    <th className="py-2 text-right font-semibold">Score</th>
                    <th className="py-2 text-center font-semibold">Pass</th>
                    <th className="py-2 text-right font-semibold">Confidence</th>
                    <th className="py-2 text-right font-semibold">Hard failures</th>
                    <th className="py-2 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {run.results.map((result, index) => (
                    <tr key={result.evaluationExecutionId} className="border-b border-[#F1ECE3] last:border-0">
                      <td className="py-2.5 pr-2 text-[#374151] max-w-[380px] truncate">{result.input}</td>
                      <td className={`py-2.5 text-right font-medium ${scoreTone(result.judge?.overallScore ?? null)}`}>
                        {result.judge?.overallScore !== undefined && result.judge?.overallScore !== null ? `${Math.round(result.judge.overallScore)}%` : "—"}
                      </td>
                      <td className="py-2.5 text-center">
                        <Badge className={result.judge?.pass ? "bg-[#ECFDF5] text-[#065F46]" : "bg-[#FEF2F2] text-[#991B1B]"}>{result.judge?.pass ? "Pass" : "Fail"}</Badge>
                      </td>
                      <td className="py-2.5 text-right text-[#374151]">
                        {result.judge?.confidence !== undefined && result.judge?.confidence !== null ? `${Math.round(result.judge.confidence * 100)}%` : "—"}
                      </td>
                      <td className="py-2.5 text-right text-[#374151]">{result.judge?.hardFailures.length ?? 0}</td>
                      <td className="py-2.5 text-right">
                        <button type="button" onClick={() => setSelectedIndex(index)} className="text-[#2563EB] hover:text-[#1D4ED8]">View details</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {selected && (
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <CardTitle className="text-[#111111]">Case detail</CardTitle>
              <button type="button" className="text-xs text-[#6B7280] hover:text-[#111111]" onClick={() => setSelectedIndex(null)}>Close</button>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1">Input</p>
                <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 whitespace-pre-wrap text-[#111111]">{selected.input}</div>
              </div>
              {!!selected.context && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1">Context</p>
                  <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 whitespace-pre-wrap text-[#111111]">{selected.context}</div>
                </div>
              )}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1">Output</p>
                <div className="rounded-xl border border-[#E7DED1] bg-white px-3 py-2 whitespace-pre-wrap text-[#111111]">{selected.output ?? "No output"}</div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1">Dimension scores</p>
                  <div className="rounded-xl border border-[#E7DED1] bg-white px-3 py-2 space-y-1">
                    {Object.entries(selected.judge?.dimensionScores ?? {}).map(([name, value]) => (
                      <div key={name} className="flex items-center justify-between text-[#374151]">
                        <span>{name}</span>
                        <span className={scoreTone(value)}>{Math.round(value)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1">Hard failures</p>
                  <div className="rounded-xl border border-[#E7DED1] bg-white px-3 py-2 space-y-1">
                    {(selected.judge?.hardFailures.length ?? 0) === 0 ? (
                      <p className="text-[#6B7280]">No hard failures</p>
                    ) : selected.judge?.hardFailures.map((failure, index) => (
                      <div key={`${failure.rule}-${index}`} className="text-[#991B1B]">
                        <p className="font-medium">{failure.rule} · {failure.severity}</p>
                        <p className="text-xs text-[#7F1D1D]">{failure.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1">Judge reasoning</p>
                <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-[#111111]">{selected.judge?.verdictReason ?? "Unavailable"}</div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
