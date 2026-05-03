"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ChevronRight,
  Clock,
  Loader2,
  PlusCircle,
  Shield,
  Swords,
  Trophy,
  X,
} from "lucide-react";
import type { Route } from "next";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BehavioralEvaluationRunView } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { canUseProviderArena } from "@/lib/behavioral-gate";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreTone(score: number | null) {
  if (score === null) return "text-[#6B7280]";
  if (score >= 80) return "text-[#065F46]";
  if (score >= 60) return "text-[#B45309]";
  return "text-[#991B1B]";
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" });
}

const REC_BADGE: Record<string, string> = {
  safe_to_rollout:      "bg-[#ECFDF5] text-[#065F46]",
  rollout_with_caution: "bg-[#FFFBEB] text-[#92400E]",
  needs_review:         "bg-[#FFFBEB] text-[#92400E]",
  do_not_rollout:       "bg-[#FEF2F2] text-[#991B1B]",
};
const REC_LABEL: Record<string, string> = {
  safe_to_rollout:      "Safe to rollout",
  rollout_with_caution: "Rollout with caution",
  needs_review:         "Needs review",
  do_not_rollout:       "Do not rollout",
};
const REC_ICON: Record<string, React.ElementType> = {
  safe_to_rollout:      Shield,
  rollout_with_caution: AlertTriangle,
  needs_review:         AlertTriangle,
  do_not_rollout:       X,
};

const STATUS_BADGE: Record<string, string> = {
  completed: "bg-[#ECFDF5] text-[#065F46]",
  running:   "bg-[#EFF6FF] text-[#1D4ED8]",
  queued:    "bg-[#F3F4F6] text-[#374151]",
  failed:    "bg-[#FEF2F2] text-[#991B1B]",
  cancelled: "bg-[#F3F4F6] text-[#6B7280]",
};

// ─── Gate banner ──────────────────────────────────────────────────────────────

function GateBanner() {
  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="Provider Comparison"
        subtitle="Compare AI providers on behavioral evidence datasets"
      />
      <div className="px-4 py-12 md:px-6 xl:px-8 flex flex-col items-center text-center max-w-lg mx-auto gap-6">
        <div className="rounded-full bg-[#EFF6FF] p-5">
          <Swords className="h-10 w-10 text-[#2563EB]" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-[#111111] mb-3">Provider Arena is available on Pro</h2>
          <p className="text-sm text-[#6B7280] leading-relaxed">
            Evaluate non-deterministic prompts across multiple providers and models using behavioral datasets and rubrics.
            Choose the safest and best provider for production based on quality, safety, cost, latency, and risk.
          </p>
        </div>
        <div className="w-full rounded-xl border border-[#E7DED1] bg-white p-5 text-left space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">What you get</p>
          {[
            "Multi-provider behavioral evaluation",
            "Decision score and risk score per provider",
            "Provider leaderboard with full metrics",
            "Dimension-level comparison table",
            "Cost and latency comparison",
            "Failure reason clusters",
            "Case-level comparison with drawer",
            "Rollout recommendation card",
          ].map((feature) => (
            <div key={feature} className="flex items-center gap-2 text-sm text-[#374151]">
              <div className="h-4 w-4 rounded-full bg-[#ECFDF5] flex items-center justify-center flex-shrink-0">
                <div className="h-1.5 w-1.5 rounded-full bg-[#065F46]" />
              </div>
              {feature}
            </div>
          ))}
        </div>
        <Link href="/settings/billing" className="rounded-xl bg-[#2563EB] px-6 py-3 text-sm font-semibold text-white hover:bg-[#1D4ED8]">
          Upgrade to Pro
        </Link>
      </div>
    </div>
  );
}

// ─── Run list item ────────────────────────────────────────────────────────────

function RunCard({ run }: { run: BehavioralEvaluationRunView }) {
  const report    = run.arenaReport;
  const recStyle  = report?.rolloutRecommendation ? REC_BADGE[report.rolloutRecommendation] ?? "bg-[#F3F4F6] text-[#374151]" : null;
  const recLabel  = report?.rolloutRecommendation ? REC_LABEL[report.rolloutRecommendation] ?? report.rolloutRecommendation : null;
  const RecIcon   = report?.rolloutRecommendation ? (REC_ICON[report.rolloutRecommendation] ?? Shield) : null;
  const candidates = run.candidates ?? [];
  const winner     = (run.arenaReport?.providerRankings ?? [])[0] as Record<string, unknown> | undefined;

  return (
    <Link href={`/evaluations/runs/${run.id}` as Route} className="block group">
      <div className="rounded-xl border border-[#E7DED1] bg-white p-4 hover:border-[#2563EB] hover:shadow-sm transition-all">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap gap-1.5 mb-1">
              <Badge className={STATUS_BADGE[run.status] ?? "bg-[#F3F4F6] text-[#374151]"}>{run.status}</Badge>
              {recStyle && recLabel && RecIcon && (
                <Badge className={recStyle}>
                  <RecIcon className="h-3 w-3 mr-1" />{recLabel}
                </Badge>
              )}
            </div>
            <p className="font-semibold text-[#111111] text-sm truncate">
              {run.datasetName ?? "Dataset"} · {run.rubricName ?? "Rubric"}
            </p>
            <p className="text-xs text-[#6B7280]">
              {run.promptName ?? "Prompt"} {run.promptVersionTag ?? ""} · {candidates.length} provider{candidates.length !== 1 ? "s" : ""} · {fmtDate(run.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Decision score */}
            {report?.decisionScore != null && (
              <div className="text-right">
                <p className="text-[10px] text-[#6B7280]">Decision</p>
                <p className={`text-lg font-bold ${scoreTone(report.decisionScore)}`}>
                  {Math.round(report.decisionScore)}%
                </p>
              </div>
            )}
            {/* Risk score */}
            {report?.riskScore != null && (
              <div className="text-right">
                <p className="text-[10px] text-[#6B7280]">Risk</p>
                <p className={`text-lg font-bold ${scoreTone(100 - report.riskScore)}`}>
                  {Math.round(report.riskScore)}%
                </p>
              </div>
            )}
            <ChevronRight className="h-4 w-4 text-[#6B7280] group-hover:text-[#2563EB]" />
          </div>
        </div>

        {/* Winner callout */}
        {winner && run.status === "completed" && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-[#E7DED1] bg-[#FBFAF7] px-3 py-1.5 text-xs text-[#374151]">
            <Trophy className="h-3.5 w-3.5 text-[#D97706]" />
            <span className="font-medium">Winner:</span>
            <span>{String(winner.provider ?? "")} / {String(winner.model ?? "")}</span>
            {winner.decision_score != null && (
              <span className={`ml-auto font-semibold ${scoreTone(Number(winner.decision_score))}`}>
                {Math.round(Number(winner.decision_score))}% decision score
              </span>
            )}
          </div>
        )}

        {/* Candidate badges */}
        {candidates.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {candidates.map((c) => (
              <Badge key={c.id} className="bg-[#F3F4F6] text-[#374151] font-normal text-[10px]">
                {c.label || `${c.provider}/${c.model}`}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProviderArenaPage() {
  const { activeWorkspaceId, planTier } = useWorkspace();
  const [runs, setRuns]       = useState<BehavioralEvaluationRunView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/evaluations/provider-arena?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json: BehavioralEvaluationRunView[] | { error?: string }) => {
        if (!cancelled) {
          if (!Array.isArray(json)) {
            setError((json as { error?: string }).error ?? "Failed to load runs");
          } else {
            setRuns(json);
          }
          setLoading(false);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) { setError(e.message); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, [activeWorkspaceId]);

  const activeRuns = useMemo(
    () => runs.filter((run) => run.status === "queued" || run.status === "running"),
    [runs],
  );
  const completedRuns = useMemo(
    () => runs.filter((run) => run.status === "completed"),
    [runs],
  );
  const latestCompleted = completedRuns[0] ?? null;
  const latestLeaderboard = ((latestCompleted?.arenaReport?.providerRankings ?? []) as Array<Record<string, unknown>>).slice(0, 4);
  const leadingCandidate = latestLeaderboard[0] ?? null;

  if (!canUseProviderArena(planTier)) return <GateBanner />;

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="Provider Comparison"
        subtitle="Compare AI providers on behavioral evidence datasets"
      />
      <div className="px-4 py-6 md:px-6 xl:px-8 space-y-5">
        {/* Top action bar */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Swords className="h-5 w-5 text-[#2563EB]" />
            <h2 className="text-base font-semibold text-[#111111]">Arena runs</h2>
            {runs.length > 0 && (
              <Badge className="bg-[#EFF6FF] text-[#1D4ED8]">{runs.length}</Badge>
            )}
          </div>
          <Link href="/evaluations/behavioral" className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]">
            <PlusCircle className="h-4 w-4" />
            Run Provider Arena
          </Link>
        </div>

        {/* Info card */}
        <div className="rounded-xl border border-[#E7DED1] bg-white px-4 py-3 text-sm text-[#374151]">
          <p>
            <span className="font-semibold text-[#111111]">How to start:</span> Open a behavioral dataset, select a rubric and prompt version, switch to <span className="font-medium">Provider Arena</span> mode, add two or more provider candidates, and run.
          </p>
        </div>

        {latestCompleted && (
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-[#D97706]" />
                  <CardTitle className="text-[#111111]">Workspace leader snapshot</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {leadingCandidate ? (
                  <>
                    <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Latest winning candidate</p>
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <div>
                          <p className="text-lg font-bold text-[#111111]">
                            {String(leadingCandidate.provider ?? "")} / {String(leadingCandidate.model ?? "")}
                          </p>
                          <p className="text-xs text-[#6B7280]">
                            From {latestCompleted.datasetName ?? "dataset"} · {fmtDate(latestCompleted.completedAt)}
                          </p>
                        </div>
                        {leadingCandidate.decision_score != null && (
                          <Badge className="bg-[#ECFDF5] text-[#065F46]">
                            {Math.round(Number(leadingCandidate.decision_score))}% decision score
                          </Badge>
                        )}
                        {leadingCandidate.risk_score != null && (
                          <Badge className="bg-[#FFFBEB] text-[#92400E]">
                            {Math.round(Number(leadingCandidate.risk_score))}% risk
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[#EFE7DA] text-xs text-[#6B7280]">
                            <th className="py-2 text-left font-semibold">Rank</th>
                            <th className="py-2 text-left font-semibold">Provider</th>
                            <th className="py-2 text-right font-semibold">Decision</th>
                            <th className="py-2 text-right font-semibold">Pass rate</th>
                            <th className="py-2 text-right font-semibold">P95</th>
                          </tr>
                        </thead>
                        <tbody>
                          {latestLeaderboard.map((row, index) => (
                            <tr key={String(row.provider_candidate_id ?? index)} className="border-b border-[#F1ECE3] last:border-0">
                              <td className="py-2.5 font-medium text-[#111111]">{index + 1}</td>
                              <td className="py-2.5 text-[#374151]">
                                <div className="font-medium text-[#111111]">{String(row.provider ?? "")} / {String(row.model ?? "")}</div>
                                {row.label ? <div className="text-xs text-[#6B7280]">{String(row.label)}</div> : null}
                              </td>
                              <td className={`py-2.5 text-right font-semibold ${scoreTone(row.decision_score != null ? Number(row.decision_score) : null)}`}>
                                {row.decision_score != null ? `${Math.round(Number(row.decision_score))}%` : "—"}
                              </td>
                              <td className="py-2.5 text-right text-[#374151]">
                                {row.pass_rate != null ? `${Math.round(Number(row.pass_rate))}%` : "—"}
                              </td>
                              <td className="py-2.5 text-right text-[#374151]">
                                {row.p95_latency_ms != null ? `${Math.round(Number(row.p95_latency_ms))}ms` : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-[#6B7280]">Complete a Provider Arena run to see the current leading provider and model for this workspace.</p>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <Card className="border-[#E7DED1] bg-white">
                <CardContent className="pt-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Completed arena runs</p>
                  <p className="mt-2 text-3xl font-bold text-[#111111]">{completedRuns.length}</p>
                </CardContent>
              </Card>
              <Card className="border-[#E7DED1] bg-white">
                <CardContent className="pt-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Active arena runs</p>
                  <p className="mt-2 text-3xl font-bold text-[#111111]">{activeRuns.length}</p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error}</div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-[#6B7280]">
            <Loader2 className="h-4 w-4 animate-spin" />Loading arena runs…
          </div>
        )}

        {/* Runs list */}
        {!loading && !error && runs.length === 0 && (
          <Card className="border-[#E7DED1] bg-white">
            <CardContent className="py-16 text-center">
              <Swords className="h-10 w-10 text-[#D8CFC2] mx-auto mb-3" />
              <p className="text-sm font-semibold text-[#374151] mb-1">No Provider Arena runs yet</p>
              <p className="text-xs text-[#6B7280] mb-4">
                Start your first arena run from a behavioral dataset to compare providers side by side.
              </p>
              <Link href="/evaluations/behavioral" className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]">
                <PlusCircle className="h-4 w-4" />Open a behavioral dataset
              </Link>
            </CardContent>
          </Card>
        )}

        {!loading && runs.length > 0 && (
          <div className="space-y-3">
            {/* Active runs first */}
            {activeRuns.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2 flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />Active
                </p>
                {activeRuns.map((r) => <RunCard key={r.id} run={r} />)}
              </div>
            )}

            {/* Completed */}
            {completedRuns.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">Completed</p>
                {completedRuns.map((r) => <RunCard key={r.id} run={r} />)}
              </div>
            )}

            {/* Failed / other */}
            {runs.some((r) => r.status !== "running" && r.status !== "queued" && r.status !== "completed") && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">Other</p>
                {runs
                  .filter((r) => r.status !== "running" && r.status !== "queued" && r.status !== "completed")
                  .map((r) => <RunCard key={r.id} run={r} />)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
