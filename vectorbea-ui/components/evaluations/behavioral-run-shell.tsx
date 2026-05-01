"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Award,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  Loader2,
  Shield,
  Swords,
  Trophy,
  X,
  Zap,
} from "lucide-react";
import type { Route } from "next";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { BehavioralEvaluationCaseResult, BehavioralEvaluationRunView } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { canUseProviderArena } from "@/lib/behavioral-gate";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreTone(score: number | null): string {
  if (score === null) return "text-[#6B7280]";
  if (score >= 80) return "text-[#065F46]";
  if (score >= 60) return "text-[#B45309]";
  return "text-[#991B1B]";
}

function scoreBg(score: number | null): string {
  if (score === null) return "bg-[#F3F4F6] text-[#6B7280]";
  if (score >= 80) return "bg-[#ECFDF5] text-[#065F46]";
  if (score >= 60) return "bg-[#FFFBEB] text-[#B45309]";
  return "bg-[#FEF2F2] text-[#991B1B]";
}

function pct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(digits)}%`;
}

function ms(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value)}ms`;
}

function cost(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value < 0.0001) return "<$0.0001";
  return `$${value.toFixed(4)}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

type Ranking = Record<string, unknown>;

// ─── Recommendation styles ─────────────────────────────────────────────────

const RECOMMENDATION_STYLES: Record<string, { bg: string; border: string; badge: string; label: string; icon: React.ElementType }> = {
  safe_to_rollout:    { bg: "bg-[#ECFDF5]", border: "border-[#A7F3D0]", badge: "bg-[#ECFDF5] text-[#065F46]", label: "Safe to rollout",     icon: Shield },
  rollout_with_caution: { bg: "bg-[#FFFBEB]", border: "border-[#FDE68A]", badge: "bg-[#FFFBEB] text-[#92400E]", label: "Rollout with caution", icon: AlertTriangle },
  needs_review:       { bg: "bg-[#FFFBEB]", border: "border-[#FDE68A]", badge: "bg-[#FFFBEB] text-[#92400E]", label: "Needs review",          icon: AlertTriangle },
  do_not_rollout:     { bg: "bg-[#FEF2F2]", border: "border-[#FECACA]", badge: "bg-[#FEF2F2] text-[#991B1B]", label: "Do not rollout",        icon: X },
};

// ─── Polling hook ──────────────────────────────────────────────────────────

const ACTIVE = new Set(["queued", "running"]);

function useArenaRun(runId: string) {
  const { activeWorkspaceId } = useWorkspace();
  const [run, setRun]     = useState<BehavioralEvaluationRunView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    let cancelled = false;

    async function fetchRun() {
      try {
        const res  = await fetch(
          `/api/evaluations/behavioral-runs/${encodeURIComponent(runId)}?workspaceId=${encodeURIComponent(activeWorkspaceId!)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as BehavioralEvaluationRunView & { error?: string };
        if (cancelled) return;
        if (json.error) { setError(json.error); setLoading(false); return; }
        setRun(json);
        setLoading(false);
        if (ACTIVE.has(json.status)) {
          timerRef.current = setTimeout(fetchRun, 5_000);
        }
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error ? e.message : "Failed to load run"); setLoading(false); }
      }
    }

    setLoading(true);
    setError(null);
    void fetchRun();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [activeWorkspaceId, runId]);

  return { run, loading, error };
}

// ─── Feature gate banner ───────────────────────────────────────────────────

function ProviderArenaGateBanner() {
  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Provider Arena" subtitle="Pro feature" />
      <div className="px-4 py-12 md:px-6 xl:px-8 flex flex-col items-center text-center max-w-lg mx-auto gap-6">
        <div className="rounded-full bg-[#EFF6FF] p-4">
          <Swords className="h-8 w-8 text-[#2563EB]" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-[#111111] mb-2">Provider Arena is available on Pro</h2>
          <p className="text-sm text-[#6B7280] leading-relaxed">
            Compare providers on behavioral datasets and choose the safest model for production.
            Evaluate quality, safety, cost, latency, and risk across multiple providers simultaneously.
          </p>
        </div>
        <Link href="/settings/billing" className="rounded-xl bg-[#2563EB] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1D4ED8]">
          Upgrade to Pro
        </Link>
      </div>
    </div>
  );
}

// ─── Loading panel for running arena ──────────────────────────────────────

function ArenaRunningPanel({ run }: { run: BehavioralEvaluationRunView }) {
  const candidates = run.candidates ?? [];
  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Provider Arena" subtitle="Running…" />
      <div className="px-4 py-8 md:px-6 xl:px-8 space-y-5 max-w-2xl mx-auto">
        <Link href="/evaluations/provider-arena" className="inline-flex items-center gap-1.5 text-xs text-[#6B7280] hover:text-[#2563EB]">
          <ChevronLeft className="h-3.5 w-3.5" /> Back to Provider Arena
        </Link>
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-[#2563EB]" />
              <CardTitle className="text-[#111111]">Arena evaluation running</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-[#6B7280]">
              Executing {run.datasetName ?? "dataset"} against {candidates.length} provider{candidates.length !== 1 ? "s" : ""}.
              This page will refresh automatically when complete.
            </p>
            <div className="space-y-2">
              {[
                { label: "Rendering prompt templates", done: true },
                { label: `Calling ${candidates.length} provider${candidates.length !== 1 ? "s" : ""}`, done: true },
                { label: "Judging outputs with rubric", done: false },
                { label: "Computing decision scores", done: false },
                { label: "Generating arena report", done: false },
              ].map((step) => (
                <div key={step.label} className="flex items-center gap-2.5 text-sm">
                  {step.done ? (
                    <div className="h-4 w-4 rounded-full bg-[#ECFDF5] flex items-center justify-center">
                      <div className="h-1.5 w-1.5 rounded-full bg-[#065F46]" />
                    </div>
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin text-[#2563EB]" />
                  )}
                  <span className={step.done ? "text-[#6B7280]" : "text-[#111111]"}>{step.label}</span>
                </div>
              ))}
            </div>
            {candidates.length > 0 && (
              <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">Candidates</p>
                <div className="flex flex-wrap gap-2">
                  {candidates.map((c) => (
                    <Badge key={c.id} className="bg-[#EFF6FF] text-[#1D4ED8] font-medium">
                      {c.label || `${c.provider}/${c.model}`}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Case drawer ──────────────────────────────────────────────────────────

function CaseDrawer({
  open,
  onClose,
  datasetItemId,
  results,
  candidates,
}: {
  open: boolean;
  onClose: () => void;
  datasetItemId: string | null;
  results: BehavioralEvaluationCaseResult[];
  candidates: BehavioralEvaluationRunView["candidates"];
}) {
  const grouped = useMemo(() => {
    if (!datasetItemId) return [];
    return results.filter((r) => r.datasetItemId === datasetItemId);
  }, [datasetItemId, results]);

  const baseInput = grouped[0]?.input ?? "";
  const baseContext = grouped[0]?.context ?? null;

  // Find best provider (highest score)
  const best = useMemo(() => {
    let topScore = -1;
    let topProvider = "";
    for (const r of grouped) {
      const s = r.judge?.overallScore ?? -1;
      if (s > topScore) { topScore = s; topProvider = `${r.provider}/${r.model}`; }
    }
    return topProvider;
  }, [grouped]);

  const labelFor = (r: BehavioralEvaluationCaseResult) => {
    const found = candidates?.find((c) => c.provider === r.provider && c.model === r.model);
    return found?.label || `${r.provider}/${r.model}`;
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto border-[#E7DED1] bg-white">
        <DialogHeader>
          <DialogTitle className="text-[#111111]">Case comparison</DialogTitle>
          <DialogDescription className="text-[#6B7280]">
            All provider outputs for this dataset item
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 text-sm">
          {/* Input/context */}
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Input</p>
            <div className="whitespace-pre-wrap rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-[#111111]">{baseInput}</div>
          </div>
          {baseContext && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Context</p>
              <div className="whitespace-pre-wrap rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-[#111111]">{baseContext}</div>
            </div>
          )}
          {best && (
            <div className="rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-2 flex items-center gap-2">
              <Trophy className="h-3.5 w-3.5 text-[#065F46]" />
              <span className="text-xs font-semibold text-[#065F46]">Best provider: {best}</span>
            </div>
          )}
          {/* Provider outputs */}
          <div className="grid gap-4 md:grid-cols-2">
            {grouped.map((r) => {
              const isWinner = `${r.provider}/${r.model}` === best;
              return (
                <div
                  key={r.evaluationExecutionId}
                  className={`rounded-xl border p-3 space-y-2 ${isWinner ? "border-[#A7F3D0] bg-[#F0FDF4]" : "border-[#E7DED1] bg-white"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      {isWinner && <Trophy className="h-3.5 w-3.5 text-[#065F46]" />}
                      <span className="text-xs font-bold text-[#111111]">{labelFor(r)}</span>
                    </div>
                    <span className={`text-xs font-semibold ${scoreTone(r.judge?.overallScore ?? null)}`}>
                      {r.judge?.overallScore != null ? `${Math.round(r.judge.overallScore)}%` : "—"}
                    </span>
                  </div>
                  {/* Scores row */}
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <span className={`rounded px-1.5 py-0.5 font-medium ${r.judge?.pass ? "bg-[#ECFDF5] text-[#065F46]" : "bg-[#FEF2F2] text-[#991B1B]"}`}>
                      {r.judge?.pass ? "Pass" : "Fail"}
                    </span>
                    {r.judge?.confidence != null && (
                      <span className="rounded bg-[#F3F4F6] text-[#374151] px-1.5 py-0.5">
                        Conf {Math.round(r.judge.confidence * 100)}%
                      </span>
                    )}
                    {r.latencyMs != null && (
                      <span className="rounded bg-[#F3F4F6] text-[#374151] px-1.5 py-0.5">
                        {Math.round(r.latencyMs)}ms
                      </span>
                    )}
                  </div>
                  {/* Output */}
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[#6B7280] mb-0.5">Output</p>
                    <div className="text-xs text-[#374151] bg-[#FBFAF7] rounded-lg p-2 whitespace-pre-wrap max-h-32 overflow-y-auto">
                      {r.output ?? "No output"}
                    </div>
                  </div>
                  {/* Dimension scores */}
                  {Object.keys(r.judge?.dimensionScores ?? {}).length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[#6B7280] mb-0.5">Dimensions</p>
                      <div className="space-y-0.5">
                        {Object.entries(r.judge!.dimensionScores).map(([name, val]) => (
                          <div key={name} className="flex justify-between text-xs text-[#374151]">
                            <span className="truncate">{name}</span>
                            <span className={`font-medium ml-2 ${scoreTone(val)}`}>{Math.round(val)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Hard failures */}
                  {(r.judge?.hardFailures.length ?? 0) > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[#991B1B] mb-0.5">Hard failures</p>
                      {r.judge!.hardFailures.map((f, i) => (
                        <div key={`${f.rule}-${i}`} className="text-xs text-[#991B1B]">
                          {f.rule} · {f.severity}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Strengths / weaknesses */}
                  {(r.judge?.strengths?.length ?? 0) > 0 && (
                    <div className="text-xs text-[#065F46]">✓ {r.judge!.strengths.slice(0, 2).join("; ")}</div>
                  )}
                  {(r.judge?.weaknesses?.length ?? 0) > 0 && (
                    <div className="text-xs text-[#B45309]">⚠ {r.judge!.weaknesses.slice(0, 2).join("; ")}</div>
                  )}
                  {/* Risk flags */}
                  {(r.judge?.riskFlags?.length ?? 0) > 0 && (
                    <div className="text-xs text-[#991B1B]">🚩 {r.judge!.riskFlags.slice(0, 2).join("; ")}</div>
                  )}
                  {/* Judge reasoning */}
                  {r.judge?.verdictReason && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[#6B7280] mb-0.5">Judge reasoning</p>
                      <p className="text-xs text-[#6B7280] italic">{r.judge.verdictReason}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Standard behavioral run view ────────────────────────────────────────

function StandardRunView({ run }: { run: BehavioralEvaluationRunView }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selected = selectedIndex !== null ? run.results[selectedIndex] ?? null : null;

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="Behavioral Evaluation Report"
        subtitle={`${run.promptName ?? "Prompt"} · ${run.promptVersionTag ?? "version"}`}
      />
      <div className="px-4 py-6 md:px-6 xl:px-8 space-y-5">
        <Link href={`/evaluations/behavioral/${run.datasetId}` as Route} className="inline-flex items-center gap-1.5 text-xs text-[#6B7280] hover:text-[#2563EB]">
          <ChevronLeft className="h-3.5 w-3.5" />Back to behavioral dataset
        </Link>
        {/* Summary */}
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="pb-3"><CardTitle className="text-[#111111]">Summary</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {[
              { label: "Final score",    value: run.aggregate.finalScore !== null ? `${Math.round(run.aggregate.finalScore)}%` : "—", cls: scoreTone(run.aggregate.finalScore) },
              { label: "Pass rate",      value: run.aggregate.total > 0 ? `${Math.round((run.aggregate.passCount / run.aggregate.total) * 100)}%` : "—", cls: "text-[#111111]" },
              { label: "Failed cases",   value: String(run.aggregate.failCount), cls: "text-[#991B1B]" },
              { label: "Needs review",   value: String(run.aggregate.needsReviewCount), cls: "text-[#B45309]" },
              { label: "Avg confidence", value: run.aggregate.averageConfidence !== null ? `${Math.round(run.aggregate.averageConfidence * 100)}%` : "—", cls: "text-[#111111]" },
              { label: "Hard failures",  value: String(run.aggregate.hardFailureCount), cls: "text-[#991B1B]" },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
                <p className="text-[11px] uppercase tracking-wider text-[#6B7280]">{stat.label}</p>
                <p className={`mt-1 text-2xl font-semibold ${stat.cls}`}>{stat.value}</p>
              </div>
            ))}
          </CardContent>
        </Card>
        {/* Case results */}
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="pb-2"><CardTitle className="text-[#111111]">Case results</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#EFE7DA] text-xs text-[#6B7280]">
                    <th className="py-2 text-left font-semibold">Input</th>
                    <th className="py-2 text-right font-semibold">Score</th>
                    <th className="py-2 text-center font-semibold">Pass</th>
                    <th className="py-2 text-right font-semibold">Confidence</th>
                    <th className="py-2 text-right font-semibold">Hard fails</th>
                    <th className="py-2 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {run.results.map((r, i) => (
                    <tr key={r.evaluationExecutionId} className="border-b border-[#F1ECE3] last:border-0">
                      <td className="py-2.5 pr-2 text-[#374151] max-w-[380px] truncate">{r.input}</td>
                      <td className={`py-2.5 text-right font-medium ${scoreTone(r.judge?.overallScore ?? null)}`}>
                        {r.judge?.overallScore != null ? `${Math.round(r.judge.overallScore)}%` : "—"}
                      </td>
                      <td className="py-2.5 text-center">
                        <Badge className={r.judge?.pass ? "bg-[#ECFDF5] text-[#065F46]" : "bg-[#FEF2F2] text-[#991B1B]"}>
                          {r.judge?.pass ? "Pass" : "Fail"}
                        </Badge>
                      </td>
                      <td className="py-2.5 text-right text-[#374151]">
                        {r.judge?.confidence != null ? `${Math.round(r.judge.confidence * 100)}%` : "—"}
                      </td>
                      <td className="py-2.5 text-right text-[#374151]">{r.judge?.hardFailures.length ?? 0}</td>
                      <td className="py-2.5 text-right">
                        <button type="button" onClick={() => setSelectedIndex(i)} className="text-[#2563EB] hover:text-[#1D4ED8] text-xs">View</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        {/* Detail dialog */}
        <Dialog open={selectedIndex !== null} onOpenChange={(open) => { if (!open) setSelectedIndex(null); }}>
          {selected && (
            <DialogContent className="max-w-4xl border-[#E7DED1] bg-white">
              <DialogHeader>
                <DialogTitle className="text-[#111111]">Case details</DialogTitle>
                <DialogDescription className="text-[#6B7280]">{selected.provider}/{selected.model}</DialogDescription>
              </DialogHeader>
              <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 text-sm">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Input</p>
                  <div className="whitespace-pre-wrap rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-[#111111]">{selected.input}</div>
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Output</p>
                  <div className="whitespace-pre-wrap rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-[#111111]">{selected.output ?? "No output"}</div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Dimension scores</p>
                    <div className="rounded-xl border border-[#E7DED1] bg-white px-3 py-2 space-y-1">
                      {Object.entries(selected.judge?.dimensionScores ?? {}).length === 0 ? (
                        <p className="text-[#6B7280]">No dimension scores</p>
                      ) : Object.entries(selected.judge!.dimensionScores).map(([n, v]) => (
                        <div key={n} className="flex justify-between text-[#374151]">
                          <span>{n}</span><span className={`font-medium ${scoreTone(v)}`}>{Math.round(v)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Hard failures</p>
                    <div className="rounded-xl border border-[#E7DED1] bg-white px-3 py-2 space-y-1">
                      {(selected.judge?.hardFailures.length ?? 0) === 0 ? (
                        <p className="text-[#6B7280]">No hard failures</p>
                      ) : selected.judge!.hardFailures.map((f, i) => (
                        <div key={`${f.rule}-${i}`} className="text-[#991B1B]">
                          <p className="font-medium">{f.rule} · {f.severity}</p>
                          <p className="text-xs text-[#7F1D1D]">{f.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Judge reasoning</p>
                  <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-[#111111]">{selected.judge?.verdictReason ?? "Unavailable"}</div>
                </div>
              </div>
            </DialogContent>
          )}
        </Dialog>
      </div>
    </div>
  );
}

// ─── Provider Arena report ─────────────────────────────────────────────────

function ProviderArenaReport({ run }: { run: BehavioralEvaluationRunView }) {
  const [drawerItemId, setDrawerItemId] = useState<string | null>(null);
  const [casePage, setCasePage]         = useState(0);
  const CASES_PER_PAGE = 10;

  const report  = run.arenaReport;
  const candidates = run.candidates ?? [];

  const recStyle = RECOMMENDATION_STYLES[report?.rolloutRecommendation ?? "needs_review"] ?? RECOMMENDATION_STYLES.needs_review!;
  const RecIcon  = recStyle.icon;

  // Build candidate label map
  const candidateLabel = (provider: string, model: string) => {
    const found = candidates.find((c) => c.provider === provider && c.model === model);
    return found?.label || `${provider}/${model}`;
  };

  // Case-level comparison — group by datasetItemId
  const uniqueItemIds = Array.from(new Set(run.results.map((r) => r.datasetItemId)));
  const pagedItemIds  = uniqueItemIds.slice(casePage * CASES_PER_PAGE, (casePage + 1) * CASES_PER_PAGE);
  const totalCasePages = Math.ceil(uniqueItemIds.length / CASES_PER_PAGE);

  // Winner per item
  const bestByItem = useMemo(() => {
    const map = new Map<string, string>();
    for (const itemId of uniqueItemIds) {
      const grouped = run.results.filter((r) => r.datasetItemId === itemId);
      let top = -1; let topProv = "";
      for (const r of grouped) {
        const s = r.judge?.overallScore ?? -1;
        if (s > top) { top = s; topProv = `${r.provider}/${r.model}`; }
      }
      if (topProv) map.set(itemId, topProv);
    }
    return map;
  }, [run.results, uniqueItemIds]);

  // Failure clusters
  const failureClusters = (report?.failureClusters ?? []) as Array<Record<string, unknown>>;

  // Cost/latency by candidate
  const costRows  = (report?.costSummary as { by_candidate?: Array<Record<string, unknown>> } | undefined)?.by_candidate ?? [];
  const latRows   = (report?.latencySummary as { by_candidate?: Array<Record<string, unknown>> } | undefined)?.by_candidate ?? [];

  // Dimension summary: { dimName: [{ provider, model, average }] }
  const dimSummary = (report?.dimensionSummary ?? {}) as Record<string, Array<{ provider: string; model: string; average: number | null }>>;
  const dimNames   = Object.keys(dimSummary);

  // Rankings
  const rankings = (report?.providerRankings ?? []) as Ranking[];
  const winner   = rankings[0] as Ranking | undefined;

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      {/* ── Header ── */}
      <AppHeader
        title="Provider Arena Report"
        subtitle={`${run.promptName ?? "Prompt"} · ${run.promptVersionTag ?? "version"} · ${run.datasetName ?? "dataset"}`}
      />

      <div className="px-4 py-6 md:px-6 xl:px-8 space-y-6">
        {/* Back link */}
        <Link href="/evaluations/provider-arena" className="inline-flex items-center gap-1.5 text-xs text-[#6B7280] hover:text-[#2563EB]">
          <ChevronLeft className="h-3.5 w-3.5" /> Back to Provider Arena
        </Link>

        {/* Run metadata header */}
        <Card className="border-[#E7DED1] bg-white">
          <CardContent className="pt-4 pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap gap-1.5">
                  <Badge className="bg-[#EFF6FF] text-[#1D4ED8] font-semibold">
                    <Swords className="h-3 w-3 mr-1" />Provider Arena
                  </Badge>
                  <Badge className="bg-[#F3E8FF] text-[#7C3AED]">Pro feature</Badge>
                  <Badge className="bg-[#F0FDF4] text-[#166534]">Behavioral dataset</Badge>
                  <Badge className="bg-[#ECFDF5] text-[#065F46]">Multi-provider</Badge>
                  <Badge className={run.status === "completed" ? "bg-[#ECFDF5] text-[#065F46]" : run.status === "failed" ? "bg-[#FEF2F2] text-[#991B1B]" : "bg-[#FFFBEB] text-[#92400E]"}>
                    {run.status}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#6B7280] mt-1">
                  <span><span className="font-medium text-[#374151]">Dataset</span> {run.datasetName ?? "—"}</span>
                  <span><span className="font-medium text-[#374151]">Rubric</span> {run.rubricName ?? "—"}</span>
                  <span><span className="font-medium text-[#374151]">Prompt</span> {run.promptName ?? "—"} {run.promptVersionTag ?? ""}</span>
                  <span><span className="font-medium text-[#374151]">Started by</span> {run.startedBy}</span>
                  <span><span className="font-medium text-[#374151]">Completed</span> {fmtDate(run.completedAt)}</span>
                  <span><span className="font-medium text-[#374151]">Candidates</span> {candidates.length}</span>
                </div>
              </div>
              <div className="text-right text-xs text-[#6B7280]">
                <div>{uniqueItemIds.length} dataset items</div>
                <div>{uniqueItemIds.length * candidates.length} provider executions</div>
                <div>{uniqueItemIds.length * candidates.length} judge executions</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Recommendation card ── */}
        {report ? (
          <Card className={`border ${recStyle.border} ${recStyle.bg}`}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <RecIcon className="h-5 w-5" />
                <CardTitle className="text-[#111111] text-lg">Recommendation</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge className={`${recStyle.badge} text-sm font-bold px-3 py-1`}>{recStyle.label}</Badge>
                {report.decisionScore != null && (
                  <div className={`rounded-xl px-3 py-1.5 text-sm font-semibold ${scoreBg(report.decisionScore)}`}>
                    Decision score {Math.round(report.decisionScore)}%
                  </div>
                )}
                {report.riskScore != null && (
                  <div className={`rounded-xl px-3 py-1.5 text-sm font-semibold ${scoreBg(100 - report.riskScore)}`}>
                    Risk {Math.round(report.riskScore)}%
                  </div>
                )}
              </div>
              {report.summary && (
                <p className="text-sm text-[#374151] leading-relaxed">{report.summary}</p>
              )}
              {/* Recommended candidate */}
              {winner && (
                <div className="rounded-xl border border-[#E7DED1] bg-white px-4 py-3 flex flex-wrap items-center gap-4">
                  <Trophy className="h-5 w-5 text-[#D97706] flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[#6B7280] mb-0.5">Recommended provider</p>
                    <p className="font-bold text-[#111111]">
                      {String(winner.provider ?? "")} / {String(winner.model ?? "")}
                      {winner.label ? ` · ${String(winner.label)}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {winner.pass_rate != null && (
                      <span className="rounded bg-[#ECFDF5] text-[#065F46] px-2 py-0.5 font-medium">
                        {Math.round(Number(winner.pass_rate))}% pass rate
                      </span>
                    )}
                    {winner.hard_failure_rate != null && (
                      <span className="rounded bg-[#FEF2F2] text-[#991B1B] px-2 py-0.5 font-medium">
                        {Math.round(Number(winner.hard_failure_rate))}% hard fails
                      </span>
                    )}
                    {winner.p95_latency_ms != null && (
                      <span className="rounded bg-[#F3F4F6] text-[#374151] px-2 py-0.5 font-medium">
                        P95 {ms(Number(winner.p95_latency_ms))}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-[#E7DED1] bg-white">
            <CardContent className="py-6 text-center text-sm text-[#6B7280]">
              Arena report not yet available
            </CardContent>
          </Card>
        )}

        {/* ── Provider leaderboard ── */}
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4 text-[#D97706]" />
              <CardTitle className="text-[#111111]">Provider leaderboard</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#EFE7DA] text-xs text-[#6B7280]">
                    <th className="py-2 text-left font-semibold">Rank</th>
                    <th className="py-2 text-left font-semibold">Provider / Model</th>
                    <th className="py-2 text-right font-semibold">Decision score</th>
                    <th className="py-2 text-right font-semibold">Avg score</th>
                    <th className="py-2 text-right font-semibold">Pass rate</th>
                    <th className="py-2 text-right font-semibold">Hard fails</th>
                    <th className="py-2 text-right font-semibold">Needs review</th>
                    <th className="py-2 text-right font-semibold">Est. cost</th>
                    <th className="py-2 text-right font-semibold">P95 latency</th>
                    <th className="py-2 text-right font-semibold">Risk score</th>
                  </tr>
                </thead>
                <tbody>
                  {rankings.map((row, idx) => {
                    const isWinner = idx === 0;
                    return (
                      <tr
                        key={String(row.provider_candidate_id ?? idx)}
                        className={`border-b border-[#F1ECE3] last:border-0 ${isWinner ? "bg-[#F0FDF4]" : ""}`}
                      >
                        <td className="py-2.5 font-medium text-[#111111] pl-1">
                          <div className="flex items-center gap-1">
                            {isWinner && <Trophy className="h-3.5 w-3.5 text-[#D97706]" />}
                            {String(row.rank ?? idx + 1)}
                          </div>
                        </td>
                        <td className="py-2.5 text-[#374151]">
                          <div className="font-medium text-[#111111]">{candidateLabel(String(row.provider ?? ""), String(row.model ?? ""))}</div>
                          <div className="text-xs text-[#6B7280]">{String(row.provider ?? "")} / {String(row.model ?? "")}</div>
                        </td>
                        <td className="py-2.5 text-right">
                          <span className={`font-bold ${scoreTone(row.decision_score != null ? Number(row.decision_score) : null)}`}>
                            {row.decision_score != null ? `${Math.round(Number(row.decision_score))}%` : "—"}
                          </span>
                        </td>
                        <td className={`py-2.5 text-right ${scoreTone(row.average_score != null ? Number(row.average_score) : null)}`}>
                          {row.average_score != null ? `${Math.round(Number(row.average_score))}%` : "—"}
                        </td>
                        <td className="py-2.5 text-right text-[#374151]">{pct(row.pass_rate != null ? Number(row.pass_rate) : null)}</td>
                        <td className="py-2.5 text-right text-[#991B1B]">
                          {row.hard_failure_rate != null ? `${Number(row.hard_failure_rate).toFixed(1)}%` : "—"}
                        </td>
                        <td className="py-2.5 text-right text-[#B45309]">
                          {row.needs_review_rate != null ? `${Number(row.needs_review_rate).toFixed(1)}%` : "—"}
                        </td>
                        <td className="py-2.5 text-right text-[#374151]">{cost(row.estimated_cost_total != null ? Number(row.estimated_cost_total) : null)}</td>
                        <td className="py-2.5 text-right text-[#374151]">{ms(row.p95_latency_ms != null ? Number(row.p95_latency_ms) : null)}</td>
                        <td className="py-2.5 text-right">
                          <span className={`font-medium ${scoreTone(row.risk_score != null ? 100 - Number(row.risk_score) : null)}`}>
                            {row.risk_score != null ? `${Math.round(Number(row.risk_score))}%` : "—"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* ── Dimension comparison ── */}
        {dimNames.length > 0 && (
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-[#2563EB]" />
                <CardTitle className="text-[#111111]">Dimension comparison</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#EFE7DA] text-xs text-[#6B7280]">
                      <th className="py-2 text-left font-semibold">Dimension</th>
                      {candidates.map((c) => (
                        <th key={c.id} className="py-2 text-right font-semibold min-w-[90px]">
                          {c.label || `${c.provider}/${c.model}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dimNames.map((dim) => {
                      const entries = dimSummary[dim] ?? [];
                      return (
                        <tr key={dim} className="border-b border-[#F1ECE3] last:border-0">
                          <td className="py-2.5 font-medium text-[#374151]">{dim}</td>
                          {candidates.map((c) => {
                            const entry = entries.find((e) => e.provider === c.provider && e.model === c.model);
                            const avg   = entry?.average ?? null;
                            return (
                              <td key={c.id} className="py-2.5 text-right">
                                <span className={`font-medium ${scoreTone(avg)}`}>
                                  {avg != null ? `${Math.round(avg)}%` : "—"}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Cost & latency comparison ── */}
        {(costRows.length > 0 || latRows.length > 0) && (
          <div className="grid gap-5 md:grid-cols-2">
            {/* Cost */}
            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-[#059669]" />
                  <CardTitle className="text-[#111111]">Cost comparison</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {costRows.map((row) => (
                    <div key={String(row.provider_candidate_id)} className="flex items-center justify-between text-sm">
                      <span className="text-[#374151] font-medium">
                        {candidateLabel(String(row.provider ?? ""), String(row.model ?? ""))}
                      </span>
                      <div className="flex flex-col items-end text-xs">
                        <span className="font-semibold text-[#111111]">{cost(row.total_cost != null ? Number(row.total_cost) : null)} total</span>
                        {row.cost_per_execution != null && (
                          <span className="text-[#6B7280]">{cost(Number(row.cost_per_execution))} / execution</span>
                        )}
                      </div>
                    </div>
                  ))}
                  {costRows.length === 0 && (
                    <p className="text-xs text-[#6B7280]">No cost data available</p>
                  )}
                </div>
              </CardContent>
            </Card>
            {/* Latency */}
            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-[#D97706]" />
                  <CardTitle className="text-[#111111]">Latency comparison</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {latRows.map((row) => (
                    <div key={String(row.provider_candidate_id)} className="flex items-center justify-between text-sm">
                      <span className="text-[#374151] font-medium">
                        {candidateLabel(String(row.provider ?? ""), String(row.model ?? ""))}
                      </span>
                      <div className="flex flex-col items-end text-xs">
                        <span className="font-semibold text-[#111111]">Avg {ms(row.average_latency_ms != null ? Number(row.average_latency_ms) : null)}</span>
                        <span className="text-[#6B7280]">P95 {ms(row.p95_latency_ms != null ? Number(row.p95_latency_ms) : null)}</span>
                      </div>
                    </div>
                  ))}
                  {latRows.length === 0 && (
                    <p className="text-xs text-[#6B7280]">No latency data available</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Failure reasons ── */}
        {failureClusters.length > 0 && (
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-[#DC2626]" />
                <CardTitle className="text-[#111111]">Failure reasons</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#EFE7DA] text-xs text-[#6B7280]">
                      <th className="py-2 text-left font-semibold">Cluster</th>
                      <th className="py-2 text-left font-semibold">Severity</th>
                      <th className="py-2 text-left font-semibold">Provider</th>
                      <th className="py-2 text-right font-semibold">Affected cases</th>
                      <th className="py-2 text-left font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failureClusters.map((cluster, i) => {
                      const sev = String(cluster.severity ?? "medium");
                      const sevStyle = sev === "critical" ? "bg-[#FEF2F2] text-[#991B1B]" : sev === "high" ? "bg-[#FFF7ED] text-[#C2410C]" : "bg-[#FFFBEB] text-[#B45309]";
                      return (
                        <tr key={i} className="border-b border-[#F1ECE3] last:border-0">
                          <td className="py-2.5 font-medium text-[#374151]">{String(cluster.cluster_name ?? "Failure cluster")}</td>
                          <td className="py-2.5">
                            <Badge className={sevStyle}>{sev}</Badge>
                          </td>
                          <td className="py-2.5 text-[#374151] text-xs">
                            {cluster.provider ? `${String(cluster.provider)}/${String(cluster.model ?? "")}` : "All providers"}
                          </td>
                          <td className="py-2.5 text-right text-[#374151]">{String(cluster.affected_cases_count ?? "—")}</td>
                          <td className="py-2.5 text-xs text-[#6B7280] max-w-[220px]">{String(cluster.recommended_action ?? "")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Case-level comparison ── */}
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-[#6B7280]" />
                <CardTitle className="text-[#111111]">Case-level comparison</CardTitle>
              </div>
              <span className="text-xs text-[#6B7280]">{uniqueItemIds.length} items · {candidates.length} providers each</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {pagedItemIds.map((itemId) => {
              const grouped  = run.results.filter((r) => r.datasetItemId === itemId);
              const baseInput = grouped[0]?.input ?? "";
              const best     = bestByItem.get(itemId) ?? "";
              const hasHardFail = grouped.some((r) => (r.judge?.hardFailures.length ?? 0) > 0);
              const hasReview   = grouped.some((r) => r.judge?.needsReview);

              return (
                <div key={itemId} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-xs text-[#374151] line-clamp-2 flex-1">{baseInput}</p>
                    <div className="flex flex-shrink-0 gap-1">
                      {hasHardFail && <Badge className="bg-[#FEF2F2] text-[#991B1B] text-[10px]">Hard fail</Badge>}
                      {hasReview   && <Badge className="bg-[#FFFBEB] text-[#92400E] text-[10px]">Review</Badge>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {grouped.map((r) => {
                      const isWin = `${r.provider}/${r.model}` === best;
                      return (
                        <div
                          key={r.evaluationExecutionId}
                          className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${isWin ? "border-[#A7F3D0] bg-[#ECFDF5]" : "border-[#E7DED1] bg-white"}`}
                        >
                          {isWin && <Trophy className="h-3 w-3 text-[#065F46]" />}
                          <span className="font-medium text-[#374151]">{candidateLabel(r.provider, r.model)}</span>
                          <span className={`font-bold ${scoreTone(r.judge?.overallScore ?? null)}`}>
                            {r.judge?.overallScore != null ? `${Math.round(r.judge.overallScore)}%` : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    className="text-xs text-[#2563EB] hover:text-[#1D4ED8] flex items-center gap-1"
                    onClick={() => setDrawerItemId(itemId)}
                  >
                    View full comparison <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              );
            })}

            {/* Pagination */}
            {totalCasePages > 1 && (
              <div className="flex items-center justify-between pt-2 text-xs text-[#6B7280]">
                <button
                  type="button"
                  disabled={casePage === 0}
                  onClick={() => setCasePage((p) => p - 1)}
                  className="flex items-center gap-1 disabled:opacity-40 hover:text-[#2563EB]"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Prev
                </button>
                <span>Page {casePage + 1} of {totalCasePages}</span>
                <button
                  type="button"
                  disabled={casePage >= totalCasePages - 1}
                  onClick={() => setCasePage((p) => p + 1)}
                  className="flex items-center gap-1 disabled:opacity-40 hover:text-[#2563EB]"
                >
                  Next <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Review queue summary */}
        {run.reviewQueue && (run.reviewQueue.open > 0 || run.reviewQueue.criticalOpen > 0) && (
          <Card className="border-[#E7DED1] bg-white">
            <CardContent className="py-3 flex flex-wrap items-center gap-2 text-xs">
              <Badge className="bg-[#EEF2FF] text-[#1E3A8A]">Open {run.reviewQueue.open}</Badge>
              <Badge className="bg-[#FEF2F2] text-[#991B1B]">Critical {run.reviewQueue.criticalOpen}</Badge>
              <Link href="/evaluations/review" className="ml-auto text-[#2563EB] hover:text-[#1D4ED8]">Open review queue →</Link>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Case drawer */}
      <CaseDrawer
        open={drawerItemId !== null}
        onClose={() => setDrawerItemId(null)}
        datasetItemId={drawerItemId}
        results={run.results}
        candidates={candidates}
      />
    </div>
  );
}

// ─── Shell entry point ─────────────────────────────────────────────────────

export function BehavioralRunShell({ runId }: { runId: string }) {
  const { run, loading, error } = useArenaRun(runId);
  const { planTier } = useWorkspace();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-[#6B7280]">
        <Loader2 className="h-4 w-4 animate-spin" />Loading run report…
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="min-h-screen bg-[#F8F5EF]">
        <AppHeader title="Run not found" subtitle="The requested run is unavailable" />
        <div className="px-4 py-8 md:px-6">
          <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">
            {error ?? "Run not found"}
          </div>
        </div>
      </div>
    );
  }

  // Gating: provider_arena requires Pro/Enterprise even for viewing
  if (run.runType === "provider_arena" && !canUseProviderArena(planTier)) {
    return <ProviderArenaGateBanner />;
  }

  // Running / queued state
  if (ACTIVE.has(run.status) && run.runType === "provider_arena") {
    return <ArenaRunningPanel run={run} />;
  }

  // Provider Arena completed/failed
  if (run.runType === "provider_arena") {
    return <ProviderArenaReport run={run} />;
  }

  // Standard behavioral run
  return <StandardRunView run={run} />;
}
